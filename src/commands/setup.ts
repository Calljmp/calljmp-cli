import { Command } from 'commander';
import buildConfig, { ConfigOptions, writeConfig } from '../config';
import { configureIgnores, configureService } from '../configure';
import enquirer from 'enquirer';
import ora from 'ora';
import chalk from 'chalk';
import { Account } from '../account';
import logger from '../logger';
import { Project } from '../project';
import { Project as ProjectData } from '../common';

const setup = () =>
  new Command('setup')
    .description('Setup environment, account, and project.')
    .addOption(ConfigOptions.ProjectDirectory)
    .action(async args => {
      const cfg = await buildConfig(args);

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

      let selectedProject = await selectProject({ project });
      if (!selectedProject) {
        selectedProject = await createProject({ project });
        if (!selectedProject) {
          process.exit(1);
        }
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
        entry: cfg.entry,
        types: cfg.types,
      });
    });

async function createProject({ project }: { project: Project }) {
  logger.info(chalk.blue('Creating new project...'));

  const { name, description } = await enquirer.prompt<{
    name: string;
    description?: string;
  }>([
    {
      type: 'input',
      name: 'name',
      message: 'Project name',
      required: true,
      validate: (value: string) => {
        if (!value) {
          return 'Project name is required';
        }
        if (!/^[a-z-]+$/.test(value)) {
          return 'Only lowercase letters and hyphens are allowed';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'description',
      message: 'Project description (optional)',
    },
  ]);

  const spinner = ora(chalk.yellow('Creating project...')).start();
  try {
    const result = await project.create({
      name,
      description: description || undefined,
    });
    spinner.succeed(chalk.green('Project created.'));
    return result;
  } catch (error) {
    spinner.fail(chalk.red('Failed to create project!'));
    throw error;
  }
}

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
      logger.info('Open the following URL to authorize CLI:');
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
