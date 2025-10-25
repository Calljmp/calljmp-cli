import * as jwt from 'jose';
import fetch from 'node-fetch';
import { Config } from './config';
import ora from 'ora';
import chalk from 'chalk';
import logger from './logger';

export class Authentication {
  constructor(private _config: Config) {}

  get accessToken(): string | null {
    if (this._config.accessToken) {
      const data = jwt.decodeJwt(this._config.accessToken);
      const now = Math.floor(Date.now() / 1000);

      if (data.exp && data.exp > now) {
        return this._config.accessToken;
      }

      this.reset();
    }

    return null;
  }

  get authorized(): boolean {
    return this.accessToken !== null;
  }

  reset() {
    this._config.accessToken = null;
  }

  private async _requestAccess() {
    const response = await fetch(`${this._config.baseUrl}/cli/access`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to request access: ${response.status} ${response.statusText}`
      );
    }

    const { requestId, authorizationUrl } = (await response.json()) as {
      requestId: string;
      authorizationUrl: string;
    };

    return { requestId, authorizationUrl };
  }

  private async _pollAccess(requestId: string): Promise<string> {
    for (;;) {
      const response = await fetch(
        `${this._config.baseUrl}/cli/access/${requestId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const { accessToken } = (await response.json()) as {
          accessToken: string;
        };
        return accessToken;
      }

      if (response.status === 404) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }

      throw new Error(
        `Failed to poll access: ${response.status} ${response.statusText}`
      );
    }
  }

  async authorize() {
    let requestId: string | null = null;

    {
      const spinner = ora(chalk.blue('Preparing authorization...')).start();
      try {
        const { requestId: id, authorizationUrl } = await this._requestAccess();
        requestId = id;
        spinner.stop();
        logger.info(
          `To authorize CLI, please visit the following URL in your browser:\n\n${chalk.underline.yellow(authorizationUrl)}\n`
        );
      } catch (e) {
        spinner.fail(chalk.red('Failed to prepare authorization.'));
        throw e;
      }
    }

    {
      const spinner = ora(chalk.blue('Waiting for authorization...')).start();
      try {
        const accessToken = await this._pollAccess(requestId);
        this._config.accessToken = accessToken;
        spinner.succeed(chalk.green('Authorization successful!'));
      } catch (e) {
        spinner.fail(chalk.red('Authorization failed.'));
        throw e;
      }
    }
  }
}
