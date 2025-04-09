import { Log, Miniflare } from 'miniflare';
import logger from './logger';
import { build } from './build';
import { watch } from './watch';
import { readVariables, resolveEnvFiles } from './env';
import chalk from 'chalk';

export async function create({
  script,
  port,
  database,
  log,
  bindings,
}: {
  script: string;
  port?: number;
  database?: string;
  log?: Log;
  bindings?: Record<string, unknown>;
}) {
  return new Miniflare({
    name: 'calljmp',
    script,
    modules: true,
    compatibilityDate: '2024-09-23',
    compatibilityFlags: ['nodejs_compat'],
    port,
    log,
    d1Persist: database,
    d1Databases: ['db'],
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
  signal,
  database,
}: {
  projectDirectory: string;
  script: string;
  port: number;
  signal?: AbortSignal;
  database?: string;
}) {
  const envs = await readVariables(projectDirectory);

  const secrets = Object.entries(envs)
    .filter(([key]) => key.toUpperCase().startsWith('SECRET_'))
    .reduce((acc, [key, value]) => {
      acc[key.toUpperCase().replace('SECRET_', '')] = value;
      return acc;
    }, {} as Record<string, string>);

  const variables = Object.entries(envs)
    .filter(([key]) => !key.toUpperCase().startsWith('SECRET_'))
    .reduce((acc, [key, value]) => {
      acc[key.toUpperCase()] = value;
      return acc;
    }, {} as Record<string, string>);

  logger.info('Secrets:');
  if (Object.keys(secrets).length > 0) {
    Object.entries(secrets).forEach(([key]) => {
      logger.info(`  ${chalk.gray(key)}: ${chalk.blue('********')}`);
    });
  } else {
    logger.info('  No secrets found.');
  }

  logger.info('Variables:');
  if (Object.keys(variables).length > 0) {
    Object.entries(variables).forEach(([key, value]) => {
      logger.info(`  ${chalk.gray(key)}: ${chalk.blue(value)}`);
    });
  } else {
    logger.info('  No variables found.');
  }

  const flare = await create({
    bindings: envs,
    script,
    port,
    database,
    log: logger,
  });
  try {
    await flare.ready;
    logger.info('Press Ctrl+C to stop the server');
    await new Promise<void>((resolve) => {
      if (signal) {
        if (signal.aborted) {
          resolve();
        } else {
          signal.onabort = () => {
            resolve();
          };
        }
      }
    });
  } finally {
    await flare.dispose();
  }
}

export async function serve({
  projectDirectory,
  moduleDirectory,
  entryPoints,
  port,
  database,
}: {
  projectDirectory: string;
  moduleDirectory: string;
  entryPoints: string | string[];
  port: number;
  database?: string;
}) {
  let abortController: AbortController | null = null;
  await watch(
    [moduleDirectory, ...resolveEnvFiles(projectDirectory)],
    chalk.yellow('Detected changes, restarting...'),
    async () => {
      if (abortController) {
        abortController.abort();
        // Give some time for the previous server to shut down
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      abortController = new AbortController();
      const { signal } = abortController;

      try {
        const script = await build({ entryPoints, debug: true });
        await start({
          projectDirectory,
          script,
          port,
          database,
          signal,
        });
      } catch (e) {
        if (e instanceof Error) {
          logger.error(e);
        } else {
          logger.error(new Error(`Unknown error: ${e}`));
        }
      }
    }
  );
}
