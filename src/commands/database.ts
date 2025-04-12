import { Command } from 'commander';
import buildConfig, { Config, ConfigOptions } from '../config';
import ora from 'ora';
import chalk from 'chalk';
import enquirer from 'enquirer';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import logger from '../logger';
import { Database } from '../database';
import * as server from '../server';
import { build } from '../build';
import { readVariables } from '../env';
import splitSqlQuery from '../sql';

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
    .option('--migrations-table <table>', 'Migrations table name')
    .option('--table-data <table>', 'Table data to pull', collectTables, [])
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
            table: args.migrationsTable || migrationsTable,
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
            spinner.fail(
              chalk.red(`Failed to retrieve table data for ${entry.label}!`)
            );
            logger.error(error);
            process.exit(1);
          }
        }
      }

      const envs = await readVariables(cfg.project);

      const flare = await server.create({
        script: await build({ entryPoints: cfg.entry, debug: true }),
        database: cfg.data,
        bindings: envs,
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

interface MigrationFile {
  file: string;
  version: number;
  name: string;
}

const migrate = () =>
  new Command('migrate')
    .description('Migrate the database')
    .addOption(ConfigOptions.ProjectDirectory)
    .option('--remote', 'Migrate the database to the remote server')
    .action(async args => {
      const cfg = await buildConfig(args);

      const filePattern = /^(\d+)[-_]([a-zA-Z0-9-_]+)\.sql$/;

      const files: MigrationFile[] = await fs
        .readdir(cfg.migrations)
        .catch<string[]>(() => [])
        .then(files =>
          files
            .map(file => {
              const match = file.match(filePattern);
              if (!match) {
                return null;
              }
              return {
                file: path.join(cfg.migrations, file),
                version: parseInt(match[1], 10),
                name: match[2],
              };
            })
            .filter(file => file !== null)
        );

      files.sort((a, b) => a.version - b.version);

      if (files.length === 0) {
        logger.warn(
          chalk.yellow(
            `No SQL migrations found in ./${path.relative(cfg.project, cfg.migrations)} directory`
          )
        );
        process.exit(1);
      }

      if (args.remote) {
        await migrateRemote(cfg, files);
      } else {
        await migrateLocal(cfg, files);
      }
    });

const migrationsTable = '_calljmp_migrations';

async function migrateRemote(cfg: Config, files: MigrationFile[]) {
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

  const appliedMigrations = await database
    .query(`SELECT * FROM ${migrationsTable}`)
    .catch(() => ({ rows: [] }))
    .then(({ rows }) =>
      rows.map((r: any) => ({
        name: r.name as string,
        hash: r.hash as string,
        version: r.version as number,
      }))
    );

  const executeQueries = async (queries: string[]) => {
    for (const query of queries) {
      await database.query(query);
    }
  };

  logger.info(
    chalk.blue('You are about to apply migrations to the remote database.')
  );
  logger.info(chalk.blue('This operation may modify the production database.'));
  logger.info('');

  await runSqlMigrations(appliedMigrations, files, executeQueries);
}

async function migrateLocal(cfg: Config, files: MigrationFile[]) {
  const flare = await server.create({
    database: cfg.data,
  });
  try {
    await flare.ready;
    const db = await flare.getD1Database('db');

    const appliedMigrations = await db
      .prepare(`SELECT * FROM ${migrationsTable}`)
      .all()
      .catch(() => ({ results: [] }))
      .then(({ results }) =>
        results.map((r: any) => ({
          name: r.name as string,
          hash: r.hash as string,
          version: r.version as number,
        }))
      );

    const executeQueries = async (queries: string[]) => {
      await db.batch(queries.map(query => db.prepare(query)));
    };

    await runSqlMigrations(appliedMigrations, files, executeQueries);
  } catch (error) {
    if (error instanceof Error) {
      logger.error(error);
    } else {
      logger.error(chalk.red('Unknown error occurred!'));
    }
    process.exit(1);
  } finally {
    await flare.dispose();
  }
}

async function runSqlMigrations(
  appliedMigrations: {
    name: string;
    hash: string;
    version: number;
  }[],
  migrations: MigrationFile[],
  executeQueries: (queries: string[]) => Promise<void>
) {
  logger.info('Migration status:');
  logger.info(
    chalk.dim(
      '┌' +
        '─'.repeat(10) +
        '┬' +
        '─'.repeat(32) +
        '┬' +
        '─'.repeat(17) +
        '┬' +
        '─'.repeat(17) +
        '┐'
    )
  );
  logger.info(
    chalk.dim('│ ') +
      chalk.bold('Version'.padEnd(8)) +
      chalk.dim(' │ ') +
      chalk.bold('Name'.padEnd(30)) +
      chalk.dim(' │ ') +
      chalk.bold('Status'.padEnd(15)) +
      chalk.dim(' │ ') +
      chalk.bold('Action'.padEnd(15)) +
      chalk.dim(' │')
  );
  logger.info(
    chalk.dim(
      '├' +
        '─'.repeat(10) +
        '┼' +
        '─'.repeat(32) +
        '┼' +
        '─'.repeat(17) +
        '┼' +
        '─'.repeat(17) +
        '┤'
    )
  );

  for (const migration of migrations) {
    const applied = appliedMigrations.some(
      appliedMigration => appliedMigration.name === migration.name
    );
    const willApply = !applied;

    logger.info(
      chalk.dim('│ ') +
        String(migration.version).padEnd(8) +
        chalk.dim(' │ ') +
        migration.name.padEnd(30) +
        chalk.dim(' │ ') +
        (applied
          ? chalk.green('Applied'.padEnd(15))
          : chalk.gray('Not applied'.padEnd(15))) +
        chalk.dim(' │ ') +
        (willApply
          ? chalk.yellow('Will apply'.padEnd(15))
          : chalk.gray('No action'.padEnd(15))) +
        chalk.dim(' │')
    );
  }
  logger.info(
    chalk.dim(
      '└' +
        '─'.repeat(10) +
        '┴' +
        '─'.repeat(32) +
        '┴' +
        '─'.repeat(17) +
        '┴' +
        '─'.repeat(17) +
        '┘'
    )
  );
  logger.info(
    chalk.dim(
      `Applied migrations: ${appliedMigrations.length}/${migrations.length}`
    )
  );

  const migrationsToApply = migrations.filter(
    migration =>
      !appliedMigrations.some(
        appliedMigration => appliedMigration.name === migration.name
      )
  );
  if (migrationsToApply.length > 0) {
    const { confirm } = await enquirer.prompt<{ confirm: boolean }>({
      type: 'confirm',
      name: 'confirm',
      message: `Do you want to apply ${migrationsToApply.length} migration${migrationsToApply.length > 1 ? 's' : ''}?`,
      initial: true,
    });

    if (!confirm) {
      logger.info(chalk.yellow('Aborting migration.'));
      return;
    }
  }

  // Apply the initial migration to create the migrations table
  {
    const spinner = ora(chalk.yellow('Preparing migrations...')).start();
    try {
      const query = `
        CREATE TABLE IF NOT EXISTS ${migrationsTable} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          version INTEGER NOT NULL,
          hash TEXT NOT NULL
        );
      `;
      await executeQueries([query]);
    } finally {
      spinner.stop();
    }
  }

  for (const migration of migrations) {
    const content = await fs.readFile(migration.file, 'utf-8');
    const hash = await crypto.subtle
      .digest('SHA-256', Buffer.from(content, 'utf-8'))
      .then(buffer => Buffer.from(buffer).toString('hex'));

    const lastMigration = appliedMigrations.find(
      appliedMigration => appliedMigration.name === migration.name
    );

    if (lastMigration) {
      if (lastMigration.hash != hash) {
        logger.error(
          chalk.red(
            `Migration ${migration.version} (${migration.name}) has been modified. Please revert the changes or create a new migration.`
          )
        );
        continue;
      }

      logger.info(chalk.gray(`✓ ${migration.version}: ${migration.name}`));
      continue;
    }

    const spinner = ora(
      chalk.yellow(
        `Applying migration ${migration.version}: ${migration.name}...`
      )
    ).start();
    try {
      const sql = [
        content,
        `INSERT INTO ${migrationsTable} (name, version, hash) VALUES ('${migration.name}', ${migration.version}, '${hash}')`,
      ].join(';');

      const queries = splitSqlQuery(sql);
      await executeQueries(queries);

      spinner.stop();
      logger.info(chalk.green(`✓ ${migration.version}: ${migration.name}`));
    } catch (error) {
      spinner.stop();
      logger.error(chalk.red(`✗ ${migration.version}: ${migration.name}`));
      throw error;
    }
  }
}

function dataToInsertStatements(
  tableName: string,
  data: Record<string, unknown>[]
): string[] {
  if (data.length === 0) {
    return [];
  }
  const columns = Object.keys(data[0]);
  const inserts = data.map(row => {
    const values = columns.map(column => {
      const value = row[column];
      if (typeof value === 'string') {
        return `'${value.replace(/'/g, "''")}'`;
      }
      return String(value);
    });
    return `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${values.join(
      ', '
    )});`;
  });
  return inserts;
}

const database = () =>
  new Command('database')
    .description('Configure the database')
    .addCommand(migrate())
    .addCommand(reset())
    .addCommand(pull());

export default database;
