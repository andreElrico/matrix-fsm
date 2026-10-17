/// <reference types='vitest' />
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import * as path from 'path';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/angular',
  resolve: {
    conditions: ['@matrix-fsm/source'],
    alias: {
      '@matrix-fsm/core': path.resolve(import.meta.dirname, '../core/src/index.ts'),
    },
  },
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(import.meta.dirname, 'tsconfig.lib.json'),
    }),
  ],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: 'src/index.ts',
      name: '@matrix-fsm/angular',
      fileName: 'index',
      formats: ['es' as const],
    },
    rolldownOptions: {
      external: ['@angular/core', '@ngrx/signals', 'effect', '@matrix-fsm/core'],
    },
  },
  test: {
    name: '@matrix-fsm/angular',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
