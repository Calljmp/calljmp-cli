import { Project, ServiceError, ServiceErrorCode } from './common';
import { Config } from './config';
import fetch from 'node-fetch';

export class Prompts {
  constructor(private _config: Config) {}

  async bindings(project: Project) {
    const response = await fetch(
      `${this._config.baseUrl}/project/${project.id}/prompts/bindings`,
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

    const { bindings } = (await response.json()) as {
      bindings: Array<{
        binding: string;
      }>;
    };

    return bindings;
  }
}
