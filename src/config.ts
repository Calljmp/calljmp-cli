import { Command } from 'commander';
import path from 'path';

export interface Config {
  baseUrl: string;
  project: string;
  module: string;
  data: string;
  entry: string;
  types: string;
}

const buildConfig = (program: Command): Config => {
  const projectDirectory = path.resolve(process.cwd(), program.opts().project);
  const moduleDirectory = path.resolve(projectDirectory, program.opts().module);

  return {
    baseUrl: process.env.CALLJMP_BASE_URL || 'https://api.calljmp.com',
    project: projectDirectory,
    module: moduleDirectory,
    data: path.join(projectDirectory, '.calljmp'),
    entry: path.join(moduleDirectory, 'service.ts'),
    types: path.join(moduleDirectory, 'service.d.ts'),
  };
};

export default buildConfig;
