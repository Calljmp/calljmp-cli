import { Command } from 'commander';
import buildConfig, { ConfigOptions } from '../config';
import ora from 'ora';
import chalk from 'chalk';
import enquirer from 'enquirer';
import fs from 'fs/promises';
import path from 'path';
import * as Sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import logger from '../logger';
import * as server from '../server';
import { build } from '../build';
import { readVariables } from '../env';
import splitSqlQuery from '../sql';
import { SqliteMigration } from '../sqlite/migration';
import { Database } from '../database';

const pull = () =>
  new Command('pull')
    .description('Pull the database schema from the server')
    .addOption(ConfigOptions.ProjectDirectory)
    .option('--schema-name <name>', 'Name of the schema file', 'schema.sql')
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

      const statements: string[] = [];

      {
        const spinner = ora(
          chalk.yellow('Retrieving database schema...')
        ).start();
        try {
          const schema = await database.retrieveSchema();
          statements.push(...schema);
          spinner.succeed(chalk.green('Database schema retrieved.'));
        } catch (error) {
          spinner.fail(chalk.red('Failed to retrieve database schema!'));
          logger.error(error);
          process.exit(1);
        }
      }

      const fileName = args.schemaName;
      const filePath = path.join(cfg.schema, fileName);
      const fileExists = await fs
        .access(filePath, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);

      if (fileExists && args.confirm) {
        const { confirm } = await enquirer.prompt<{ confirm: boolean }>({
          type: 'confirm',
          name: 'confirm',
          message: 'Do you want to overwrite the existing schema file?',
          initial: true,
        });
        if (!confirm) {
          logger.info(chalk.yellow('Aborting schema file generation.'));
          return;
        }
      }

      await fs.mkdir(cfg.schema, { recursive: true });
      await fs.writeFile(filePath, statements.join(';\n\n') + ';\n', 'utf-8');
      logger.info(chalk.green(`Schema file created: ${fileName}`));
    });

const generate = () =>
  new Command('generate')
    .description('Generate the database schema migrations')
    .addOption(ConfigOptions.ProjectDirectory)
    .option('--migration-name [name]', 'Name of the migration file')
    .option('--no-confirm', 'Skip confirmation prompt')
    .action(async args => {
      const cfg = await buildConfig(args);
      const schemaFiles = await fs
        .readdir(cfg.schema)
        .catch<string[]>(() => []);

      if (schemaFiles.length === 0) {
        logger.warn(
          chalk.yellow(
            `No SQL schema files found in ./${path.relative(cfg.project, cfg.schema)} directory`
          )
        );
        process.exit(1);
      }

      const schema: string[] = [];

      const envs = await readVariables(cfg.project);
      const flare = await server.create({
        script: await build({ entryPoints: cfg.entry, debug: true }),
        database: cfg.data,
        bindings: envs,
      });
      try {
        await flare.ready;
        const spinner = ora(
          chalk.yellow('Retrieving current schema...')
        ).start();
        try {
          const db = await flare.getD1Database('db');
          const statements = await db
            .prepare(
              'SELECT sql FROM sqlite_master WHERE name NOT LIKE "sqlite_%" AND name NOT LIKE "_cf_%"'
            )
            .all<{ sql: string }>();
          schema.push(...statements.results.map(r => r.sql));
          spinner.succeed(chalk.green('Current schema retrieved.'));
        } catch (error) {
          spinner.fail(chalk.red('Failed to retrieve current schema!'));
          logger.error(error);
          process.exit(1);
        }
      } finally {
        await flare.dispose();
      }

      const database = await Sqlite.open({
        filename: ':memory:',
        driver: sqlite3.Database,
      });
      try {
        {
          const spinner = ora(chalk.yellow('Initializing database...')).start();
          try {
            const migration = new SqliteMigration(database);
            await migration.migrate(schema.join(';'));
            spinner.succeed(chalk.green('Database initialized.'));
          } catch (error) {
            spinner.fail(chalk.red('Failed to initialize database!'));
            logger.error(error);
            process.exit(1);
          }
        }

        const schemaStatements: string[] = [];
        for (const file of schemaFiles) {
          const filePath = path.join(cfg.schema, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const sql = splitSqlQuery(content);

          for (const query of sql) {
            if (query.trim().length > 0) {
              schemaStatements.push(query);
            }
          }
        }

        const migrationStatements: string[] = [];
        const spinner = ora(
          chalk.yellow('Calculating migration steps...')
        ).start();
        try {
          const migration = new SqliteMigration(database);
          await migration.migrate(schemaStatements.join(';'));
          if (migration.numberOfChanges) {
            migrationStatements.push(...migration.statements);
          }
          spinner.succeed(chalk.green('Migration steps calculated.'));
        } catch (error) {
          spinner.fail(chalk.red('Failed to calculate migration steps!'));
          logger.error(error);
          process.exit(1);
        }

        if (migrationStatements.length === 0) {
          logger.info(
            chalk.green('No schema changes detected. Database is up to date.')
          );
          return;
        }

        // Output migration steps as a table
        logger.info('');
        logger.info(chalk.bold('Migrations preview:'));
        logger.info(
          chalk.dim('┌' + '─'.repeat(5) + '┬' + '─'.repeat(70) + '┐')
        );
        logger.info(
          chalk.dim('│ ') +
            chalk.bold('Step'.padEnd(3)) +
            chalk.dim(' │ ') +
            chalk.bold('SQL Statement'.padEnd(68)) +
            chalk.dim(' │')
        );
        logger.info(
          chalk.dim('├' + '─'.repeat(5) + '┼' + '─'.repeat(70) + '┤')
        );

        migrationStatements.forEach((stmt, idx) => {
          const lines = stmt.split('\n');
          lines.forEach((line, lineIdx) => {
            logger.info(
              chalk.dim('│ ') +
                (lineIdx === 0 ? String(idx + 1).padEnd(3) : ' '.repeat(3)) +
                chalk.dim(' │ ') +
                line.padEnd(68).slice(0, 68) +
                chalk.dim(' │')
            );
          });
        });

        logger.info(
          chalk.dim('└' + '─'.repeat(5) + '┴' + '─'.repeat(70) + '┘')
        );

        if (args.confirm) {
          const { confirm } = await enquirer.prompt<{ confirm: boolean }>({
            type: 'confirm',
            name: 'confirm',
            message: `Do you want to generate a new migration file with these ${migrationStatements.length} step(s)?`,
            initial: true,
          });
          if (!confirm) {
            logger.info(chalk.yellow('Aborting migration file generation.'));
            return;
          }
        }

        // Generate new migration file
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
          migrationStatements.join(';\n\n') + ';\n',
          'utf-8'
        );
        logger.info(chalk.green(`Migration file created: ${fileName}`));
      } finally {
        await database.close();
      }
    });

const schema = () =>
  new Command('schema')
    .description('Manage database schema')
    .addCommand(generate())
    .addCommand(pull());

export default schema;
