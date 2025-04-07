import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { exec } from 'child_process';
import ora from 'ora';
import enquirer from 'enquirer';
import logger from './logger';
import { readVariables } from './env';

export async function configureIgnores({
  directory,
  entries,
}: {
  directory: string;
  entries: string[];
}) {
  const gitIgnorePath = path.join(directory, '.gitignore');

  // Check if .gitignore exists
  let gitIgnoreContent = '';
  try {
    gitIgnoreContent = await fs.readFile(gitIgnorePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    // .gitignore doesn't exist, we'll create a new one
    logger.info(chalk.blue('Creating new .gitignore'));
  }

  const lines = gitIgnoreContent.split('\n');
  let contentUpdated = false;

  // Check each entry and add if missing
  for (const entry of entries) {
    const hasEntry = lines.some((line) => {
      const trimmed = line.trim();
      return (
        trimmed === entry || trimmed === `/${entry}` || trimmed === `${entry}/`
      );
    });

    if (!hasEntry) {
      // Add entry to .gitignore
      if (!gitIgnoreContent.endsWith('\n') && gitIgnoreContent !== '') {
        gitIgnoreContent += '\n';
      }
      gitIgnoreContent += `${entry}\n`;
      logger.info(chalk.blue(`Adding ${entry} to .gitignore`));
      contentUpdated = true;
    }
  }

  if (contentUpdated) {
    await fs.writeFile(gitIgnorePath, gitIgnoreContent, 'utf-8');
  }
}

export async function configureTypes({
  directory,
  types,
}: {
  directory: string;
  types: string;
}) {
  const variables = Object.keys(await readVariables(directory));

  const content: string[] = [
    '// Do not edit this file directly. It is generated by the Calljmp CLI.',
    '',
    "import { D1Database } from '@cloudflare/workers-types';",
    '',
    'export interface Env {',
    '  // Bindings',
    '  DB: D1Database;',
  ];

  if (variables.length > 0) {
    content.push('', '  // Environment variables');
    variables.forEach((variable) => {
      content.push(`  ${variable}: string;`);
    });
  }

  content.push(
    '}',
    '',
    'export interface Service {',
    '  Bindings: Env;',
    '}',
    ''
  );

  await fs.writeFile(types, content.join('\n'), 'utf-8');
  logger.info(chalk.blue(`Generating ${path.basename(types)}`));
}

export async function configureDependencies({
  directory,
}: {
  directory: string;
}) {
  const currentDirectory = process.cwd();
  const relativePath = path.relative(currentDirectory, directory);

  const { confirmedDirectory } = await enquirer.prompt<{
    confirmedDirectory: string;
  }>({
    type: 'input',
    name: 'confirmedDirectory',
    message: 'Confirm the project directory',
    initial: relativePath,
  });

  const projectDirectory = path.resolve(currentDirectory, confirmedDirectory);

  const hasYarnLock = await fs
    .access(path.join(projectDirectory, 'yarn.lock'))
    .then(() => true)
    .catch(() => false);

  const { packageManager } = await enquirer.prompt<{
    packageManager: 'npm' | 'yarn' | 'pnpm';
  }>({
    type: 'select',
    name: 'packageManager',
    message: 'Select package manager',
    choices: [
      { name: 'npm', value: 'npm' },
      { name: 'yarn', value: 'yarn' },
      { name: 'pnpm', value: 'pnpm' },
    ],
    initial: hasYarnLock ? 1 : 0,
  });

  const packageJsonPath = path.join(projectDirectory, 'package.json');
  const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
  const packageJson = JSON.parse(packageContent);

  const install = async (packageName: string, dev?: boolean) => {
    const spinner = ora(`Installing ${packageName}...`).start();
    try {
      if (
        !dev &&
        packageJson.dependencies &&
        packageName in packageJson.dependencies
      ) {
        spinner.info(chalk.yellow(`Already installed ${packageName}`));
        return;
      }
      if (
        dev &&
        packageJson.devDependencies &&
        packageName in packageJson.devDependencies
      ) {
        spinner.info(chalk.yellow(`Already installed ${packageName}`));
        return;
      }

      const cmd =
        packageManager === 'yarn'
          ? 'yarn add'
          : packageManager === 'pnpm'
          ? 'pnpm add'
          : 'npm install';
      const devFlag = dev ? '--save-dev' : '--save';

      await new Promise((resolve, reject) => {
        exec(
          `${cmd} ${devFlag} ${packageName}`,
          { cwd: projectDirectory },
          (error) => {
            if (error) {
              reject(error);
            } else {
              resolve(null);
            }
          }
        );
      });

      spinner.succeed(chalk.green(`Installed ${packageName}`));
    } catch (error) {
      spinner.fail(chalk.red(`Failed to install ${packageName}`));
      throw error;
    } finally {
      spinner.stop();
    }
  };

  await install('@cloudflare/workers-types', true);
  await install('@calljmp/react-native');
}
