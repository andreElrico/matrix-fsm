import { alignMatrixColumns } from './lib/rules/align-matrix-columns.js';
import { awaitingNamingConvention } from './lib/rules/awaiting-naming-convention.js';
import { completeExtractedGroups } from './lib/rules/complete-extracted-groups.js';
import { groupContiguousTransitions } from './lib/rules/group-contiguous-transitions.js';
import { noConflictingFinalOutput } from './lib/rules/no-conflicting-final-output.js';
import { noDuplicateCombinatorActors } from './lib/rules/no-duplicate-combinator-actors.js';
import { noShadowedTransitions } from './lib/rules/no-shadowed-transitions.js';
import { noUnreachableStates } from './lib/rules/no-unreachable-states.js';
import { noUnreachableTransitions } from './lib/rules/no-unreachable-transitions.js';
import { pureMachineDefinition } from './lib/rules/pure-machine-definition.js';
import { requireAwaitingHandlers } from './lib/rules/require-awaiting-handlers.js';
import { requireExitForTargets } from './lib/rules/require-exit-for-targets.js';
import { requireFallbackTransition } from './lib/rules/require-fallback-transition.js';
import { validAnyStateTarget } from './lib/rules/valid-any-state-target.js';
import { validTimerTransitions } from './lib/rules/valid-timer-transitions.js';

/**
 * Dictionary of all 14 canonical `@matrix-fsm/eslint-plugin` rules plus the deprecated
 * `no-shadowed-transitions` alias.
 *
 * @group Plugin & Configs
 */
export const rules = {
  'align-matrix-columns': alignMatrixColumns,
  'group-contiguous-transitions': groupContiguousTransitions,
  'require-fallback-transition': requireFallbackTransition,
  'no-unreachable-transitions': noUnreachableTransitions,
  'no-shadowed-transitions': noShadowedTransitions,
  'no-duplicate-combinator-actors': noDuplicateCombinatorActors,
  'require-awaiting-handlers': requireAwaitingHandlers,
  'awaiting-naming-convention': awaitingNamingConvention,
  'complete-extracted-groups': completeExtractedGroups,
  'pure-machine-definition': pureMachineDefinition,
  'no-conflicting-final-output': noConflictingFinalOutput,
  'require-exit-for-targets': requireExitForTargets,
  'no-unreachable-states': noUnreachableStates,
  'valid-any-state-target': validAnyStateTarget,
  'valid-timer-transitions': validTimerTransitions,
};

/**
 * ESLint 9+ flat plugin object containing `meta`, `rules`, and `configs.recommended`.
 *
 * @group Plugin & Configs
 * @example
 * ```js
 * // eslint.config.mjs
 * import matrixFsm from '@matrix-fsm/eslint-plugin';
 *
 * export default [
 *   matrixFsm.configs.recommended,
 * ];
 * ```
 */
export const plugin: {
  meta: { name: string; version: string };
  rules: typeof rules;
  configs: {
    recommended: {
      plugins: Record<string, unknown>;
      rules: Record<string, string>;
    };
  };
} = {
  meta: {
    name: '@matrix-fsm/eslint-plugin',
    version: '0.0.1',
  },
  rules,
  configs: null as any,
};

/**
 * Preconfigured ESLint flat-config presets for `@matrix-fsm`.
 *
 * @group Plugin & Configs
 * @remarks
 * `configs.recommended` enables all 14 canonical static AST and graph-conservation rules at `'error'`
 * severity for TypeScript files (`.ts`, `.tsx`, `.mts`, and `.cts`).
 */
export const configs = {
  recommended: {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    plugins: {
      '@matrix-fsm': plugin,
    },
    rules: {
      '@matrix-fsm/align-matrix-columns': 'error',
      '@matrix-fsm/group-contiguous-transitions': 'error',
      '@matrix-fsm/require-fallback-transition': 'error',
      '@matrix-fsm/no-unreachable-transitions': 'error',
      '@matrix-fsm/no-duplicate-combinator-actors': 'error',
      '@matrix-fsm/require-awaiting-handlers': 'error',
      '@matrix-fsm/awaiting-naming-convention': 'error',
      '@matrix-fsm/complete-extracted-groups': 'error',
      '@matrix-fsm/pure-machine-definition': 'error',
      '@matrix-fsm/no-conflicting-final-output': 'error',
      '@matrix-fsm/require-exit-for-targets': 'error',
      '@matrix-fsm/no-unreachable-states': 'error',
      '@matrix-fsm/valid-any-state-target': 'error',
      '@matrix-fsm/valid-timer-transitions': 'error',
    },
  },
};

plugin.configs = configs;

export default plugin;

export {
  /** Enforces single-line `[FROM, VIA, TO]` and vertical column alignment across the matrix (`--fix`). @group Rules */
  alignMatrixColumns,
  /** Enforces `-ing` suffix naming for every `awaiting('...ing')` state. @group Rules */
  awaitingNamingConvention,
  /** Ensures extracted `transitions([...])` groups have > 3 rows and do not split `[FROM, VIA]` groups. @group Rules */
  completeExtractedGroups,
  /** Enforces contiguous grouping of identical `[FROM, VIA]` rows and expands array shorthands (`--fix`). @group Rules */
  groupContiguousTransitions,
  /** Forbids combining named `finalState('NAME')` with `options.output` or `stay()` on terminal child outputs. @group Rules */
  noConflictingFinalOutput,
  /** Forbids duplicate actor references inside `all()`, `race()`, or `any()` without `subMachine(fsm, 'alias')`. @group Rules */
  noDuplicateCombinatorActors,
  /** @deprecated Use {@link noUnreachableTransitions} (`@matrix-fsm/no-unreachable-transitions`) instead. @group Rules */
  noShadowedTransitions,
  /** Ensures every state or actor in Column 1 (`FROM`) is `initial` or reachable via Column 3 (`TO`). @group Rules */
  noUnreachableStates,
  /** Forbids unreachable rows placed after an unguarded row with the same `[FROM, VIA]` or unguarded `anyState()`. @group Rules */
  noUnreachableTransitions,
  /** Forbids Angular/service imports or `inject()` inside `*.machine.ts` / `transitions` arrays and enforces `(m) => m._method`. @group Rules */
  pureMachineDefinition,
  /** Ensures every `awaiting()` state specifies `{ call }` and handles both `'DONE'`/`outcome()` and `'ERROR'`. @group Rules */
  requireAwaitingHandlers,
  /** Ensures every active target (`awaiting`, sub-machine, combinator) in `TO` has at least one non-`stay()` exit in `FROM`. @group Rules */
  requireExitForTargets,
  /** Requires every guarded `[FROM, VIA]` group to terminate with an unguarded fallback row. @group Rules */
  requireFallbackTransition,
  /** Restricts `anyState()` targets to `stay()`, `finalState()`, `initial`, or `VIA === 'ERROR'`. @group Rules */
  validAnyStateTarget,
  /** Enforces that `after(ms)` leaves the state and `every(ms)` targets `stay()`. @group Rules */
  validTimerTransitions,
};
