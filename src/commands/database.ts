import { Command } from 'commander';
import { Config } from '../config';
import ora from 'ora';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { Account } from '../account';
import logger from '../logger';
import { Database } from '../database';
import * as server from '../server';
import { build } from '../build';

const reset = (config: () => Config) =>
  new Command('reset').description('Reset the database').action(async () => {
    const cfg = config();
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
      spinner.succeed(chalk.green('Database reset successfully!'));
    } catch {
      spinner.fail(chalk.red('Failed to reset database!'));
    }
  });

const pull = (config: () => Config) =>
  new Command('pull')
    .description('Pull the database from the server')
    .action(async () => {
      const cfg = config();

      const account = new Account({
        baseUrl: cfg.baseUrl,
        dataDirectory: cfg.data,
      });

      const accessToken = await account.accessToken();
      if (!accessToken) {
        logger.error(chalk.red('Not logged in!'));
        return;
      }

      const statements: string[] = [];
      const spinner = ora(
        chalk.yellow('Retrieving database schema...')
      ).start();
      try {
        const database = new Database({
          baseUrl: cfg.baseUrl,
          accessToken,
        });
        const schema = await database.retrieveSchema();
        statements.push(...schema);
        spinner.succeed(chalk.green('Database schema retrieved successfully!'));
      } catch {
        spinner.fail(chalk.red('Failed to retrieve database schema!'));
      }

      const flare = await server.create({
        projectDirectory: cfg.project,
        script: await build({ entryPoints: cfg.entry }),
        database: cfg.data,
      });
      try {
        await flare.ready;
        const spinner = ora(chalk.yellow('Synchronizing database...')).start();
        try {
          const target = await flare.getD1Database('DB');
          await target.batch(statements.map((sql) => target.prepare(sql)));
          spinner.succeed(chalk.green('Database synchronized successfully!'));
        } catch {
          spinner.fail(chalk.red('Failed to synchronize database!'));
        }
      } finally {
        await flare.dispose();
      }
    });

const database = (config: () => Config) =>
  new Command('database')
    .description('Configure the database')
    .addCommand(reset(config))
    .addCommand(pull(config));

export default database;
