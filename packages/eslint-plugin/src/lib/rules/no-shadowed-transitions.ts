/**
 * Rule: no-shadowed-transitions (Deprecated alias of `no-unreachable-transitions`)
 * Prevents an unguarded `[FROM, VIA]` row from shadowing a subsequent row with the same `[FROM, VIA]`
 * (including VIA event arrays) under First-Match-Wins evaluation.
 */

import { ESLintUtils } from '@typescript-eslint/utils';
import {
  noUnreachableTransitions,
  type MessageIds,
} from './no-unreachable-transitions.js';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export const noShadowedTransitions = createRule<[], MessageIds>({
  name: 'no-shadowed-transitions',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Deprecated alias for no-unreachable-transitions: disallow unguarded transition rows that shadow subsequent rows.',
    },
    deprecated: true,
    replacedBy: ['no-unreachable-transitions'],
    schema: [],
    messages: noUnreachableTransitions.meta.messages,
  },
  defaultOptions: [],
  create: noUnreachableTransitions.create,
});
