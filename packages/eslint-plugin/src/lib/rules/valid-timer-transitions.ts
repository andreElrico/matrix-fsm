/**
 * Rule: valid-timer-transitions
 * Enforces the Timer Ontology:
 * 1. `after(ms)` in Column 2 (`VIA`) is a one-shot timeout and MUST change state (`stay()` in Column 3 is forbidden).
 * 2. `every(ms)` in Column 2 (`VIA`) is a recurring in-place interval and MUST use `stay()` in Column 3 (`TO`).
 */

import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import { getAnyTransitionsArray, parseTransitionRow } from '../ast-utils.js';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export type MessageIds = 'afterCannotStay' | 'everyMustStay';

export const validTimerTransitions = createRule<[], MessageIds>({
  name: 'valid-timer-transitions',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid stay() on after(ms) transitions and require stay() on every(ms) transitions.',
    },
    schema: [],
    messages: {
      afterCannotStay:
        "after(ms) in Column 2 (VIA) must transition out of '{{from}}'; stay() is forbidden on after() transitions (use every() for recurring intervals).",
      everyMustStay:
        "every(ms) in Column 2 (VIA) is a recurring interval and requires stay() in Column 3 (TO), not '{{target}}'.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node: TSESTree.CallExpression) {
        const arrayNode = getAnyTransitionsArray(node);
        if (!arrayNode) {
          return;
        }

        for (const el of arrayNode.elements) {
          const parsed = parseTransitionRow(el);
          if (!parsed || !parsed.viaKey) {
            continue;
          }

          if (parsed.viaKey.startsWith('after(')) {
            if (parsed.toKey === 'stay()') {
              context.report({
                node: parsed.toNode,
                messageId: 'afterCannotStay',
                data: {
                  from: parsed.fromKey ?? 'state',
                },
              });
            }
          } else if (parsed.viaKey.startsWith('every(')) {
            if (parsed.toKey !== 'stay()') {
              context.report({
                node: parsed.toNode,
                messageId: 'everyMustStay',
                data: {
                  target: parsed.targetDisplayName || parsed.toKey || 'target',
                },
              });
            }
          }
        }
      },
    };
  },
});

