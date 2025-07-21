import { D1Database } from '@cloudflare/workers-types';
import { Command } from 'commander';
import buildConfig, { ConfigOptions } from '../../config';
import ora from 'ora';
import chalk from 'chalk';
import crypto from 'crypto';
import enquirer from 'enquirer';
import fs from 'fs/promises';
import path from 'path';
import logger from '../../logger';
import * as server from '../../server';
import splitSqlQuery from '../../sql';
import { MigrationStep, SqliteMigration } from '../../sqlite/migration';
import { Database } from '../../database';
import {
  collectMigrations,
  dataToInsertStatements,
  MIGRATION_TABLE,
} from './migration';
import { normalizeSql } from '../../sqlite/utils';

async function retrieveSchema(database: Database) {
  const statements: string[] = [];
  const spinner = ora(chalk.yellow('Retrieving database schema...')).start();
  try {
    const schema = await database.retrieveSchema();
    statements.push(...schema);
    spinner.succeed(chalk.green('Database schema retrieved.'));
  } catch (error) {
    spinner.fail(chalk.red('Failed to retrieve database schema!'));
    logger.error(error);
    process.exit(1);
  }
  return statements;
}

function formatSqlForTable(sql: string, maxWidth: number): string[] {
  const formatted = sql
    .replace(/\s+/g, ' ')
    .replace(/,\s*/g, ', ')
    .replace(/\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/\bSELECT\b/gi, 'SELECT')
    .replace(/\bFROM\b/gi, 'FROM')
    .replace(/\bWHERE\b/gi, 'WHERE')
    .replace(/\bINSERT\b/gi, 'INSERT')
    .replace(/\bINTO\b/gi, 'INTO')
    .replace(/\bUPDATE\b/gi, 'UPDATE')
    .replace(/\bSET\b/gi, 'SET')
    .replace(/\bDELETE\b/gi, 'DELETE')
    .replace(/\bCREATE\b/gi, 'CREATE')
    .replace(/\bTABLE\b/gi, 'TABLE')
    .replace(/\bALTER\b/gi, 'ALTER')
    .replace(/\bDROP\b/gi, 'DROP')
    .trim();

  const lines: string[] = [];
  const words = formatted.split(' ');
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if ([...testLine].length <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        lines.push(word);
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [''];
}

function printMigration(title: string, steps: MigrationStep[]) {
  const stepColWidth = 8;
  const statementColWidth = 100;
  const statementLineLength = statementColWidth - 2;

  logger.info(chalk.bold(title));
  logger.info(
    chalk.dim(
      '┌' + '─'.repeat(stepColWidth) + '┬' + '─'.repeat(statementColWidth) + '┐'
    )
  );
  logger.info(
    chalk.dim('│ ') +
      chalk.bold('Step'.padEnd(stepColWidth - 1)) +
      chalk.dim('│ ') +
      chalk.bold('SQL Statement'.padEnd(statementLineLength)) +
      chalk.dim(' │')
  );
  logger.info(
    chalk.dim(
      '├' + '─'.repeat(stepColWidth) + '┼' + '─'.repeat(statementColWidth) + '┤'
    )
  );

  steps.forEach((step, idx) => {
    const allLines = step.statements.flatMap(statement =>
      formatSqlForTable(statement, statementLineLength)
    );

    const lines = allLines.length ? allLines : [''];

    lines.forEach((line, lineIdx) => {
      const displayLine = line.padEnd(statementLineLength);

      logger.info(
        chalk.dim('│ ') +
          (lineIdx === 0
            ? chalk.cyan(String(idx + 1).padEnd(stepColWidth - 1))
            : ' '.repeat(stepColWidth - 1)) +
          chalk.dim('│ ') +
          chalk.white(displayLine) +
          chalk.dim(' │')
      );
    });

    if (idx < steps.length - 1) {
      logger.info(
        chalk.dim(
          '├' +
            '─'.repeat(stepColWidth) +
            '┼' +
            '─'.repeat(statementColWidth) +
            '┤'
        )
      );
    }
  });

  logger.info(
    chalk.dim(
      '└' + '─'.repeat(stepColWidth) + '┴' + '─'.repeat(statementColWidth) + '┘'
    )
  );
}

const schema = () =>
  new Command('schema')
    .description('Manage database schema')
    .addOption(ConfigOptions.ProjectDirectory)
    .option(
      '--migrations-table [table]',
      'Migrations table name',
      MIGRATION_TABLE
    )
    .option('--schema-name [name]', 'Name of the schema file', 'schema.sql')
    .option('--migration-name [name]', 'Name of the migration file')
    .option('--no-sync', 'Skip syncing the database')
    .option('--no-confirm', 'Skip confirmation prompt')
    .action(async args => {
      const cfg = await buildConfig(args);

      if (!cfg.accessToken || !cfg.projectId) {
        logger.error(
          chalk.red('Project is not linked. Please run `setup` command first.')
        );
        process.exit(1);
      }

      const database = new Database({
        baseUrl: cfg.baseUrl,
        accessToken: cfg.accessToken,
        projectId: cfg.projectId,
      });

      const remoteSchemaStatements: string[] = [];
      const schemaStatements: string[] = [];
      const dataStatements: string[] = [];
      const migrationFiles = await collectMigrations(cfg);

      if (args.sync) {
        const schema = await retrieveSchema(database);
        remoteSchemaStatements.push(...schema);

        if (schema.length) {
          const fileName = args.schemaName;
          const filePath = path.join(cfg.schema, fileName);
          const fileExists = await fs
            .access(filePath, fs.constants.F_OK)
            .then(() => true)
            .catch(() => false);

          let willWrite = true;

          if (fileExists && args.confirm) {
            const { confirm } = await enquirer.prompt<{ confirm: boolean }>({
              type: 'confirm',
              name: 'confirm',
              message: `Do you want to overwrite the existing schema file (${fileName})?`,
              initial: true,
            });
            willWrite = confirm;
          }

          if (willWrite) {
            await fs.mkdir(cfg.schema, { recursive: true });
            await fs.writeFile(filePath, schema.join(';\n\n'), 'utf-8');
            logger.info(chalk.green(`Schema file created: ${fileName}`));
          }
        }

        const spinner = ora(chalk.yellow('Retrieving migrations...')).start();
        try {
          const data = await database.query(
            `SELECT * FROM ${args.migrationsTable}`
          );
          const insertStatements = dataToInsertStatements(
            args.migrationsTable,
            data.rows
          );
          dataStatements.push(...insertStatements);
          spinner.succeed(chalk.green('Migration data retrieved.'));
        } catch {
          spinner.info(chalk.dim('Skipping migrations table data.'));
        }
      }

      const schemaFiles = await fs
        .readdir(cfg.schema)
        .catch<string[]>(() => []);

      for (const file of schemaFiles) {
        if (file.toLowerCase().endsWith('.sql')) {
          const filePath = path.join(cfg.schema, file);
          const content = await fs.readFile(filePath, 'utf-8');
          schemaStatements.push(
            ...splitSqlQuery(content)
              .map(normalizeSql)
              .filter(query => query.length > 0)
          );
        }
      }

      const withDatabase = async (
        action: (db: D1Database) => Promise<void>
      ) => {
        const flare = await server.create({ database: cfg.data });
        try {
          await flare.ready;
          const db = await flare.getD1Database('DATABASE');
          await action(db);
        } finally {
          await flare.dispose();
        }
      };

      await withDatabase(async db => {
        const pollTargetSchema = async () => {
          const result = await db
            .prepare(
              'SELECT sql FROM sqlite_master WHERE name NOT LIKE "sqlite_%" AND name NOT LIKE "_cf_%"'
            )
            .all<{ sql: string }>();
          return result.results.map(r => r.sql);
        };

        // syncing remote schema and migration data
        if (remoteSchemaStatements.length) {
          const targetSchemaStatements = await pollTargetSchema();

          const migration = new SqliteMigration();
          await migration.exec(targetSchemaStatements.join(';'));

          const migrationStatements = await Promise.all(
            migrationFiles.map(async ({ file }) => {
              const content = await fs.readFile(file, 'utf-8');
              const sql = splitSqlQuery(content);
              return sql.join(';');
            })
          );

          await migration.prepare(
            [...remoteSchemaStatements, ...migrationStatements].join(';')
          );
          if (migration.totalSteps) {
            printMigration(
              'Migration steps (syncing remote schema to local)',
              migration.steps
            );

            let willApply = true;

            if (args.confirm) {
              const { confirm } = await enquirer.prompt<{ confirm: boolean }>({
                type: 'confirm',
                name: 'confirm',
                message: `Do you want to apply these ${migration.totalSteps} step(s) to sync your local database with the remote schema?`,
                initial: true,
              });
              if (!confirm) {
                logger.info(chalk.yellow('Aborting schema synchronization.'));
                willApply = false;
              }
            }

            if (willApply) {
              const spinner = ora(
                chalk.yellow('Applying remote schema to local database...')
              ).start();
              try {
                await db.batch(
                  migration.statements().map(sql => db.prepare(sql))
                );
                spinner.succeed(
                  chalk.green(
                    'Remote schema successfully synced to local database.'
                  )
                );
              } catch (error) {
                spinner.fail(
                  chalk.red('Failed to sync remote schema to local database!')
                );
                logger.error(error);
                process.exit(1);
              }

              if (dataStatements.length) {
                const spinner = ora(
                  chalk.yellow('Applying migration data to local database...')
                ).start();
                try {
                  await db.batch(dataStatements.map(sql => db.prepare(sql)));
                  spinner.succeed(
                    chalk.green('Migration data applied to local database.')
                  );
                } catch (error) {
                  spinner.fail(
                    chalk.red(
                      'Failed to apply migration data to local database!'
                    )
                  );
                  logger.error(error);
                  process.exit(1);
                }
              }
            }
          } else {
            logger.info(
              chalk.green(
                'No schema changes detected. Local database is already up to date with the remote schema.'
              )
            );
          }
        }

        // Generate new migration file
        {
          const targetSchemaStatements = await pollTargetSchema();

          const migration = new SqliteMigration();
          await migration.exec(targetSchemaStatements.join(';'));
          await migration.prepare(schemaStatements.join(';'));

          if (migration.totalSteps) {
            printMigration('Migration steps', migration.steps);

            let willGenerate = true;
            let willApply = true;

            let migrationInfo: {
              version: number;
              name: string;
              hash: string;
            } | null = null;

            if (willGenerate && args.confirm) {
              const { confirm } = await enquirer.prompt<{ confirm: boolean }>({
                type: 'confirm',
                name: 'confirm',
                message: `Do you want to generate a new migration file with these ${migration.totalSteps} step(s)?`,
                initial: true,
              });
              if (!confirm) {
                logger.info(
                  chalk.yellow('Aborting migration file generation.')
                );
                willGenerate = false;
                willApply = false;
              }
            }

            if (willGenerate) {
              const version =
                migrationFiles.reduce(
                  (max, file) => Math.max(max, file.version),
                  0
                ) + 1;
              const { name } = args.migrationName
                ? { name: args.migrationName }
                : await enquirer.prompt<{ name: string }>({
                    type: 'input',
                    name: 'name',
                    message:
                      'Enter a name for the migration file (e.g. add-users-table):',
                    initial: 'new-migration',
                  });

              const content = migration.sql();
              const hash = await crypto.subtle
                .digest('SHA-256', Buffer.from(content, 'utf-8'))
                .then(buffer => Buffer.from(buffer).toString('hex'));

              const fileName = `${version.toString().padStart(4, '0')}-${name.replace(/[^a-zA-Z0-9-_]/g, '_')}.sql`;
              const filePath = path.join(cfg.migrations, fileName);

              await fs.mkdir(cfg.migrations, { recursive: true });
              await fs.writeFile(filePath, content, 'utf-8');
              logger.info(chalk.green(`Migration file created: ${fileName}`));

              migrationInfo = { version, name, hash };
            }

            if (willApply && args.confirm) {
              const { confirm } = await enquirer.prompt<{ confirm: boolean }>({
                type: 'confirm',
                name: 'confirm',
                message: 'Do you want to apply this migration?',
                initial: true,
              });
              if (!confirm) {
                logger.info(chalk.yellow('Aborting migration application.'));
                willApply = false;
              }
            }

            if (willApply && migrationInfo) {
              const spinner = ora(
                chalk.yellow('Applying migration...')
              ).start();
              try {
                await db.batch(
                  [
                    `
                    CREATE TABLE IF NOT EXISTS ${args.migrationsTable} (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      name TEXT NOT NULL UNIQUE,
                      version INTEGER NOT NULL,
                      hash TEXT NOT NULL
                    )
                    `,
                    ...migration.statements(),
                    `INSERT INTO ${args.migrationsTable} (name, version, hash) VALUES ('${migrationInfo.name}', ${migrationInfo.version}, '${migrationInfo.hash}')`,
                  ].map(sql => db.prepare(sql))
                );
                spinner.succeed(chalk.green('Migration applied.'));
              } catch (error) {
                spinner.fail(chalk.red('Failed to apply migration!'));
                logger.error(error);
                process.exit(1);
              }
            }
          }
        }
      });
    });

export default schema;
