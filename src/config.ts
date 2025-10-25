import fs from 'fs';
import { Option } from 'commander';
import path from 'path';

export interface CliOptions {
  project: string;
  baseUrl: string;
}

export const CliCommonOptions = {
  project: new Option('-p, --project <path>', 'Path to the project directory')
    .default('.')
    .env('CALLJMP_PROJECT_DIR'),
  baseUrl: new Option('-u, --base-url <url>', 'URL for the Calljmp server')
    .default('https://api.calljmp.com')
    .env('CALLJMP_BASE_URL'),
};

export class Config {
  private _accessToken: string | null = null;
  private _projectId: number | null = null;

  constructor(private _opts: CliOptions) {
    this.restore();
  }

  private restore() {
    this._accessToken = process.env.CALLJMP_ACCESS_TOKEN || null;
    this._projectId = process.env.CALLJMP_PROJECT_ID
      ? parseInt(process.env.CALLJMP_PROJECT_ID, 10)
      : null;

    try {
      const content = fs.readFileSync(
        path.resolve(this.dataDirectory, '__config'),
        'utf-8'
      );
      const data = JSON.parse(content) as {
        accessToken?: string;
        projectId?: number;
      };

      this._accessToken = data.accessToken || this._accessToken;
      this._projectId = data.projectId || this._projectId;
    } catch {
      // No config file, ignore
    }
  }

  private save() {
    const data = {
      accessToken: this._accessToken,
      projectId: this._projectId,
    };

    fs.mkdirSync(this.dataDirectory, { recursive: true });
    fs.writeFileSync(
      path.resolve(this.dataDirectory, '__config'),
      JSON.stringify(data, null, 2),
      'utf-8'
    );
  }

  get dataDirectory(): string {
    return path.resolve(this.projectDirectory, '.calljmp');
  }

  get projectDirectory(): string {
    return path.resolve(process.cwd(), this._opts.project);
  }

  get baseUrl(): string {
    return this._opts.baseUrl;
  }

  get accessToken(): string | null {
    return this._accessToken;
  }

  set accessToken(token: string | null) {
    this._accessToken = token;
    this.save();
  }

  get projectId(): number | null {
    return this._projectId;
  }

  set projectId(id: number | null) {
    this._projectId = id;
    this.save();
  }
}
