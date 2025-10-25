import { Command } from 'commander';
import { CliCommonOptions, CliOptions, Config } from '../config';
import { Projects } from '../projects';
import { Authentication } from '../authentication';

const reset = new Command()
  .name('reset')
  .description('Reset the current project selection.')
  .addOption(CliCommonOptions.project)
  .addOption(CliCommonOptions.baseUrl)
  .action(async (options: CliOptions) => {
    const config = new Config(options);

    const projects = new Projects(config);
    projects.resetSelection();
  });

const project = new Command()
  .name('project')
  .description('Manage your projects with Calljmp.')
  .showHelpAfterError()
  .addCommand(reset)
  .addOption(CliCommonOptions.project)
  .addOption(CliCommonOptions.baseUrl)
  .action(async (options: CliOptions) => {
    const config = new Config(options);

    const authentication = new Authentication(config);
    if (!authentication.authorized) {
      await authentication.authorize();
    }

    const projects = new Projects(config);
    await projects.select();
  });

export default project;
