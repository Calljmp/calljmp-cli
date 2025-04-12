import { Command } from 'commander';
import buildConfig, { ConfigOptions } from '../config';
import { Project } from '../project';
import logger from '../logger';
import chalk from 'chalk';
import ora from 'ora';
import enquirer from 'enquirer';

const listSecrets = () =>
  new Command('list')
    .description('List all secrets')
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

      const secrets = await (async () => {
        const spinner = ora('Fetching secrets...').start();
        try {
          const secrets = await project.listSecrets({
            projectId: cfg.projectId!,
          });
          spinner.succeed(chalk.green('Fetched secrets.'));
          return secrets;
        } catch {
          spinner.fail(chalk.red('Failed to fetch secrets.'));
          process.exit(1);
        } finally {
          spinner.stop();
        }
      })();

      logger.info('Secrets:');
      if (secrets.length === 0) {
        logger.info('  No secrets found.');
        return;
      }

      secrets.forEach(secret => {
        logger.info(`  ${chalk.gray(secret.name)}}`);
      });
    });

const deleteSecret = () =>
  new Command('delete')
    .description('Delete a secret')
    .argument('[name]', 'Name of the secret')
    .addOption(ConfigOptions.ProjectDirectory)
    .action(async (name, args) => {
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

      const deleteSecret = async (secretName: string) => {
        const spinner = ora(`Deleting secret ${secretName}...`).start();
        try {
          await project.deleteSecret({
            projectId: cfg.projectId!,
            secretName,
          });
          spinner.succeed(chalk.green(`Secret ${secretName} deleted.`));
        } catch {
          spinner.fail(chalk.red(`Failed to delete secret ${secretName}.`));
          process.exit(1);
        } finally {
          spinner.stop();
        }
      };

      if (name) {
        await deleteSecret(name);
        return;
      }

      const secrets = await (async () => {
        const spinner = ora('Fetching secrets...').start();
        try {
          const secrets = await project.listSecrets({
            projectId: cfg.projectId!,
          });
          spinner.succeed(chalk.green('Fetched secrets.'));
          return secrets;
        } catch {
          spinner.fail(chalk.red('Failed to fetch secrets.'));
          process.exit(1);
        } finally {
          spinner.stop();
        }
      })();

      if (secrets.length === 0) {
        logger.info('No secrets found.');
        return;
      }

      const choices = secrets.map(secret => ({
        name: secret.name,
        value: secret.name,
      }));

      const selection = await enquirer.prompt<{
        secrets: string[];
      }>({
        type: 'multiselect',
        name: 'secrets',
        message: 'Select secrets to delete',
        choices,
      });

      if (selection.secrets.length === 0) {
        logger.info('No secrets selected.');
        return;
      }

      for (const secret of selection.secrets) {
        await deleteSecret(secret);
      }
    });

const secrets = () =>
  new Command('secrets')
    .description('Manage project secrets')
    .addCommand(listSecrets())
    .addCommand(deleteSecret());

export default secrets;
