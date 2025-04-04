import path from 'path';
import fs from 'fs/promises';
import fetch from 'node-fetch';

export class Account {
  private _accessToken: string | null = null;
  private _accessTokenPath: string;

  constructor(
    private _config: {
      baseUrl: string;
      dataDirectory: string;
    }
  ) {
    this._accessTokenPath = path.join(this._config.dataDirectory, 'at');
  }

  async accessToken() {
    if (this._accessToken) {
      return this._accessToken;
    }
    const accessToken = await fs
      .readFile(this._accessTokenPath, 'utf-8')
      .catch(() => null);

    if (accessToken) {
      try {
        // JWT tokens consist of three parts separated by dots
        const [, payload] = accessToken.split('.');
        if (!payload) {
          throw new Error('Invalid token format');
        }

        // Decode the base64 payload
        const decodedPayload = JSON.parse(
          Buffer.from(payload, 'base64').toString()
        );

        // Check if token has expired
        const expirationTime = decodedPayload.exp * 1000;
        const currentTime = Date.now();

        // 30 minutes grace period
        if (currentTime >= expirationTime + 30 * 60 * 1000) {
          throw new Error('Token expired');
        }
      } catch {
        // If token parsing fails, consider it invalid
        await this.clearAccessToken();
        return null;
      }
    }

    this._accessToken = accessToken;
    return accessToken;
  }

  private async putAccessToken(accessToken: string) {
    this._accessToken = accessToken;
    await fs.mkdir(path.dirname(this._accessTokenPath), { recursive: true });
    await fs.writeFile(this._accessTokenPath, accessToken);
  }

  private async clearAccessToken() {
    this._accessToken = null;
    await fs.rm(this._accessTokenPath, { force: true });
  }

  async reset() {
    await this.clearAccessToken();
  }

  async authorized() {
    const accessToken = await this.accessToken();
    return !!accessToken;
  }

  async requestAccess() {
    const response = await fetch(`${this._config.baseUrl}/cli/access`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to request access: ${response.statusText}`);
    }

    const { requestId, authorizationUrl } = (await response.json()) as {
      requestId: string;
      authorizationUrl: string;
    };

    return { requestId, authorizationUrl };
  }

  async pollAccess(
    requestId: string,
    {
      timeout = 5 * 60,
      interval = 5,
    }: {
      timeout?: number;
      interval?: number;
    } = {}
  ) {
    const start = Date.now();
    const end = start + timeout * 1000;

    while (Date.now() < end) {
      const response = await fetch(
        `${this._config.baseUrl}/cli/access/${requestId}`,
        {
          method: 'GET',
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          // Not found means the token is not ready yet
          await new Promise((resolve) => setTimeout(resolve, interval * 1000));
          continue;
        }
        throw new Error(`Failed to check access: ${response.statusText}`);
      }

      const { accessToken } = (await response.json()) as {
        accessToken: string;
      };

      await this.putAccessToken(accessToken);
      return accessToken;
    }

    throw new Error('Timeout waiting for access token');
  }
}
