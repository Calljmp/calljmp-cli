import { Log, Miniflare } from 'miniflare';
import logger from './logger';
import { build } from './build';
import { readVariables } from './env';
import chalk from 'chalk';
import fs from 'fs/promises';

export async function create({
  script = '',
  port,
  database,
  buckets,
  log,
  bindings,
}: {
  script?: string;
  port?: number;
  database?: string;
  buckets?: string[];
  log?: Log;
  bindings?: Record<string, unknown>;
}) {
  return new Miniflare({
    name: 'calljmp',
    script,
    modules: true,
    compatibilityDate: '2024-09-23',
    compatibilityFlags: ['nodejs_compat'],
    host: '0.0.0.0',
    port,
    log,
    d1Persist: database,
    d1Databases: ['db'],
    r2Buckets: buckets,
    bindings: {
      ...bindings,
      DEVELOPMENT: true,
    },
  });
}

export async function start({
  projectDirectory,
  script,
  port,
  database,
  buckets,
  onReady,
}: {
  projectDirectory: string;
  script: string;
  port: number;
  database?: string;
  buckets?: string[];
  onReady?: () => Promise<void>;
}) {
  const envs = await readVariables(projectDirectory, 'development');

  const secrets = Object.entries(envs)
    .filter(([key]) => key.toUpperCase().startsWith('SECRET_'))
    .reduce(
      (acc, [key, value]) => {
        acc[key.toUpperCase().replace('SECRET_', '')] = value;
        return acc;
      },
      {} as Record<string, string>
    );

  const variables = Object.entries(envs)
    .filter(([key]) => !key.toUpperCase().startsWith('SECRET_'))
    .reduce(
      (acc, [key, value]) => {
        acc[key.toUpperCase()] = value;
        return acc;
      },
      {} as Record<string, string>
    );

  logger.info('Variables:');
  if (Object.keys(variables).length > 0) {
    Object.entries(variables).forEach(([key, value]) => {
      logger.info(`  ${chalk.gray(key)}: ${chalk.blue(value)}`);
    });
  } else {
    logger.info('  No variables found.');
  }

  logger.info('Secrets:');
  if (Object.keys(secrets).length > 0) {
    Object.entries(secrets).forEach(([key]) => {
      logger.info(`  ${chalk.gray(key)}: ${chalk.blue('********')}`);
    });
  } else {
    logger.info('  No secrets found.');
  }

  const flare = await create({
    bindings: {
      ...variables,
      ...secrets,
    },
    script,
    port,
    database,
    buckets,
    log: logger,
  });
  try {
    await flare.ready;
    if (onReady) {
      await onReady();
    }
  } finally {
    await flare.dispose();
  }
}

export async function buildWithLocalHandler(module: string) {
  const tempDir = await fs.mkdtemp('/tmp/calljmp-');
  try {
    const entryPoint = `${tempDir}/index.ts`;
    const content = `
    import service from '${module}';

    function decodeAccessToken(token: string) {
      const parts = token.split('.');
      if (parts.length < 2) {
        throw new Error(\`Invalid JWT token: \${token}\`);
      }
      const base64Payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const decodedPayload = atob(base64Payload);
      return JSON.parse(decodedPayload) as {
        userId: number | null;
        projectId: number;
        databaseId: string;
        serviceUuid: string | null;
      };
    }

    export default {
      async fetch(originalRequest, ...opts) {
        const args = {
          platform: originalRequest.headers.get('X-Calljmp-Platform'),
          userId: null,
          serviceId: null
        };

        const authorization = originalRequest.headers.get('Authorization');
        if (authorization) {
          const token = authorization.replace(/^Bearers+/, '');
          const { userId, serviceUuid } = decodeAccessToken(token);
          args.userId = userId;
          args.serviceId = serviceUuid;
        }

        const url = new URL(originalRequest.url);
        const targetUrl = new URL(\`https://app.service.calljmp.com\${url.pathname}\`);
        
        const headers = new Headers(originalRequest.headers);
        headers.set('X-Calljmp-Args', JSON.stringify(args));

        const request = new Request(targetUrl, {
          ...originalRequest,
          headers,
        });

        return service.fetch(request, ...opts);
      }
    }
    `;
    await fs.writeFile(entryPoint, content);
    return await build({ entryPoints: entryPoint, debug: true });
  } finally {
    await fs.rm(tempDir, { recursive: true });
  }
}
