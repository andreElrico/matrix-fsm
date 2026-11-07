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
      '@matrix-fsm/no-shadowed-transitions': 'error',
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
  alignMatrixColumns,
  awaitingNamingConvention,
  completeExtractedGroups,
  groupContiguousTransitions,
  noConflictingFinalOutput,
  noDuplicateCombinatorActors,
  noShadowedTransitions,
  noUnreachableStates,
  noUnreachableTransitions,
  pureMachineDefinition,
  requireAwaitingHandlers,
  requireExitForTargets,
  requireFallbackTransition,
  validAnyStateTarget,
  validTimerTransitions,
};
