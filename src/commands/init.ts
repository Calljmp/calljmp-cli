import { Command } from 'commander';
import { CliCommonOptions, CliOptions, Config } from '../config';
import { Authentication } from '../authentication';
import { Projects } from '../projects';
import { Agents } from '../agents';

const init = new Command()
  .name('init')
  .description('Initialize your agentic AI workspace with Calljmp.')
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
    await agents.initializeProject(project);
  });

export default init;
