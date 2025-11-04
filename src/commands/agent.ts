import { Command, Option } from 'commander';
import { CliCommonOptions, CliOptions, Config } from '../config';
import { Authentication } from '../authentication';
import { Projects } from '../projects';
import { Agents } from '../agents';

const Options = {
  name: new Option(
    '-n, --name <name>',
    'Name of the agent (e.g. index, main)'
  ).default('index', '/index.ts file'),
  input: new Option('-i, --input [JSON]', 'Input to the agent'),
};

const deploy = new Command()
  .name('deploy')
  .description('Deploy a new agent to your project.')
  .addOption(CliCommonOptions.project)
  .addOption(CliCommonOptions.baseUrl)
  .addOption(Options.name)
  .action(
    async (
      options: CliOptions & {
        name: string;
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
      await agents.deploy(project, { entryPoint: options.name });
    }
  );

const run = new Command()
  .name('run')
  .description('Run an agent.')
  .addOption(CliCommonOptions.project)
  .addOption(CliCommonOptions.baseUrl)
  .addOption(Options.name)
  .addOption(Options.input)
  .action(
    async (
      options: CliOptions & {
        input?: string;
        name: string;
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
      const { id: deploymentId } = await agents.deploy(project, {
        entryPoint: options.name,
      });
      await agents.run(
        project,
        deploymentId,
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
