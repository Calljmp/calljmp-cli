import { Command } from 'commander';
import buildConfig, { ConfigOptions } from '../config';
import ora from 'ora';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import logger from '../logger';
import { Database } from '../database';
import * as server from '../server';
import { build } from '../build';

const reset = () =>
  new Command('reset')
    .description('Reset the database')
    .addOption(ConfigOptions.ProjectDirectory)
    .action(async (args) => {
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
        spinner.succeed(chalk.green('Database reset successfully!'));
      } catch {
        spinner.fail(chalk.red('Failed to reset database!'));
      }
    });

const pull = () =>
  new Command('pull')
    .description('Pull the database from the server')
    .addOption(ConfigOptions.ProjectDirectory)
    .action(async (args) => {
      const cfg = await buildConfig(args);

      if (!cfg.accessToken || !cfg.projectId) {
        logger.error(chalk.red('Please run setup first!'));
        process.exit(1);
      }

      const statements: string[] = [];
      const spinner = ora(
        chalk.yellow('Retrieving database schema...')
      ).start();
      try {
        const database = new Database({
          baseUrl: cfg.baseUrl,
          accessToken: cfg.accessToken,
          projectId: cfg.projectId,
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

const database = () =>
  new Command('database')
    .description('Configure the database')
    .addCommand(reset())
    .addCommand(pull());

export default database;
