import { Command } from 'commander';
import buildConfig, { ConfigOptions } from '../config';
import { configureTypes } from '../configure';

const generate = () =>
  new Command('generate')
    .description('Generate types for the project')
    .addOption(ConfigOptions.ProjectDirectory)
    .action(async (args) => {
      const cfg = await buildConfig(args);

      await configureTypes({
        directory: cfg.project,
        types: cfg.types,
      });
    });

export default generate;
