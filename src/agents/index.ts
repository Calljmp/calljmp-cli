import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import {
  AgentConfig,
  Project,
  ServiceError,
  ServiceErrorCode,
} from '../common';
import { Config } from '../config';
import TemplateGitIgnore from './templates/git-ignore.mst';
import TemplateIndex from './templates/index.mst';
import TemplatePackage from './templates/package.mst';
import TemplateTsConfig from './templates/tsconfig.mst';
import mustache from 'mustache';
import logger from '../logger';
import { toKebabCase, toSentenceCase } from '../utils/case';
import path from 'path';
import fetch from 'node-fetch';
import enquirer from 'enquirer';
import esbuild from 'esbuild';

export class Agents {
  constructor(private _config: Config) { }

  async initializeProject(project: Project) {
    const spinner = ora(chalk.blue('Generating project...')).start();

    try {
      const projectDir = this._config.projectDirectory;
      await fs.mkdir(projectDir, { recursive: true });

      const filesToCreate = [
        { name: '.gitignore', content: TemplateGitIgnore },
        { name: 'index.ts', content: TemplateIndex },
        {
          name: 'package.json',
          content: mustache.render(TemplatePackage, {
            packageName: toKebabCase(project.name),
            agentName: toSentenceCase(project.name),
            agentDescription:
              project.description ||
              `${toSentenceCase(project.name)} agent powered by Calljmp.`,
          }),
        },
        { name: 'tsconfig.json', content: TemplateTsConfig },
      ];

      const skipped = [];

      for (const file of filesToCreate) {
        const filePath = path.join(projectDir, file.name);

        const fileStat = await fs.stat(filePath).catch(() => null);
        if (fileStat) {
          skipped.push(file.name);
          continue;
        }

        await fs.writeFile(filePath, file.content);
      }

      if (skipped.length > 0) {
        spinner.warn(
          chalk.yellow(
            `Project generated with some existing files skipped: ${skipped.join(', ')}`
          )
        );
      } else {
        spinner.succeed(chalk.green('Project generated successfully.'));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to generate project.'));
      logger.error(chalk.red(`Error: ${(error as Error).message}`));
    }
  }

  async build(options?: { minify?: boolean }) {
    const spinner = ora(chalk.blue('Building agent...')).start();
    try {
      const contents = await fs.readFile(
        path.join(this._config.projectDirectory, 'index.ts'),
        'utf-8'
      );

      const result = await esbuild.build({
        write: false,
        bundle: true,
        format: 'esm',
        platform: 'neutral',
        target: 'es2022',
        minify: options?.minify === false ? false : true,
        external: ['@calljmp/agent'],
        stdin: {
          contents,
          sourcefile: 'index.ts',
          loader: 'ts',
        },
        absWorkingDir: path.resolve(this._config.projectDirectory),
      });

      if (result.errors.length > 0) {
        throw new Error(
          `Build failed: ${result.errors.map(e => e.text).join('\n')}`
        );
      }

      const code = result.outputFiles?.[0]?.text;
      if (!code) {
        throw new Error('Build failed: No output generated.');
      }

      spinner.succeed(chalk.green('Agent built.'));

      let config: AgentConfig | undefined;
      try {
        const pkg = await fs.readFile(
          path.join(this._config.projectDirectory, 'package.json'),
          'utf-8'
        );
        const pkgJson = JSON.parse(pkg);
        config = pkgJson.agent as AgentConfig | undefined;
      } catch {
        // If reading package.json fails, fall back to prompting
      }

      if (!config || !config.name) {
        logger.info(
          chalk.yellow(
            'Agent config not found in package.json. Need some agent details'
          )
        );

        const { name, description } = await enquirer.prompt<{
          name: string;
          description: string;
        }>([
          {
            type: 'input',
            name: 'name',
            message: 'Agent name',
            required: true,
            validate: (value: string) => {
              if (!value) {
                return 'Agent name is required';
              }
              return true;
            },
          },
          {
            type: 'input',
            name: 'description',
            message: 'Agent description',
            required: true,
            validate: (value: string) => {
              if (!value) {
                return 'Agent description is required';
              }
              return true;
            },
          },
        ]);

        config = { name, description };
      }

      return { config, code };
    } catch (e) {
      spinner.fail(chalk.red('Agent build failed.'));
      throw new Error(`Build failed: ${(e as Error).message}`);
    }
  }

  async deploy(project: Project) {
    const build = await this.build();

    const spinner = ora(chalk.blue('Deploying agent...')).start();
    try {
      const id = await this._deploy({
        projectId: project.id,
        ...build,
      });
      spinner.succeed(chalk.green('Agent deployed:'));
      logger.info(
        [
          `name: ${build.config.name}`,
          `description: ${build.config.description}`,
          `id: ${id}`,
        ]
          .map(line => `  - ${line}`)
          .join('\n')
      );
      return { id };
    } catch (error) {
      spinner.fail(chalk.red(`Failed to deploy agent: ${(error as Error).message}`));
      throw error;
    }
  }

  async run<Input = unknown>(project: Project, id: string, input?: Input) {
    const spinner = ora(chalk.blue('Running agent...')).start();
    try {
      const result = await this._run<Input>({ projectId: project.id, id, input });
      spinner.succeed(chalk.green('Agent run initiated:'));
      logger.info(`  - id: ${result.id}`);
      logger.info(`  - url: ${chalk.underline(`https://dash.calljmp.com/project/${project.id}/agents`)}`);
      return result;
    } catch (error) {
      spinner.fail(chalk.red(`Failed to run agent: ${(error as Error).message}`));
      throw error;
    }
  }

  private async _run<Input = unknown>({
    projectId,
    id,
    input,
  }: {
    projectId: number;
    id: string;
    input?: Input;
  }) {
    const response = await fetch(
      `${this._config.baseUrl}/project/${projectId}/ai/agent/${id}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._config.accessToken}`,
        },
        body: JSON.stringify({ input }),
      }
    );

    if (!response.ok) {
      const { error } = (await response.json()) as {
        error: { name: string; message: string; code: ServiceErrorCode };
      };
      throw ServiceError.fromJson(error);
    }

    const result = (await response.json()) as {
      id: string;
    };

    return result;
  }

  private async _deploy({
    projectId,
    config,
    code,
  }: {
    projectId: number;
    config: AgentConfig;
    code: string;
  }) {
    const response = await fetch(
      `${this._config.baseUrl}/project/${projectId}/ai/agent`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._config.accessToken}`,
        },
        body: JSON.stringify({ config, code }),
      }
    );

    if (!response.ok) {
      const { error } = (await response.json()) as {
        error: { name: string; message: string; code: ServiceErrorCode };
      };
      throw ServiceError.fromJson(error);
    }

    const { id } = (await response.json()) as { id: string };
    return id;
  }
}
