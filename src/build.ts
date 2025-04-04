import NodeModulesPolyfillPlugin from '@esbuild-plugins/node-modules-polyfill';
import esbuild, { BuildOptions } from 'esbuild';

export async function build({
  entryPoints,
  debug,
}: {
  entryPoints: string | string[];
  debug?: boolean;
}) {
  const buildOptions: BuildOptions = {
    plugins: [NodeModulesPolyfillPlugin()],
    entryPoints: [entryPoints].flat(),
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'es2021',
    logLevel: 'warning',
    bundle: true,
    minify: !debug,
  };

  const result = await esbuild.build(buildOptions);

  const { outputFiles } = result;
  if (!outputFiles || outputFiles.length === 0) {
    throw new Error('No output files generated');
  }

  const outputFile = outputFiles[0];
  return outputFile.text;
}
