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
  .option(
    '-f, --force',
    'Force redeployment of the agent even if the code has not changed'
  )
  .addOption(CliCommonOptions.project)
  .addOption(CliCommonOptions.baseUrl)
  .addOption(Options.name)
  .action(
    async (
      options: CliOptions & {
        name: string;
        force?: boolean;
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
      await agents.deploy(project, {
        entryPoint: options.name,
        force: options.force,
      });
    }
  );

const run = new Command()
  .name('run')
  .description('Run an agent.')
  .option(
    '-f, --force-deploy',
    'Force redeployment of the agent before running'
  )
  .addOption(CliCommonOptions.project)
  .addOption(CliCommonOptions.baseUrl)
  .addOption(Options.name)
  .addOption(Options.input)
  .action(
    async (
      options: CliOptions & {
        input?: string;
        name: string;
        forceDeploy?: boolean;
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
        force: options.forceDeploy,
      });
      await agents.run(
        project,
        deploymentId,
        options.input ? JSON.parse(options.input) : undefined
      );
    }
  );

const resume = new Command()
  .name('resume')
  .description('Resume an agent.')
  .option(
    '-r, --resumption <resumption>',
    'Resumption token to continue the agent run'
  )
  .option('-t, --target <target>', 'Target run ID to resume the agent run')
  .addOption(CliCommonOptions.project)
  .addOption(CliCommonOptions.baseUrl)
  .addOption(Options.name)
  .addOption(Options.input)
  .action(
    async (
      options: CliOptions & {
        input?: string;
        resumption: string;
        target: string;
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
      await agents.resume(
        project,
        options.target,
        options.resumption,
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
  .addCommand(run)
  .addCommand(resume);

export default agent;
