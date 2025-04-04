import { Command } from 'commander';
import { Config } from '../config';
import { Account } from '../account';
import chalk from 'chalk';
import logger from '../logger';
import ora from 'ora';

const login = (config: () => Config) =>
  new Command('login')
    .description('Login to Calljmp')
    .option('--force', 'Force login', false)
    .action(async (args: { force: boolean }) => {
      const cfg = config();

      const account = new Account({
        baseUrl: cfg.baseUrl,
        dataDirectory: cfg.data,
      });

      if (!args.force && (await account.authorized())) {
        logger.info(chalk.green('Already logged in.'));
        return;
      }

      let requestId: string | undefined;

      {
        const spinner = ora(
          chalk.yellow('Requesting authorization...')
        ).start();
        try {
          const { requestId: id, authorizationUrl } =
            await account.requestAccess();
          requestId = id;
          spinner.succeed(chalk.green('Authorization requested.'));
          logger.info('Open the following URL to authorize:');
          logger.info(chalk.blue(authorizationUrl));
        } catch {
          spinner.fail(chalk.red('Failed to request authorization!'));
          return;
        }
      }

      {
        const spinner = ora(
          chalk.yellow('Waiting for authorization...')
        ).start();
        try {
          await account.pollAccess(requestId);
          spinner.succeed(chalk.green('Authorized successfully.'));
        } catch {
          spinner.fail(chalk.red('Authorization failed!'));
          return;
        }
      }
    });

const logout = (config: () => Config) =>
  new Command('logout').description('Logout from Calljmp').action(async () => {
    const cfg = config();

    const account = new Account({
      baseUrl: cfg.baseUrl,
      dataDirectory: cfg.data,
    });

    await account.reset();
    logger.info(chalk.green('Logged out successfully.'));
  });

const account = (config: () => Config) =>
  new Command('account')
    .description('Account management')
    .addCommand(login(config))
    .addCommand(logout(config));

export default account;
