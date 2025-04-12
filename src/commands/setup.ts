import { Command } from 'commander';
import buildConfig, { ConfigOptions, writeConfig } from '../config';
import {
  configureDependencies,
  configureIgnores,
  configureService,
} from '../configure';
import enquirer from 'enquirer';
import ora from 'ora';
import chalk from 'chalk';
import { Account } from '../account';
import logger from '../logger';
import { Project } from '../project';
import { Project as ProjectData } from '../common';
import fs from 'fs/promises';

const setup = () =>
  new Command('setup')
    .description('Setup environment, account, and project.')
    .option('--no-hono', 'Do not use Hono')
    .addOption(ConfigOptions.ProjectDirectory)
    .action(async args => {
      const cfg = await buildConfig(args);

      const { installDependencies } = await enquirer.prompt<{
        installDependencies: boolean;
      }>({
        type: 'confirm',
        name: 'installDependencies',
        message: 'Install dependencies?',
        initial: true,
      });

      if (installDependencies) {
        await configureDependencies({
          directory: cfg.project,
        });
      }

      const account = new Account(cfg);
      const authorized = await account.authorized();
      if (!authorized) {
        const result = await login(account);
        if (!result) {
          process.exit(1);
        }
        cfg.accessToken = result.accessToken;
        await writeConfig(cfg);
      }

      if (!cfg.accessToken) {
        logger.error(chalk.red('No authorization token found!'));
        process.exit(1);
      }

      const project = new Project({
        baseUrl: cfg.baseUrl,
        accessToken: cfg.accessToken,
      });

      const selectedProject = await selectProject({ project });
      if (!selectedProject) {
        process.exit(1);
      }
      if (cfg.projectId !== selectedProject.id) {
        cfg.projectId = selectedProject.id;
        await writeConfig(cfg);
      }

      await configureIgnores({
        directory: cfg.project,
        entries: ['.calljmp', '.service.env', '.env'],
      });

      await configureService({
        directory: cfg.project,
        service: cfg.service,
        hono: args.hono,
      });

      // Generate the service code if it doesn't exist
      const exists = await fs
        .access(cfg.entry, fs.constants.R_OK)
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        const content = `
import { Service } from './service';

const service = Service();

service.get('/hello', async (c) => {
  return c.json({
    message: 'Hello, world!',
  });
});

export default service;
        `.trim();
        await fs.writeFile(cfg.entry, content, 'utf-8');
        logger.info(chalk.blue(`Created ${cfg.entry}`));
      }
    });

async function selectProject({
  project,
  offset,
}: {
  project: Project;
  offset?: number;
}): Promise<ProjectData | undefined> {
  const { projects, nextOffset } = await project.list({ offset });

  if (projects.length === 0) {
    logger.error(chalk.red('No projects found!'));
    return;
  }

  const choices = [
    ...projects.map(project => ({
      name: project.name,
      value: project.name,
    })),
    ...(nextOffset
      ? [
          {
            name: 'More projects...',
            value: -1,
          },
        ]
      : []),
  ];

  const selection = await enquirer.prompt<{
    value: number | string;
  }>({
    type: 'autocomplete',
    name: 'value',
    message: 'Select a project',
    choices,
  });

  if (selection.value === -1) {
    return selectProject({
      project,
      offset: nextOffset,
    });
  }

  const result = projects.find(project => project.name === selection.value);
  if (!result) {
    logger.error(chalk.red('Project not found!'));
    return;
  }

  return result;
}

async function login(account: Account) {
  let requestId: string | undefined;

  {
    const spinner = ora(chalk.yellow('Requesting authorization...')).start();
    try {
      const { requestId: id, authorizationUrl } = await account.requestAccess();
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
    const spinner = ora(chalk.yellow('Waiting for authorization...')).start();
    try {
      const result = await account.pollAccess(requestId);
      spinner.succeed(chalk.green('Authorized.'));
      return result;
    } catch {
      spinner.fail(chalk.red('Authorization failed!'));
      return;
    }
  }
}

export default setup;
