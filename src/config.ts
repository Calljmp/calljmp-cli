import { Option } from 'commander';
import path from 'path';
import fs from 'fs/promises';

export const ConfigDefaults = {
  baseUrl: 'https://api.calljmp.com',
  project: '.',
  module: './service',
  migrations: './service/migrations',
  schema: './service/schema',
};

export interface PersistentConfig {
  projectId?: number;
  accessToken?: string;
  module?: string;
  migrations?: string;
  schema?: string;
  bindings?: {
    buckets?: Record<string, string>;
  };
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
  project,
  module,
  migrations,
  schema,
}: {
  project?: string;
  module?: string;
  migrations?: string;
  schema?: string;
}): Promise<Config> {
  const projectDirectory = path.resolve(process.cwd(), project || '.');
  const dataDirectory = path.join(projectDirectory, '.calljmp');
  const config = await readConfig(dataDirectory);

  const moduleDirectory = path.resolve(
    projectDirectory,
    module || config?.module || ConfigDefaults.module
  );
  const migrationsDirectory = path.resolve(
    projectDirectory,
    migrations || config?.migrations || ConfigDefaults.migrations
  );
  const schemaDirectory = path.resolve(
    projectDirectory,
    schema || config?.schema || ConfigDefaults.schema
  );

  return {
    ...config,
    baseUrl: process.env.CALLJMP_BASE_URL || ConfigDefaults.baseUrl,
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
        module: path.relative(config.project, config.module),
        migrations: path.relative(config.project, config.migrations),
        schema: path.relative(config.project, config.schema),
        bindings: config.bindings,
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
    .default(ConfigDefaults.module)
    .env('CALLJMP_MODULE'),
  MigrationsDirectory: new Option(
    '--mg, --migrations <directory>',
    'Migrations directory'
  )
    .default(ConfigDefaults.migrations)
    .env('CALLJMP_MIGRATIONS'),
  SchemaDirectory: new Option('--s, --schema <directory>', 'Schema directory')
    .default(ConfigDefaults.schema)
    .env('CALLJMP_SCHEMA'),
};

export default buildConfig;
