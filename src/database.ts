import fetch from 'node-fetch';

export class Database {
  constructor(
    private _config: {
      baseUrl: string;
      accessToken: string;
      projectId: number;
    }
  ) { }

  private async _query(sql: string, params: (string | number)[] = []) {
    const response = await fetch(`${this._config.baseUrl}/project/${this._config.projectId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this._config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });

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
    const result = await this._query(
      'SELECT sql FROM sqlite_master WHERE name NOT LIKE "sqlite_%" AND name NOT LIKE "_cf_%"'
    );
    const statements = result.rows.map((row) => row.sql as string);
    return statements;
  }
}
