import { Config } from '../../config';
import ora from 'ora';
import chalk from 'chalk';
import enquirer from 'enquirer';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import logger from '../../logger';
import * as server from '../../server';
import splitSqlQuery from '../../sql';
import { Database } from '../../database';

export const MIGRATION_TABLE = '_calljmp_migrations';

export interface MigrationFile {
  file: string;
  version: number;
  name: string;
}

export async function collectMigrations(cfg: Config) {
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
  return files;
}

export async function migrateRemote(
  cfg: Config,
  table: string,
  files: MigrationFile[]
) {
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
    .query(`SELECT * FROM ${table}`)
    .catch(() => ({ rows: [] }))
    .then(({ rows }) =>
      rows.map((r: any) => ({
        name: r.name as string,
        hash: r.hash as string,
        version: r.version as number,
      }))
    );

  const executeQueries = async (queries: string[]) => {
    const sql = queries
      .map(query => (query.trim().endsWith(';') ? query : query + ';'))
      .join('\n');
    const etag = crypto.createHash('md5').update(sql).digest('hex');
    const migrationInfo = await database.migrate({ etag });

    let state: {
      completed: boolean;
      bookmark?: string;
    } = migrationInfo;

    if (
      !migrationInfo.completed &&
      migrationInfo.uploadUrl &&
      migrationInfo.filename
    ) {
      state = await database.ingest({
        etag,
        file: new Blob([sql], { type: 'text/plain' }),
        filename: migrationInfo.filename,
        uploadUrl: migrationInfo.uploadUrl,
      });
    }

    while (!state.completed) {
      if (!state.bookmark) {
        throw new Error(
          'Migration bookmark is missing. Please check the migration status.'
        );
      }
      const result = await database.migrationStatus({
        bookmark: state.bookmark,
      });
      state.completed = result.completed;
    }
  };

  logger.info(
    chalk.yellow(
      'WARNING: You are about to apply migrations to the remote database.'
    )
  );
  logger.info(
    chalk.yellow('This operation may modify the production database.')
  );
  logger.info('');

  await runSqlMigrations(table, appliedMigrations, files, executeQueries);
}

export async function migrateLocal(
  cfg: Config,
  table: string,
  files: MigrationFile[]
) {
  const flare = await server.create({
    database: cfg.data,
  });
  try {
    await flare.ready;
    const db = await flare.getD1Database('db');

    const appliedMigrations = await db
      .prepare(`SELECT * FROM ${table}`)
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

    await runSqlMigrations(table, appliedMigrations, files, executeQueries);
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
  table: string,
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
        '─'.repeat(18) +
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
      chalk.bold('Version'.padEnd(16)) +
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
        '─'.repeat(18) +
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
        String(migration.version).padEnd(16) +
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
        '─'.repeat(18) +
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
  if (migrationsToApply.length > 0) {
    const spinner = ora(chalk.yellow('Preparing migrations...')).start();
    try {
      const query = `
        CREATE TABLE IF NOT EXISTS ${table} (
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
        `INSERT INTO ${table} (name, version, hash) VALUES ('${migration.name}', ${migration.version}, '${hash}')`,
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

export function dataToInsertStatements(
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
