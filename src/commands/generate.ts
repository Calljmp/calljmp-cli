import { Command } from 'commander';
import buildConfig, { ConfigOptions } from '../config';
import { configureService } from '../configure';

const generate = () =>
  new Command('generate')
    .description('Generate service code for the project')
    .addOption(ConfigOptions.ProjectDirectory)
    .option('--no-hono', 'Do not use Hono')
    .action(async (args) => {
      const cfg = await buildConfig(args);
      await configureService({
        directory: cfg.project,
        service: cfg.service,
        hono: args.hono,
      });
    });

export default generate;
