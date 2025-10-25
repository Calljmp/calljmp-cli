import { Command } from 'commander';
import { CliCommonOptions, CliOptions, Config } from '../config';
import { Authentication } from '../authentication';

const reset = new Command()
  .name('reset')
  .description('Reset your account authentication.')
  .addOption(CliCommonOptions.project)
  .addOption(CliCommonOptions.baseUrl)
  .action(async (options: CliOptions) => {
    const config = new Config(options);

    const auth = new Authentication(config);
    auth.reset();
  });

const account = new Command()
  .name('account')
  .description('Manage your account with Calljmp.')
  .addCommand(reset)
  .showHelpAfterError()
  .addOption(CliCommonOptions.project)
  .addOption(CliCommonOptions.baseUrl)
  .action(async (options: CliOptions) => {
    const config = new Config(options);

    const auth = new Authentication(config);
    await auth.authorize();
  });

export default account;
