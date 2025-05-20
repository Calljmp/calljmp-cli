import { Option } from 'commander';
import path from 'path';
import fs from 'fs/promises';

interface PersistentConfig {
  projectId?: number;
  accessToken?: string;
}

export interface Config extends PersistentConfig {
  baseUrl: string;
  project: string;
  module: string;
  data: string;
  entry: string;
  service: string;
  types: string;
  migrations: string;
  schema: string;
}

async function buildConfig({
  project = '.',
  module = './src/service',
  migrations = './src/service/migrations',
  schema = './src/service/schema',
}: {
  project?: string;
  module?: string;
  migrations?: string;
  schema?: string;
}): Promise<Config> {
  const projectDirectory = path.resolve(process.cwd(), project);
  const moduleDirectory = path.resolve(projectDirectory, module);
  const migrationsDirectory = path.resolve(projectDirectory, migrations);
  const schemaDirectory = path.resolve(projectDirectory, schema);
  const dataDirectory = path.join(projectDirectory, '.calljmp');
  const data = await readConfig(dataDirectory);

  return {
    ...data,
    baseUrl: process.env.CALLJMP_BASE_URL || 'https://api.calljmp.com',
    project: projectDirectory,
    module: moduleDirectory,
    data: dataDirectory,
    migrations: migrationsDirectory,
    schema: schemaDirectory,
    entry: path.join(moduleDirectory, 'main.ts'),
    service: path.join(moduleDirectory, 'service.ts'),
    types: path.join(moduleDirectory, 'service-types.d.ts'),
  };
}

async function readConfig(dataDirectory: string) {
  const result = await fs
    .readFile(path.join(dataDirectory, 'config.json'), 'utf-8')
    .then(data => JSON.parse(data) as PersistentConfig)
    .catch(() => null);
  return result;
}

export async function writeConfig(config: Config) {
  const configPath = path.join(config.data, 'config.json');
  await fs.mkdir(config.data, { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        projectId: config.projectId,
        accessToken: config.accessToken,
      },
      null,
      2
    )
  );
}

export const ConfigOptions = {
  ProjectDirectory: new Option('-p, --project <directory>', 'Project directory')
    .default('.')
    .env('CALLJMP_PROJECT'),
  ModuleDirectory: new Option('-m, --module <directory>', 'Module directory')
    .default('./src/service')
    .env('CALLJMP_MODULE'),
  MigrationsDirectory: new Option(
    '--mg, --migrations <directory>',
    'Migrations directory'
  )
    .default('./src/service/migrations')
    .env('CALLJMP_MIGRATIONS'),
  SchemaDirectory: new Option('--s, --schema <directory>', 'Schema directory')
    .default('./src/service/schema')
    .env('CALLJMP_SCHEMA'),
};

export default buildConfig;
