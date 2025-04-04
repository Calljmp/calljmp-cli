import { Command } from 'commander';
import { Config } from '../config';
import * as server from '../server';

const start = (config: () => Config) =>
  new Command('start')
    .description('Start the server')
    .option('--port <number>', 'Port to run the server', parseInt, 8787)
    .option('--pd, --persist-database', 'Persist the database', false)
    .action(async (args: { port: number; persistDatabase: boolean }) => {
      const cfg = config();
      await server.serve({
        projectDirectory: cfg.project,
        moduleDirectory: cfg.module,
        entryPoints: cfg.entry,
        port: args.port,
        database: args.persistDatabase ? cfg.data : undefined,
      });
    });

export default start;
