import { Command } from 'commander';
import buildConfig, { ConfigOptions } from '../../config';
import ora from 'ora';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import logger from '../../logger';
import * as server from '../../server';
import { build } from '../../build';
import schema from './schema';
import { Database } from '../../database';
import {
  collectMigrations,
  dataToInsertStatements,
  migrateLocal,
  migrateRemote,
  MIGRATION_TABLE,
} from './migration';

const reset = () =>
  new Command('reset')
    .description('Reset the database')
    .addOption(ConfigOptions.ProjectDirectory)
    .action(async args => {
      const cfg = await buildConfig(args);

      const spinner = ora(chalk.yellow('Resetting database...')).start();
      try {
        const files = await fs.readdir(cfg.data).catch(() => []);
        for (const file of files) {
          const filePath = path.join(cfg.data, file);
          const stat = await fs.stat(filePath);
          if (stat.isDirectory() && file.includes('D1Database')) {
            await fs.rm(filePath, { recursive: true, force: true });
          }
        }
        spinner.succeed(chalk.green('Database reset.'));
      } catch {
        spinner.fail(chalk.red('Failed to reset database!'));
      }
    });

function collectTables(value: string, previous: string[]) {
  return previous.concat([value]);
}

const pull = () =>
  new Command('pull')
    .description('Pull the database from the server')
    .addOption(ConfigOptions.ProjectDirectory)
    .option(
      '--migrations-table [table]',
      'Migrations table name',
      MIGRATION_TABLE
    )
    .option('--table-data [table]', 'Table data to pull', collectTables, [])
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

      {
        const entries: {
          table: string;
          label: string;
        }[] = [
          {
            table: args.migrationsTable,
            label: 'migrations',
          },
          ...args.tableData.map((table: string) => ({
            table,
            label: table,
          })),
        ];

        for (const entry of entries) {
          const spinner = ora(
            chalk.yellow(`Retrieving table data for ${entry.label}...`)
          ).start();
          try {
            const data = await database.query(`SELECT * FROM ${entry.table}`);
            const insertStatements = dataToInsertStatements(
              entry.table,
              data.rows
            );
            statements.push(...insertStatements);
            spinner.succeed(
              chalk.green(`Table data for ${entry.label} retrieved.`)
            );
          } catch (error) {
            if (entry.label === 'migrations') {
              spinner.info(chalk.dim('Skipping migrations table data.'));
            } else {
              spinner.fail(
                chalk.red(`Failed to retrieve table data for ${entry.label}!`)
              );
              logger.error(error);
              process.exit(1);
            }
          }
        }
      }

      const flare = await server.create({
        script: await build({ entryPoints: cfg.entry, debug: true }),
        database: cfg.data,
      });
      try {
        await flare.ready;
        const spinner = ora(chalk.yellow('Synchronizing database...')).start();
        try {
          const db = await flare.getD1Database('db');
          await db.batch(statements.map(sql => db.prepare(sql)));
          spinner.succeed(chalk.green('Database synchronized.'));
        } catch (error) {
          spinner.fail(chalk.red('Failed to synchronize database!'));
          logger.error(error);
          process.exit(1);
        }
      } finally {
        await flare.dispose();
      }
    });

const migrate = () =>
  new Command('migrate')
    .description('Migrate the database')
    .addOption(ConfigOptions.ProjectDirectory)
    .option(
      '--migrations-table [table]',
      'Migrations table name',
      MIGRATION_TABLE
    )
    .option('--remote', 'Migrate the database to the remote server')
    .action(async args => {
      const cfg = await buildConfig(args);
      const files = await collectMigrations(cfg);

      if (files.length === 0) {
        logger.warn(
          chalk.yellow(
            `No SQL migrations found in ./${path.relative(cfg.project, cfg.migrations)} directory`
          )
        );
        process.exit(1);
      }

      if (args.remote) {
        await migrateRemote(cfg, args.migrationsTable, files);
      } else {
        await migrateLocal(cfg, args.migrationsTable, files);
      }
    });

const database = () =>
  new Command('database')
    .description('Configure the database')
    .addCommand(schema())
    .addCommand(migrate())
    .addCommand(reset())
    .addCommand(pull());

export default database;
