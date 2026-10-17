import { awaitingNamingConvention } from './lib/rules/awaiting-naming-convention.js';
import { completeExtractedGroups } from './lib/rules/complete-extracted-groups.js';
import { groupContiguousTransitions } from './lib/rules/group-contiguous-transitions.js';
import { noUnreachableTransitions } from './lib/rules/no-unreachable-transitions.js';
import { pureMachineDefinition } from './lib/rules/pure-machine-definition.js';
import { requireAwaitingHandlers } from './lib/rules/require-awaiting-handlers.js';
import { requireFallbackTransition } from './lib/rules/require-fallback-transition.js';

export const rules = {
  'group-contiguous-transitions': groupContiguousTransitions,
  'require-fallback-transition': requireFallbackTransition,
  'no-unreachable-transitions': noUnreachableTransitions,
  'require-awaiting-handlers': requireAwaitingHandlers,
  'awaiting-naming-convention': awaitingNamingConvention,
  'complete-extracted-groups': completeExtractedGroups,
  'pure-machine-definition': pureMachineDefinition,
};

export const plugin = {
  meta: {
    name: '@matrix-fsm/eslint-plugin',
    version: '0.0.1',
  },
  rules,
};

export const configs = {
  recommended: {
    plugins: {
      '@matrix-fsm': plugin,
    },
    rules: {
      '@matrix-fsm/group-contiguous-transitions': 'error',
      '@matrix-fsm/require-fallback-transition': 'error',
      '@matrix-fsm/no-unreachable-transitions': 'error',
      '@matrix-fsm/require-awaiting-handlers': 'error',
      '@matrix-fsm/awaiting-naming-convention': 'error',
      '@matrix-fsm/complete-extracted-groups': 'error',
      '@matrix-fsm/pure-machine-definition': 'error',
    },
  },
};

export default plugin;

export {
  awaitingNamingConvention,
  completeExtractedGroups,
  groupContiguousTransitions,
  noUnreachableTransitions,
  pureMachineDefinition,
  requireAwaitingHandlers,
  requireFallbackTransition,
};
