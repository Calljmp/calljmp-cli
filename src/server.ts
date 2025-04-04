import { Log, Miniflare } from 'miniflare';
import logger from './logger';
import { build } from './build';
import { watch } from './watch';
import { readVariables, resolveEnvFiles } from './env';

export async function create({
  projectDirectory,
  script,
  port,
  database,
  log,
}: {
  projectDirectory: string;
  script: string;
  port?: number;
  database?: string;
  log?: Log;
}) {
  const variables = await readVariables(projectDirectory);
  return new Miniflare({
    name: 'calljmp',
    script,
    modules: true,
    compatibilityDate: '2024-09-23',
    compatibilityFlags: ['nodejs_compat'],
    port,
    log,
    d1Persist: database,
    d1Databases: ['DB'],
    bindings: variables,
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
  const flare = await create({
    projectDirectory,
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
    'Detected changes, restarting...',
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
