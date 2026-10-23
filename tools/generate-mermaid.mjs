#!/usr/bin/env node
/**
 * Zero-Angular CLI Mermaid Diagram Generator (`pnpm mermaid <file>`)
 * Evaluates any `*.machine.ts` or `*.feature.ts` file without booting Angular
 * and prints `toMermaid(fsm)` for every exported FSMDefinition.
 */

import * as path from 'node:path';
import { createJiti } from 'jiti';

const targetArg =
  process.argv[2] ??
  'apps/playground/src/app/features/coffee-shop/coffee-shop.machine.ts';
const resolvedPath = path.resolve(process.cwd(), targetArg);

const jiti = createJiti(import.meta.url, {
  alias: {
    '@matrix-fsm/core': path.resolve(
      process.cwd(),
      'packages/core/src/index.ts',
    ),
    '@matrix-fsm/angular': path.resolve(
      process.cwd(),
      'packages/angular/src/index.ts',
    ),
  },
});

const { isFSMDefinition, toMermaid } = await jiti.import('@matrix-fsm/core');
const mod = await jiti.import(resolvedPath);

for (const [exportName, value] of Object.entries(mod)) {
  if (isFSMDefinition(value)) {
    console.log(`# ${exportName} (${value.id})\n`);
    console.log('```mermaid');
    console.log(toMermaid(value));
    console.log('```\n');
  }
}
