import fetch from 'node-fetch';
import { Config } from './config';
import {
  jsonToProject,
  Project,
  ServiceError,
  ServiceErrorCode,
} from './common';
import chalk from 'chalk';
import enquirer from 'enquirer';
import ora from 'ora';

export class Projects {
  private _projects: Map<number, Project> = new Map();

  constructor(private _config: Config) {}

  get hasSelected(): boolean {
    return !!this._config.projectId;
  }

  resetSelection() {
    this._config.projectId = null;
  }

  async selected(): Promise<Project> {
    if (!this._config.projectId) {
      throw new Error('No project selected');
    }

    let project = this._projects.get(this._config.projectId);
    if (project) {
      return project;
    }

    const spinner = ora(chalk.blue('Project is being provisioned, waiting...'));
    for (;;) {
      try {
        project = await this._retrieve({ id: this._config.projectId });
        spinner.stop();
        this._projects.set(project.id, project);
        return project;
      } catch (e) {
        if (
          e instanceof ServiceError &&
          e.code === ServiceErrorCode.ResourceBusy
        ) {
          spinner.start();
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          spinner.stop();
          throw e;
        }
      }
    }
  }

  async select({ offset }: { offset?: number } = {}): Promise<Project> {
    const { projects, nextOffset } = await this._list({ offset });

    if (projects.length === 0) {
      return this.create();
    }

    const choices = [
      ...projects.map(project => ({
        name: `${project.name}`,
        value: project.name,
      })),
      ...(nextOffset ? [{ name: 'More projects...', value: -1 }] : []),
      { name: 'Create new project', value: -2 },
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
      return this.select({ offset: nextOffset });
    }

    if (selection.value === -2) {
      return this.create();
    }

    const result = projects.find(project => project.name === selection.value);
    if (!result) {
      throw new Error('Project not found');
    }

    this._config.projectId = result.id;
    return result;
  }

  async create(): Promise<Project> {
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
      const result = await this._create({
        name,
        description: description || undefined,
      });
      spinner.stop();

      this._config.projectId = result.id;
      return result;
    } catch (e) {
      if (
        e instanceof ServiceError &&
        e.code === ServiceErrorCode.ProjectAlreadyExists
      ) {
        spinner.fail(
          chalk.red('Project with this name exists or recently deleted!')
        );
        return this.create();
      }
      spinner.fail(chalk.red('Failed to create project!'));
      throw e;
    }
  }

  private async _retrieve({ id }: { id: number }) {
    const response = await fetch(`${this._config.baseUrl}/project/${id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this._config.accessToken}`,
      },
    });

    if (!response.ok) {
      const { error } = (await response.json()) as {
        error: { name: string; message: string; code: ServiceErrorCode };
      };
      throw ServiceError.fromJson(error);
    }

    const result = (await response.json()) as Record<string, any>;
    return jsonToProject(result);
  }

  private async _list({
    offset,
    limit,
  }: {
    offset?: number;
    limit?: number;
  } = {}) {
    const params = new URLSearchParams();
    if (offset) {
      params.append('offset', offset.toString());
    }
    if (limit) {
      params.append('limit', limit.toString());
    }

    const response = await fetch(`${this._config.baseUrl}/project?${params}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this._config.accessToken}`,
      },
    });

    if (!response.ok) {
      const { error } = (await response.json()) as {
        error: { name: string; message: string; code: ServiceErrorCode };
      };
      throw ServiceError.fromJson(error);
    }

    const result = (await response.json()) as {
      projects: Record<string, any>[];
      nextOffset?: number;
    };

    return {
      projects: result.projects.map(jsonToProject),
      nextOffset: result.nextOffset,
    };
  }

  private async _create({
    name,
    description,
  }: {
    name: string;
    description?: string;
  }) {
    const response = await fetch(`${this._config.baseUrl}/project`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this._config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        description,
      }),
    });

    if (!response.ok) {
      const { error } = (await response.json()) as {
        error: { name: string; message: string; code: ServiceErrorCode };
      };
      throw ServiceError.fromJson(error);
    }

    const result = (await response.json()) as Record<string, any>;
    return jsonToProject(result);
  }

  // private async _generateApplicationToken({ projectId }: { projectId: number }) {
  //   const response = await fetch(
  //     `${this._config.baseUrl}/project/${projectId}/app/token`,
  //     {
  //       method: 'POST',
  //       headers: {
  //         Authorization: `Bearer ${this._config.accessToken}`,
  //         'Content-Type': 'application/json',
  //       },
  //     }
  //   );

  //   if (!response.ok) {
  //     const { error } = (await response.json()) as {
  //       error: { name: string; message: string; code: ServiceErrorCode };
  //     };
  //     throw ServiceError.fromJson(error);
  //   }

  //   const result = (await response.json()) as {
  //     token: string;
  //     expiresAt: string;
  //   };

  //   return {
  //     token: result.token,
  //     expiresAt: new Date(result.expiresAt),
  //   };
  // }
}
