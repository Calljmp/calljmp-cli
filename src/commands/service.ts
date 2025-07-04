import { Command } from 'commander';
import buildConfig, { ConfigOptions, writeConfig } from '../config';
import { readVariables } from '../env';
import logger from '../logger';
import chalk from 'chalk';
import { Project } from '../project';
import { build } from '../build';
import ora from 'ora';
import { configureService } from '../configure';

const deploy = () =>
  new Command('deploy')
    .description('Deploy the application')
    .addOption(ConfigOptions.ProjectDirectory)
    .action(async args => {
      const cfg = await buildConfig(args);

      if (!cfg.projectId || !cfg.accessToken) {
        logger.error(
          chalk.red('Project is not linked. Please run `setup` command first.')
        );
        process.exit(1);
      }

      const envs = await readVariables(cfg.project, 'production');

      const secrets = Object.entries(envs)
        .filter(([key]) => key.toUpperCase().startsWith('SECRET_'))
        .reduce(
          (acc, [key, value]) => {
            acc[key.toUpperCase()] = value;
            return acc;
          },
          {} as Record<string, string>
        );

      const variables = Object.entries(envs)
        .filter(([key]) => !key.toUpperCase().startsWith('SECRET_'))
        .reduce(
          (acc, [key, value]) => {
            acc[`VARIABLE_${key.toUpperCase()}`] = value;
            return acc;
          },
          {} as Record<string, string>
        );

      logger.info('Secrets:');
      if (Object.keys(secrets).length > 0) {
        Object.entries(secrets).forEach(([key]) => {
          logger.info(
            `  ${chalk.gray(key.replace('SECRET_', ''))}: ${chalk.blue('********')}`
          );
        });
      } else {
        logger.info('  No secrets found.');
      }

      logger.info('Variables:');
      if (Object.keys(variables).length > 0) {
        Object.entries(variables).forEach(([key, value]) => {
          logger.info(
            `  ${chalk.gray(key.replace('VARIABLE_', ''))}: ${chalk.blue(value)}`
          );
        });
      } else {
        logger.info('  No variables found.');
      }

      const project = new Project({
        baseUrl: cfg.baseUrl,
        accessToken: cfg.accessToken,
      });

      const script = await (async () => {
        const spinner = ora('Building service...').start();
        try {
          const script = build({
            entryPoints: [cfg.entry],
          });
          spinner.succeed('Build completed');
          return script;
        } catch (e: any) {
          spinner.fail('Build failed');
          logger.error(e);
          process.exit(1);
        } finally {
          spinner.stop();
        }
      })();

      {
        const spinner = ora('Deploying service...').start();
        try {
          await project.deployService({
            projectId: cfg.projectId,
            script,
            secrets,
            variables,
          });
          spinner.succeed('Deployment completed');
          logger.info(
            `Access your service at: ${chalk.blue(
              cfg.baseUrl
            )}/target/v1/service`
          );
        } catch (e: any) {
          spinner.fail('Deployment failed');
          logger.error(e);
          process.exit(1);
        } finally {
          spinner.stop();
        }
      }
    });

const access = () =>
  new Command('access')
    .description('Get access token for the service')
    .addOption(ConfigOptions.ProjectDirectory)
    .action(async args => {
      const cfg = await buildConfig(args);
      if (!cfg.projectId || !cfg.accessToken) {
        logger.error(
          chalk.red('Project is not linked. Please run `setup` command first.')
        );
        process.exit(1);
      }
      const project = new Project({
        baseUrl: cfg.baseUrl,
        accessToken: cfg.accessToken,
      });

      const spinner = ora('Accessing service...').start();
      try {
        const { accessToken } = await project.accessTarget({
          projectId: cfg.projectId,
        });
        spinner.stop();
        logger.info(
          chalk.dim(
            `curl https://api.calljmp.com/target/v1/service --header "X-Calljmp-Platform: ios" --header "Authorization: Bearer ${accessToken}"`
          )
        );
      } catch (e: any) {
        spinner.fail('Access failed');
        logger.error(e);
        process.exit(1);
      } finally {
        spinner.stop();
      }
    });

const bindings = () =>
  new Command('bindings')
    .description('Synchronize service bindings')
    .addOption(ConfigOptions.ProjectDirectory)
    .action(async args => {
      const cfg = await buildConfig(args);
      if (!cfg.projectId || !cfg.accessToken) {
        logger.error(
          chalk.red('Project is not linked. Please run `setup` command first.')
        );
        process.exit(1);
      }

      const project = new Project({
        baseUrl: cfg.baseUrl,
        accessToken: cfg.accessToken,
      });

      logger.info(chalk.dim('Synchronizing service bindings...'));
      try {
        const bindings = await project.bindings({
          projectId: cfg.projectId,
        });
        cfg.bindings = bindings;
        await writeConfig(cfg);

        await configureService({
          directory: cfg.project,
          entry: cfg.entry,
          buckets: cfg.bindings?.buckets,
        });
      } catch (e: any) {
        logger.error(chalk.red('Failed to synchronize service bindings'), e);
        process.exit(1);
      }
    });

const generate = () =>
  new Command('generate')
    .description('Generate service code for the project')
    .addOption(ConfigOptions.ProjectDirectory)
    .action(async args => {
      const cfg = await buildConfig(args);
      await configureService({
        directory: cfg.project,
        entry: cfg.entry,
        buckets: cfg.bindings?.buckets,
      });
    });

const service = () =>
  new Command('service')
    .description('Deploy and manage a cloud service')
    .addCommand(deploy())
    .addCommand(bindings())
    .addCommand(access())
    .addCommand(generate());

export default service;
