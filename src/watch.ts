import chokidar from 'chokidar';
import logger from './logger';

export async function watch(
  paths: string | string[],
  message: string,
  action: () => Promise<void>
) {
  const watcher = chokidar.watch(paths, {
    persistent: true,
    ignoreInitial: true,
  });

  // @ts-expect-error: chokidar types are not correct
  watcher.on('all', () => {
    logger.info(message);
    action();
  });

  await action();
  await new Promise(() => {
    // noop
  });
}
