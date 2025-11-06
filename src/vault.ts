import chalk from 'chalk';
import ora from 'ora';
import {
  jsonToVaultKeyValue,
  Project,
  ServiceError,
  ServiceErrorCode,
} from './common';
import { Config } from './config';
import fetch from 'node-fetch';
import enquirer from 'enquirer';

export class Vault {
  constructor(private _config: Config) {}

  async delete(project: Project, keyName?: string) {
    if (!keyName) {
      const keyValues = await this.list(project);
      if (keyValues.length === 0) {
        console.log(chalk.yellow('No variables or secrets found in vault.'));
        return;
      }

      const result = await enquirer.prompt<{ name: string }>({
        type: 'select',
        name: 'name',
        message: 'Select variable or secret to delete from the vault:',
        choices: keyValues.map(kv => ({
          name: kv.keyName,
          message: kv.keyName,
        })),
      });

      keyName = result.name;
    }

    const spinner = ora(
      chalk.blue('Deleting variable or secret from vault...')
    ).start();
    try {
      const response = await fetch(
        `${this._config.baseUrl}/project/${project.id}/vault/${encodeURIComponent(keyName)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${this._config.accessToken}`,
          },
        }
      );

      if (!response.ok) {
        const { error } = (await response.json()) as {
          error: { name: string; message: string; code: ServiceErrorCode };
        };
        throw ServiceError.fromJson(error);
      }

      spinner.succeed(chalk.green('Variable or secret deleted from vault.'));
    } catch (error) {
      spinner.fail(
        chalk.red(
          `Failed to delete variable or secret from vault: ${(error as Error).message}`
        )
      );
      throw error;
    }
  }

  async list(project: Project) {
    const response = await fetch(
      `${this._config.baseUrl}/project/${project.id}/vault`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this._config.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const { error } = (await response.json()) as {
        error: { name: string; message: string; code: ServiceErrorCode };
      };
      throw ServiceError.fromJson(error);
    }

    const { keyValues } = (await response.json()) as {
      keyValues: Array<Record<string, unknown>>;
    };

    return keyValues.map(jsonToVaultKeyValue);
  }

  async add(
    project: Project,
    args: {
      name?: string;
      value?: string;
      isSensitive?: boolean;
      description?: string;
    }
  ) {
    let keyName = args.name;
    let value: string | number | Record<string, unknown> | undefined | null =
      args.value;

    if (!keyName) {
      const result = await enquirer.prompt<{ name: string }>({
        type: 'input',
        name: 'name',
        message: `Enter name for ${args.isSensitive ? 'secret' : 'variable'}:`,
        required: true,
      });

      keyName = result.name;
    }

    if (!value) {
      const result = await enquirer.prompt<{ value: string }>({
        type: args.isSensitive ? 'password' : 'input',
        name: 'value',
        message: `Enter value for ${args.isSensitive ? 'secret' : 'variable'} ${chalk.green(keyName)}:`,
        required: true,
      });

      value = result.value;
    }

    if (typeof value === 'string') {
      if (!isNaN(Number(value)) && value.trim() !== '') {
        value = Number(value);
      } else {
        try {
          value = JSON.parse(value);
        } catch {
          // Leave as string if not valid JSON
        }
      }
    }

    const spinner = ora(
      chalk.blue(
        `Adding ${args.isSensitive ? 'secret' : 'variable'} to vault...`
      )
    ).start();
    try {
      const response = await fetch(
        `${this._config.baseUrl}/project/${project.id}/vault`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this._config.accessToken}`,
          },
          body: JSON.stringify({
            keyName,
            value,
            isSensitive: args.isSensitive,
            description: args.description,
          }),
        }
      );

      if (!response.ok) {
        const { error } = (await response.json()) as {
          error: { name: string; message: string; code: ServiceErrorCode };
        };
        throw ServiceError.fromJson(error);
      }

      spinner.succeed(
        chalk.green(
          `${args.isSensitive ? 'Secret' : 'Variable'} added to vault.`
        )
      );
    } catch (error) {
      spinner.fail(
        chalk.red(
          `Failed to add ${args.isSensitive ? 'secret' : 'variable'} to vault: ${(error as Error).message}`
        )
      );
      throw error;
    }
  }
}
