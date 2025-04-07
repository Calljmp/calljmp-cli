import fetch from 'node-fetch';
import { jsonToProject, ServiceError, ServiceErrorCode } from './common';

export class Project {
  constructor(
    private _config: {
      baseUrl: string;
      accessToken: string;
    }
  ) {}

  async list({
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

  async deployService({
    projectId,
    script,
    secrets,
    variables,
  }: {
    projectId: number;
    script: string;
    secrets?: Record<string, string>;
    variables?: Record<string, string>;
  }) {
    const response = await fetch(
      `${this._config.baseUrl}/project/${projectId}/service`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this._config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          script,
          secrets,
          variables,
        }),
      }
    );

    if (!response.ok) {
      const { error } = (await response.json()) as {
        error: { name: string; message: string; code: ServiceErrorCode };
      };
      throw ServiceError.fromJson(error);
    }
  }
}
