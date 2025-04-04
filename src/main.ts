import { Command } from 'commander';
import figlet from 'figlet';
import gradient from 'gradient-string';
import path from 'path';
import logger from './logger';
import * as server from './server';
import {
  configureDependencies,
  configureIgnores,
  configureTypes,
} from './configuration';
import { Account } from './account';
import chalk from 'chalk';
import ora from 'ora';
import { Database } from './database';
import { build } from './build';
import fs from 'fs/promises';

const brand = gradient(['#28e2ad', '#0b77e6']);

const title = figlet.textSync('calljmp', {
  font: 'Speed',
  horizontalLayout: 'default',
  verticalLayout: 'default',
  width: 80,
  whitespaceBreak: false,
});

console.log(brand(title));
console.log();

const program = new Command();

program
  .name('calljmp')
  .description('CLI for Calljmp')
  .option('-d, --dir <directory>', 'Project directory', '.')
  .option('-m, --module <directory>', 'Module directory', './src/service');

const config = () => {
  const projectDirectory = path.resolve(process.cwd(), program.opts().dir);
  const moduleDirectory = path.resolve(projectDirectory, program.opts().module);

  return {
    baseUrl: process.env.CALLJMP_BASE_URL || 'https://api.calljmp.com',
    project: projectDirectory,
    module: moduleDirectory,
    data: path.join(projectDirectory, '.calljmp'),
    entry: path.join(moduleDirectory, 'service.ts'),
    types: path.join(moduleDirectory, 'service.d.ts'),
  };
};

const requestLogin = async ({ force }: { force?: boolean } = {}) => {
  const cfg = config();

  const account = new Account({
    baseUrl: cfg.baseUrl,
    dataDirectory: cfg.data,
  });

  if (!force && (await account.authorized())) {
    logger.info(chalk.green('Already authorized!'));
    return;
  }

  let requestId: string | undefined;

  {
    const spinner = ora(chalk.yellow('Requesting authorization...')).start();
    try {
      const { requestId: id, authorizationUrl } = await account.requestAccess();
      requestId = id;
      spinner.succeed(chalk.green('Authorization requested!'));
      logger.info('Open the following URL to authorize:');
      logger.info(chalk.blue(authorizationUrl));
    } catch {
      spinner.fail(chalk.red('Failed to request authorization!'));
      return false;
    }
  }

  {
    const spinner = ora(chalk.yellow('Waiting for authorization...')).start();
    try {
      await account.pollAccess(requestId);
      spinner.succeed(chalk.green('Authorized successfully!'));
    } catch {
      spinner.fail(chalk.red('Authorization failed!'));
      return false;
    }
  }

  return true;
};

program
  .command('login')
  .description('Login to Calljmp')
  .option('--force', 'Force login', false)
  .action(async (args) => {
    await requestLogin(args);
  });

program
  .command('logout')
  .description('Logout from Calljmp')
  .action(async () => {
    const cfg = config();

    const account = new Account({
      baseUrl: cfg.baseUrl,
      dataDirectory: cfg.data,
    });

    await account.reset();
    logger.info(chalk.green('Logged out successfully!'));
  });

program
  .command('configure')
  .description('Configure the project')
  .option('--types', 'Generate types')
  .option('--ignores', 'Generate ignores')
  .action(async (args) => {
    const automated = !!args.types || !!args.ignores;
    const ignores = ['.calljmp', '.service.env', '.env'];

    const cfg = config();

    if (!automated) {
      await configureDependencies({
        directory: cfg.project,
      });
      await configureIgnores({
        directory: cfg.project,
        entries: ignores,
      });
      await configureTypes({
        directory: cfg.project,
        types: cfg.types,
      });
    } else {
      if (args.types) {
        await configureTypes({
          directory: cfg.project,
          types: cfg.types,
        });
      }
      if (args.ignores) {
        await configureIgnores({
          directory: cfg.project,
          entries: ignores,
        });
      }
    }
  });

program
  .command('database')
  .description('Configure the database')
  .addCommand(
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
    })
  )
  .addCommand(
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
          spinner.succeed(
            chalk.green('Database schema retrieved successfully!')
          );
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
          const spinner = ora(
            chalk.yellow('Synchronizing database...')
          ).start();
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
      })
  );

program
  .command('start')
  .description('Start the server')
  .option('-p, --port <number>', 'Port to run the server', parseInt, 8787)
  .option('--pd, --persist-database', 'Persist the database', false)
  .action(async (args) => {
    const cfg = config();
    await server.serve({
      projectDirectory: cfg.project,
      moduleDirectory: cfg.module,
      entryPoints: cfg.entry,
      port: args.port,
      database: args.persistDatabase ? cfg.data : undefined,
    });
  });

async function main() {
  if (process.argv.length < 3) {
    program.help();
  } else {
    program.parse(process.argv);
  }
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
