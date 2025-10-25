import { Command } from 'commander';
import { CliCommonOptions, CliOptions, Config } from '../config';
import { Authentication } from '../authentication';
import { Projects } from '../projects';
import { Agents } from '../agents';

const deploy = new Command()
  .name('deploy')
  .description('Deploy a new agent to your project.')
  .addOption(CliCommonOptions.project)
  .addOption(CliCommonOptions.baseUrl)
  .action(async (options: CliOptions) => {
    const config = new Config(options);

    const authentication = new Authentication(config);
    if (!authentication.authorized) {
      await authentication.authorize();
    }

    const projects = new Projects(config);
    if (!projects.hasSelected) {
      await projects.select();
    }

    const project = await projects.selected();

    const agents = new Agents(config);
    await agents.deploy(project);
  });

const run = new Command()
  .name('run')
  .description('Run an agent.')
  .addOption(CliCommonOptions.project)
  .addOption(CliCommonOptions.baseUrl)
  .option('-i, --input [JSON]', 'Input to the agent')
  .action(
    async (
      options: CliOptions & {
        input?: string;
      }
    ) => {
      const config = new Config(options);

      const authentication = new Authentication(config);
      if (!authentication.authorized) {
        await authentication.authorize();
      }

      const projects = new Projects(config);
      if (!projects.hasSelected) {
        await projects.select();
      }

      const project = await projects.selected();

      const agents = new Agents(config);
      const { id } = await agents.deploy(project);
      await agents.run(
        project,
        id,
        options.input ? JSON.parse(options.input) : undefined
      );
    }
  );

const agent = new Command()
  .name('agent')
  .description('Manage your agents.')
  .showHelpAfterError()
  .showSuggestionAfterError()
  .addCommand(deploy)
  .addCommand(run);

export default agent;
