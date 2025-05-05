import { Command } from 'commander';
import buildConfig, { ConfigOptions } from '../config';
import { configureService } from '../configure';

const generate = () =>
  new Command('generate')
    .description('Generate service code for the project')
    .addOption(ConfigOptions.ProjectDirectory)
    .action(async args => {
      const cfg = await buildConfig(args);
      await configureService({
        directory: cfg.project,
        service: cfg.service,
        types: cfg.types,
        entry: cfg.entry,
      });
    });

export default generate;
