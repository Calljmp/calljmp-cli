import type { Plugin } from 'esbuild';
import { builtinModules } from 'node:module';
import { defineEnv } from 'unenv';
import { getCloudflarePreset } from '@cloudflare/unenv-preset';

const nodejsModulesPattern = new RegExp(
  `^(node:)?(${builtinModules.join('|')})$`
);

const { env } = defineEnv({
  presets: [
    getCloudflarePreset({
      compatibilityDate: '2025-09-24',
      compatibilityFlags: ['nodejs_compat'],
    }),
  ],
  npmShims: true,
});

export function workersCompatPlugin(): Plugin {
  return {
    name: 'workers-compat',

    setup(build) {
      build.initialOptions.banner = {
        js: [env.inject?.default || []].flat().join('\n'),
      };

      if (env.alias) {
        build.initialOptions.alias = {
          ...build.initialOptions.alias,
          ...env.alias,
        };
      }

      if (env.external) {
        build.initialOptions.external = [
          ...(build.initialOptions.external ?? []),
          ...env.external,
        ];
      }

      build.onResolve({ filter: /^cloudflare:/ }, args => {
        return { path: args.path, external: true };
      });

      build.onResolve({ filter: /^@?calljmp(:|\/).*/ }, args => {
        return { path: args.path, external: true };
      });

      build.onResolve({ filter: nodejsModulesPattern }, args => {
        const moduleName = args.path.replace(/^node:/, '');
        const nodePath = `node:${moduleName}`;

        if (args.kind === 'require-call') {
          return { path: nodePath, namespace: 'node-builtin' };
        }

        const external =
          env.external?.includes(moduleName) ||
          env.external?.includes(nodePath);
        if (external) {
          return { path: nodePath, external: true };
        }

        return;
      });

      build.onLoad({ filter: /.*/, namespace: 'node-builtin' }, args => {
        return {
          contents: `import libDefault from '${args.path}'; module.exports = libDefault;`,
          loader: 'js',
        };
      });
    },
  };
}
