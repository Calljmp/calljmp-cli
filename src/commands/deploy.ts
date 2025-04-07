import { Command } from 'commander';
import buildConfig, { ConfigOptions } from '../config';
import { readVariables } from '../env';
import logger from '../logger';
import chalk from 'chalk';
import { Project } from '../project';
import { build } from '../build';
import ora from 'ora';

const deploy = () =>
  new Command('deploy')
    .description('Deploy the application')
    .addOption(ConfigOptions.ProjectDirectory)
    .action(async (args) => {
      const cfg = await buildConfig(args);

      if (!cfg.projectId || !cfg.accessToken) {
        logger.error(
          'Project is not linked. Please run `setup` command first.'
        );
        process.exit(1);
      }

      const envs = await readVariables(cfg.project);

      const secrets = Object.entries(envs)
        .filter(([key]) => key.toUpperCase().startsWith('SECRET_'))
        .reduce((acc, [key, value]) => {
          acc[key.toUpperCase().replace('SECRET_', '')] = value;
          return acc;
        }, {} as Record<string, string>);

      const variables = Object.entries(envs)
        .filter(([key]) => !key.toUpperCase().startsWith('SECRET_'))
        .reduce((acc, [key, value]) => {
          acc[key.toUpperCase()] = value;
          return acc;
        }, {} as Record<string, string>);

      logger.info('Secrets:');
      if (Object.keys(secrets).length > 0) {
        Object.entries(secrets).forEach(([key]) => {
          logger.info(`  ${chalk.gray(key)}: ${chalk.blue('********')}`);
        });
      } else {
        logger.info('  No secrets found.');
      }

      logger.info('Variables:');
      if (Object.keys(variables).length > 0) {
        Object.entries(variables).forEach(([key, value]) => {
          logger.info(`  ${chalk.gray(key)}: ${chalk.blue(value)}`);
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
        } catch (e: any) {
          spinner.fail('Deployment failed');
          logger.error(e);
          process.exit(1);
        } finally {
          spinner.stop();
        }
      }
    });

export default deploy;
