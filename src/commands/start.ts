import { Command } from 'commander';
import buildConfig, { Config, ConfigOptions, writeConfig } from '../config';
import * as server from '../server';
import { resolveEnvFiles } from '../env';
import chalk from 'chalk';
import logger from '../logger';
import * as readline from 'readline';
import chokidar from 'chokidar';
import { configureService } from '../configure';
import { Project } from '../project';

const parsePort = (value: string) => {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error('Port must be a number between 0 and 65535');
  }
  return parsed;
};

const start = () =>
  new Command('start')
    .description('Start the server')
    .option('--port <number>', 'Port to run the server', parsePort, 8787)
    .addOption(ConfigOptions.ProjectDirectory)
    .addOption(ConfigOptions.ModuleDirectory)
    .action(async args => {
      const cfg = await buildConfig(args);
      await serve({
        ...cfg,
        port: args.port,
        database: cfg.data,
      });
    });

async function serve({
  port,
  database,
  ...cfg
}: Config & {
  port: number;
  database?: string;
}) {
  let abortController: AbortController | null = null;

  const handleKeypress = async (str: string, key: any) => {
    if (key.name === 'c') {
      logger.info(chalk.dim('Stopping server...'));
      process.exit();
    } else if (key.name === 'r') {
      logger.info(chalk.dim('Restarting server...'));
      logger.info(' ');
      abortController?.abort();
    } else if (key.name === 'b') {
      if (!cfg.projectId || !cfg.accessToken) {
        logger.error(
          chalk.red('Project is not linked. Please run `setup` command first.')
        );
        process.exit(1);
      }

      const project = new Project({
        baseUrl: cfg.baseUrl,
        accessToken: cfg.accessToken,
      });

      logger.info(chalk.dim('Synchronizing service bindings...'));
      try {
        const bindings = await project.bindings({
          projectId: cfg.projectId,
        });
        cfg.bindings = bindings;
        await writeConfig(cfg);

        function printBindingsTree(
          bindings: Record<string, unknown>,
          indent = ''
        ) {
          Object.entries(bindings).forEach(([key, value], index, array) => {
            const isLast = index === array.length - 1;
            const prefix = isLast ? '└── ' : '├── ';
            const nextIndent = indent + (isLast ? '    ' : '│   ');

            if (
              typeof value === 'object' &&
              value !== null &&
              !Array.isArray(value)
            ) {
              logger.info(`${indent}${chalk.dim(prefix)}${key}`);
              printBindingsTree(value as Record<string, unknown>, nextIndent);
            } else {
              logger.info(`${indent}${chalk.dim(prefix)}${key}: ${value}`);
            }
          });
        }

        logger.info('Service bindings');
        printBindingsTree(bindings);

        await configureService({
          directory: cfg.project,
          entry: cfg.entry,
          buckets: cfg.bindings?.buckets,
        });
      } catch {
        logger.error(
          chalk.red('Failed to synchronize service bindings. Please try again.')
        );
      }
    }
  };

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', handleKeypress);

  process.on('exit', () => {
    process.stdin.off('keypress', handleKeypress);
    process.stdin.setRawMode(false);
  });

  const start = async () => {
    for (;;) {
      if (abortController) {
        abortController.abort();
        // Give some time for the previous server to shut down
        await new Promise(resolve => setTimeout(resolve, 250));
      }

      await configureService({
        directory: cfg.project,
        entry: cfg.entry,
        buckets: cfg.bindings?.buckets,
      });

      abortController = new AbortController();
      const { signal } = abortController;

      const onReady = () =>
        new Promise<void>(resolve => {
          if (signal.aborted) {
            resolve();
          } else {
            logger.info('\nKey commands:\n');
            logger.info(`  ${chalk.bgWhite(chalk.black(' c '))} - Stop server`);
            logger.info(
              `  ${chalk.bgWhite(chalk.black(' r '))} - Restart server`
            );
            logger.info(
              `  ${chalk.bgWhite(chalk.black(' b '))} - Synchronize service bindings`
            );
            logger.info(' ');

            signal.onabort = () => {
              resolve();
            };
          }
        });

      try {
        const script = await server.buildWithLocalHandler(cfg.entry);
        await server.start({
          projectDirectory: cfg.project,
          script,
          port,
          database,
          buckets: Object.values(cfg.bindings?.buckets || {}),
          onReady,
        });
      } catch (e) {
        if (e instanceof Error) {
          logger.error(e);
        } else {
          logger.error(new Error(`Unknown error: ${e}`));
        }
      }
    }
  };

  const watcher = chokidar.watch(
    [cfg.module, ...resolveEnvFiles(cfg.project, 'development')],
    {
      persistent: true,
      ignoreInitial: true,
    }
  );

  watcher.on('all', async () => {
    logger.info(chalk.dim('Changes detected, restarting server...'));
    logger.info(' ');
    abortController?.abort();
  });

  await start();
}

export default start;
