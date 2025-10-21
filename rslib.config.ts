import { defineConfig } from '@rslib/core';
import { pluginPublint } from 'rsbuild-plugin-publint';

export default defineConfig({
  plugins: [pluginPublint()],
  lib: [
    {
      bundle: true,
      dts: true,
      syntax: 'es2022',
      format: 'esm',
      source: {
        entry: {
          index: './src/index.ts',
        },
      },
      output: {
        externals: ['react-reconciler'],
      },
    },
    {
      bundle: false,
      dts: false,
      syntax: 'es2022',
      format: 'cjs',
      source: {
        entry: {
          index: './src/index.ts',
        },
      },
      output: {
        externals: ['react-reconciler'],
      },
    },
  ],
});
