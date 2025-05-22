import { D1Database } from '@cloudflare/workers-types';
import { Command } from 'commander';
import buildConfig, { ConfigOptions } from '../../config';
import ora from 'ora';
import chalk from 'chalk';
import enquirer from 'enquirer';
import fs from 'fs/promises';
import path from 'path';
import logger from '../../logger';
import * as server from '../../server';
import { build } from '../../build';
import splitSqlQuery from '../../sql';
import { SqliteMigration } from '../../sqlite/migration';
import { Database } from '../../database';
import {
  collectMigrations,
  dataToInsertStatements,
  MIGRATION_TABLE,
} from './migration';

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

function printStatements(title: string, statements: string[]) {
  const stepColWidth = 6;
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
    chalk.bold('SQL statement'.padEnd(statementLineLength)) +
    chalk.dim(' │')
  );
  logger.info(
    chalk.dim(
      '├' + '─'.repeat(stepColWidth) + '┼' + '─'.repeat(statementColWidth) + '┤'
    )
  );

  statements.forEach((stmt, idx) => {
    const lines = stmt.split('\n').flatMap(line => {
      if ([...line].length <= statementLineLength) return [line];
      const wrapped: string[] = [];
      let start = 0;
      while (start < line.length) {
        let sliceLen = 0;
        let charCount = 0;
        while (
          start + sliceLen < line.length &&
          charCount < statementLineLength
        ) {
          const code = line.codePointAt(start + sliceLen)!;
          sliceLen += code > 0xffff ? 2 : 1;
          charCount++;
        }
        wrapped.push(line.slice(start, start + sliceLen));
        start += sliceLen;
      }
      return wrapped;
    });

    lines.forEach((line, lineIdx) => {
      let displayLine = line;
      const chars = [...displayLine];
      if (chars.length < statementLineLength) {
        displayLine =
          displayLine + ' '.repeat(statementLineLength - chars.length);
      } else if (chars.length > statementLineLength) {
        displayLine = chars.slice(0, statementLineLength).join('');
      }
      logger.info(
        chalk.dim('│ ') +
        (lineIdx === 0
          ? String(idx + 1).padEnd(stepColWidth - 1)
          : ' '.repeat(stepColWidth - 1)) +
        chalk.dim('│ ') +
        displayLine +
        chalk.dim(' │')
      );
    });
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
          const sql = splitSqlQuery(content);

          for (const query of sql) {
            if (query.trim().length > 0) {
              schemaStatements.push(query);
            }
          }
        }
      }

      const withDatabase = async (
        action: (db: D1Database) => Promise<void>
      ) => {
        const flare = await server.create({
          script: await build({ entryPoints: cfg.entry, debug: true }),
          database: cfg.data,
        });
        try {
          await flare.ready;
          const db = await flare.getD1Database('db');
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

          const migration = await SqliteMigration.create();
          await migration.migrate(targetSchemaStatements.join(';'));
          migration.clear();

          const migrationFiles = await collectMigrations(cfg);
          const migrationStatements = await Promise.all(
            migrationFiles.map(async ({ file }) => {
              const content = await fs.readFile(file, 'utf-8');
              const sql = splitSqlQuery(content);
              return sql.join(';');
            })
          );

          await migration.migrate(
            [...remoteSchemaStatements, ...migrationStatements].join(';')
          );
          if (migration.numberOfChanges) {
            printStatements(
              'Migration steps (syncing remote schema to local)',
              migration.statements
            );

            let willApply = true;

            if (args.confirm) {
              const { confirm } = await enquirer.prompt<{ confirm: boolean }>({
                type: 'confirm',
                name: 'confirm',
                message: `Do you want to apply these ${migration.numberOfChanges} step(s) to sync your local database with the remote schema?`,
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
                  migration.statements.map(sql => db.prepare(sql))
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

          const migration = await SqliteMigration.create();
          await migration.migrate(targetSchemaStatements.join(';'));
          migration.clear();

          await migration.migrate(schemaStatements.join(';'));
          if (migration.numberOfChanges) {
            printStatements('Migration steps', migration.statements);

            let willGenerate = true;

            if (args.confirm) {
              const { confirm } = await enquirer.prompt<{ confirm: boolean }>({
                type: 'confirm',
                name: 'confirm',
                message: `Do you want to generate a new migration file with these ${migration.statements.length} step(s)?`,
                initial: true,
              });
              if (!confirm) {
                logger.info(
                  chalk.yellow('Aborting migration file generation.')
                );
                willGenerate = false;
              }
            }

            if (willGenerate) {
              const now = new Date();
              const version = Math.floor(now.getTime() / 1000);
              const { name } = args.migrationName
                ? { name: args.migrationName }
                : await enquirer.prompt<{ name: string }>({
                  type: 'input',
                  name: 'name',
                  message:
                    'Enter a name for the migration file (e.g. add-users-table):',
                  initial: 'new-migration',
                });
              const fileName = `${version}-${name.replace(/[^a-zA-Z0-9-_]/g, '_')}.sql`;
              const filePath = path.join(cfg.migrations, fileName);
              await fs.mkdir(cfg.migrations, { recursive: true });
              await fs.writeFile(
                filePath,
                migration.statements.join(';\n\n') + ';\n',
                'utf-8'
              );
              logger.info(chalk.green(`Migration file created: ${fileName}`));
            }

            let willApply = true;

            if (args.confirm) {
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

            if (willApply) {
              const spinner = ora(
                chalk.yellow('Applying migration...')
              ).start();
              try {
                await db.batch(
                  migration.statements.map(sql => db.prepare(sql))
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
