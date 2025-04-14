import { Command } from 'commander';
import buildConfig, { ConfigOptions } from '../config';
import * as server from '../server';

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
    .option('--pd, --persist-database', 'Persist the database', false)
    .addOption(ConfigOptions.ProjectDirectory)
    .addOption(ConfigOptions.ModuleDirectory)
    .action(async args => {
      const cfg = await buildConfig(args);
      await server.serve({
        projectDirectory: cfg.project,
        moduleDirectory: cfg.module,
        entryPoints: cfg.entry,
        port: args.port,
        database: args.persistDatabase ? cfg.data : undefined,
      });
    });

export default start;
