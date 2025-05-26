import fetch from 'node-fetch';
import { createReadStream } from 'fs';
import fs from 'fs/promises';

export class Database {
  constructor(
    private _config: {
      baseUrl: string;
      accessToken: string;
      projectId: number;
    }
  ) {}

  async query(sql: string, params: (string | number)[] = []) {
    const response = await fetch(
      `${this._config.baseUrl}/project/${this._config.projectId}/database/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this._config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to execute query: ${response.statusText}`);
    }

    const result = (await response.json()) as {
      insertId?: number;
      numAffectedRows?: number;
      rows: Array<Record<string, unknown>>;
    };

    return result;
  }

  async retrieveSchema() {
    const result = await this.query(
      'SELECT sql FROM sqlite_master WHERE name NOT LIKE "sqlite_%" AND name NOT LIKE "_cf_%"'
    );
    const statements = result.rows.map(row => row.sql as string);
    return statements;
  }

  async migrate({ etag }: { etag: string }) {
    const response = await fetch(
      `${this._config.baseUrl}/project/${this._config.projectId}/database/migrate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this._config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ etag }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to execute query: ${response.statusText}`);
    }

    const result = (await response.json()) as {
      completed: boolean;
      uploadUrl?: string;
      filename?: string;
    };

    return result;
  }

  async ingest({
    etag,
    file,
    filename,
    uploadUrl,
  }: {
    etag: string;
    file: string | Blob;
    filename: string;
    uploadUrl: string;
  }) {
    const size =
      typeof file === 'string' ? (await fs.stat(file)).size : file.size;
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': size.toString(),
      },
      body: typeof file === 'string' ? createReadStream(file) : file,
    });
    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload file: ${uploadResponse.statusText}`);
    }

    const etagResponse = uploadResponse.headers.get('etag');
    if (!etagResponse) {
      throw new Error('No ETag returned from upload');
    }
    if (etag !== etagResponse.replace(/^"|"$/g, '')) {
      throw new Error(`ETag mismatch: expected ${etag}, got ${etagResponse}`);
    }

    const response = await fetch(
      `${this._config.baseUrl}/project/${this._config.projectId}/database/migrate`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this._config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ etag, filename }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to execute query: ${response.statusText}`);
    }

    const result = (await response.json()) as {
      completed: boolean;
      bookmark: string;
    };

    return result;
  }

  async migrationStatus({ bookmark }: { bookmark: string }) {
    const response = await fetch(
      `${this._config.baseUrl}/project/${this._config.projectId}/database/migration/status`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this._config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bookmark }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get migration status: ${response.statusText}`);
    }

    const result = (await response.json()) as {
      completed: boolean;
    };

    return result;
  }
}
