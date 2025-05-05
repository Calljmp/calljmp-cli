import fetch from 'node-fetch';

export class Account {
  private _accessToken: string | null = null;

  constructor(
    private _config: {
      baseUrl: string;
      accessToken?: string;
    }
  ) {}

  async accessToken() {
    if (this._accessToken) {
      return this._accessToken;
    }

    const providedToken = this._config.accessToken;
    if (providedToken) {
      try {
        // JWT tokens consist of three parts separated by dots
        const [, payload] = providedToken.split('.');
        if (!payload) {
          return null;
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
          return null;
        }
      } catch {
        return null;
      }
    }

    this._accessToken = providedToken || null;
    return this._accessToken;
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
          await new Promise(resolve => setTimeout(resolve, interval * 1000));
          continue;
        }
        throw new Error(`Failed to check access: ${response.statusText}`);
      }

      const { accessToken } = (await response.json()) as {
        accessToken: string;
      };

      this._accessToken = accessToken;
      return { accessToken };
    }

    throw new Error('Timeout waiting for access token');
  }
}
