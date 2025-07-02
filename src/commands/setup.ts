import { Command } from 'commander';
import buildConfig, { ConfigOptions, writeConfig } from '../config';
import { configureIgnores, configureService } from '../configure';
import enquirer from 'enquirer';
import ora from 'ora';
import chalk from 'chalk';
import { Account } from '../account';
import logger from '../logger';
import { Project } from '../project';
import {
  Project as ProjectData,
  ServiceError,
  ServiceErrorCode,
} from '../common';
import path from 'path';
import retry from '../retry';
import * as ios from '../ios';
import * as android from '../android';

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
      cfg.projectId = selectedProject.id;

      // wait for project to be provisioned
      {
        const spinner = ora(
          chalk.blue('Waiting for project to be provisioned...')
        ).start();
        try {
          await retry(() => project.retrieve({ projectId: cfg.projectId! }), {
            retries: 10,
            delay: 3000,
            shouldRetry: error => {
              if (
                error instanceof ServiceError &&
                error.code === ServiceErrorCode.ResourceBusy
              ) {
                return true;
              }
              return false;
            },
          });
          spinner.stop();
        } catch (error) {
          spinner.fail(
            chalk.red(
              'Timed out waiting for project to be provisioned! Please try again later.'
            )
          );
          logger.error(error);
          process.exit(1);
        }
      }

      const iosProjectInfo = await ios
        .resolveProjectInfo({ projectDirectory: cfg.project })
        .catch(() => null);
      if (iosProjectInfo) {
        let bundleId: string | undefined = iosProjectInfo.bundleId;
        let teamId: string | undefined = iosProjectInfo.teamId;

        const promptForBundleId = () =>
          enquirer.prompt<{
            newBundleId: string;
          }>({
            type: 'input',
            name: 'newBundleId',
            message: 'Enter iOS Bundle ID (or leave blank to skip):',
            initial: bundleId,
            validate: (value: string) => {
              if (!value) return true; // allow skip
              if (!/^[a-zA-Z0-9.-]+$/.test(value)) {
                return 'Invalid iOS Bundle ID format';
              }
              return true;
            },
          });

        const promptForTeamId = () =>
          enquirer.prompt<{ newTeamId: string }>({
            type: 'input',
            name: 'newTeamId',
            message: 'Enter Apple Team ID (or leave blank to skip):',
            initial: teamId,
            validate: (value: string) => {
              if (!value) return true; // allow skip
              if (!/^[A-Z0-9]{10}$/.test(value)) {
                return 'Invalid Apple Team ID format';
              }
              return true;
            },
          });

        const { confirmBundleId } = await enquirer.prompt<{
          confirmBundleId: boolean;
        }>({
          type: 'confirm',
          name: 'confirmBundleId',
          message: `iOS Bundle ID: ${bundleId}. Use this value?`,
          initial: true,
        });

        if (!confirmBundleId) {
          const { newBundleId } = await promptForBundleId();
          bundleId = newBundleId || undefined;
        }

        if (teamId) {
          const { confirmTeamId } = await enquirer.prompt<{
            confirmTeamId: boolean;
          }>({
            type: 'confirm',
            name: 'confirmTeamId',
            message: `Apple Team ID: ${teamId}. Use this value?`,
            initial: true,
          });
          if (!confirmTeamId) {
            const { newTeamId } = await promptForTeamId();
            teamId = newTeamId || undefined;
          }
        } else {
          const { newTeamId } = await promptForTeamId();
          teamId = newTeamId || undefined;
        }

        if (teamId || bundleId) {
          const spinner = ora(chalk.blue('Configuring iOS project...')).start();
          try {
            selectedProject = await project.update({
              projectId: cfg.projectId!,
              appleIosTeamId: teamId,
              appleIosBundleId: bundleId,
            });
            spinner.stop();
          } catch (error) {
            spinner.fail(chalk.red('Failed to configure iOS project!'));
            logger.error(error);
            process.exit(1);
          }
        }
      }

      const androidProjectInfo = await android
        .resolveProjectInfo({ projectDirectory: cfg.project })
        .catch(() => null);
      if (androidProjectInfo) {
        let applicationId: string | undefined =
          androidProjectInfo.applicationId;

        const promptForApplicationId = () =>
          enquirer.prompt<{
            newApplicationId: string;
          }>({
            type: 'input',
            name: 'newApplicationId',
            message: 'Enter Android Application ID (or leave blank to skip):',
            initial: applicationId,
            validate: (value: string) => {
              if (!value) return true; // allow skip
              if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
                return 'Invalid Android Application ID format';
              }
              return true;
            },
          });

        const { confirmApplicationId } = await enquirer.prompt<{
          confirmApplicationId: boolean;
        }>({
          type: 'confirm',
          name: 'confirmApplicationId',
          message: `Android Application ID: ${applicationId}. Use this value?`,
          initial: true,
        });

        if (!confirmApplicationId) {
          const { newApplicationId } = await promptForApplicationId();
          applicationId = newApplicationId || undefined;
        }

        if (applicationId) {
          const spinner = ora(
            chalk.blue('Configuring Android project...')
          ).start();
          try {
            selectedProject = await project.update({
              projectId: cfg.projectId!,
              googleAndroidPackageName: applicationId,
            });
            spinner.stop();
          } catch (error) {
            spinner.fail(chalk.red('Failed to configure Android project!'));
            logger.error(error);
            process.exit(1);
          }
        }
      }

      const { module, migrations, schema } = await enquirer.prompt<{
        module: string;
        migrations: string;
        schema: string;
      }>([
        {
          type: 'input',
          name: 'module',
          message: 'Service module directory',
          initial: path.relative(cfg.project, cfg.module),
          required: true,
          validate: (value: string) => {
            if (!value) {
              return 'Service module directory is required';
            }
            return true;
          },
        },
        {
          type: 'input',
          name: 'migrations',
          message: 'Migrations directory',
          initial: path.relative(cfg.project, cfg.migrations),
          required: true,
          validate: (value: string) => {
            if (!value) {
              return 'Migrations directory is required';
            }
            return true;
          },
        },
        {
          type: 'input',
          name: 'schema',
          message: 'Schema directory',
          initial: path.relative(cfg.project, cfg.schema),
          required: true,
          validate: (value: string) => {
            if (!value) {
              return 'Schema directory is required';
            }
            return true;
          },
        },
      ]);

      let bindings: Record<string, unknown> = {};
      {
        const spinner = ora(
          chalk.blue('Synchronizing service bindings...')
        ).start();
        try {
          bindings = await project.bindings({
            projectId: cfg.projectId!,
          });
          spinner.stop();
        } catch (error) {
          spinner.fail(chalk.red('Failed to synchronize service bindings!'));
          logger.error(error);
          process.exit(1);
        }
      }

      function printBindingsTree(
        bindings: Record<string, unknown>,
        indent = ''
      ) {
        Object.entries(bindings).forEach(([key, value], index, array) => {
          const isLast = index === array.length - 1;
          const prefix = isLast ? '└── ' : '├── ';
          const nextIndent = indent + (isLast ? '    ' : '│   ');

          if (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value)
          ) {
            logger.info(`${indent}${chalk.dim(prefix)}${key}`);
            printBindingsTree(value as Record<string, unknown>, nextIndent);
          } else {
            logger.info(`${indent}${chalk.dim(prefix)}${key}: ${value}`);
          }
        });
      }

      logger.info('Service bindings');
      printBindingsTree(bindings);

      cfg.module = path.resolve(cfg.project, module);
      cfg.migrations = path.resolve(cfg.project, migrations);
      cfg.schema = path.resolve(cfg.project, schema);
      cfg.bindings = bindings;

      await writeConfig(cfg);

      await configureIgnores({
        directory: cfg.project,
        entries: ['.calljmp', '.service.env', '.env'],
      });

      await configureService({
        directory: cfg.project,
        service: cfg.service,
        entry: cfg.entry,
        types: cfg.types,
        buckets: cfg.bindings?.buckets,
      });
    });

