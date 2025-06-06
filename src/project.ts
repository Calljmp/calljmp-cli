import fetch from 'node-fetch';
import {
  jsonToProject,
  jsonToServiceSecret,
  ServiceError,
  ServiceErrorCode,
} from './common';

export class Project {
  constructor(
    private _config: {
      baseUrl: string;
      accessToken: string;
    }
  ) {}

  async accessTarget({ projectId }: { projectId: number }) {
    const response = await fetch(`${this._config.baseUrl}/cli/access/target`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this._config.accessToken}`,
      },
      body: JSON.stringify({ projectId }),
    });

    if (!response.ok) {
      const { error } = (await response.json()) as {
        error: { name: string; message: string; code: ServiceErrorCode };
      };
      throw ServiceError.fromJson(error);
    }

    const result = (await response.json()) as {
      accessToken: string;
    };

    return result;
  }

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

  async create({ name, description }: { name: string; description?: string }) {
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

    const result = (await response.json()) as {
      uuid: string;
    };

    return result;
  }

  async listSecrets({ projectId }: { projectId: number }) {
    const response = await fetch(
      `${this._config.baseUrl}/project/${projectId}/service/secrets`,
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

    const result = (await response.json()) as Record<string, any>[];

    return result.map(jsonToServiceSecret);
  }

  async addSecret({
    projectId,
    secretName,
    secretValue,
  }: {
    projectId: number;
    secretName: string;
    secretValue: string;
  }) {
    const response = await fetch(
      `${this._config.baseUrl}/project/${projectId}/service/secrets/${secretName}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this._config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          value: secretValue,
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

  async deleteSecret({
    projectId,
    secretName,
  }: {
    projectId: number;
    secretName: string;
  }) {
    const response = await fetch(
      `${this._config.baseUrl}/project/${projectId}/service/secrets/${secretName}`,
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
  }

  async bindings({ projectId }: { projectId: number }) {
    const response = await fetch(
      `${this._config.baseUrl}/project/${projectId}/bindings`,
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

    const result = (await response.json()) as {
      buckets: Record<string, string>;
    };

    return result;
  }
}
