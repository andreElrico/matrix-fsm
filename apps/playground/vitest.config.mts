/// <reference types='vitest' />
import { defineConfig } from 'vite';
import * as path from 'path';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/playground',
  resolve: {
    conditions: ['@matrix-fsm/source'],
    alias: {
      '@matrix-fsm/core': path.resolve(
        import.meta.dirname,
        '../../packages/core/src/index.ts',
      ),
      '@matrix-fsm/angular': path.resolve(
        import.meta.dirname,
        '../../packages/angular/src/index.ts',
      ),
      '@matrix-fsm/router': path.resolve(
        import.meta.dirname,
        '../../packages/router/src/index.ts',
      ),
      '@matrix-fsm/eslint-plugin': path.resolve(
        import.meta.dirname,
        '../../packages/eslint-plugin/src/index.ts',
      ),
    },
  },
  test: {
    name: '@matrix-fsm/playground',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
  },
}));