async function createProject({ project }: { project: Project }) {
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

  const spinner = ora(chalk.blue('Creating project...')).start();
  try {
    const result = await project.create({
      name,
      description: description || undefined,
    });
    spinner.stop();
    return result;
  } catch (error) {
    if (
      error instanceof ServiceError &&
      error.code === ServiceErrorCode.ProjectAlreadyExists
    ) {
      spinner.fail(
        chalk.red('Project with this name exists or recently deleted!')
      );
      return createProject({ project });
    }
    spinner.fail(chalk.red('Failed to create project!'));
    logger.error(error);
    process.exit(1);
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
    logger.info(chalk.yellow('Create a new project to get started!'));
    return undefined;
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
    {
      name: 'Create new project',
      value: -2,
    },
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

  if (selection.value === -2) {
    return undefined;
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
    const spinner = ora(chalk.blue('Requesting authorization...')).start();
    try {
      const { requestId: id, authorizationUrl } = await account.requestAccess();
      requestId = id;
      spinner.stop();
      logger.info('Open the following URL to authorize CLI:');
      logger.info(chalk.yellow(authorizationUrl));
    } catch {
      spinner.fail(chalk.red('Failed to request authorization!'));
      return;
    }
  }

  {
    const spinner = ora(chalk.blue('Waiting for authorization...')).start();
    try {
      const result = await account.pollAccess(requestId);
      spinner.stop();
      return result;
    } catch {
      spinner.fail(chalk.red('Authorization failed!'));
      return;
    }
  }
}

export default setup;
