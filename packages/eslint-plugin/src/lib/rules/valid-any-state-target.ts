/**
 * Rule: valid-any-state-target
 * Restricts `anyState()` in Column 1 (`FROM`) strictly to:
 * - `TO === stay()`
 * - `TO === finalState(...)`
 * - `VIA === 'ERROR'`
 * Also forbids placing `anyState()` inside a Column 1 (`FROM`) state array.
 */

import {
  AST_NODE_TYPES,
  ESLintUtils,
  type TSESTree,
} from '@typescript-eslint/utils';
import {
  extractNodeKey,
  getAnyTransitionsArray,
  parseTransitionRow,
} from '../ast-utils.js';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export type MessageIds = 'invalidAnyStateTarget' | 'anyStateInArray';

export const validAnyStateTarget = createRule<[], MessageIds>({
  name: 'valid-any-state-target',
  meta: {
    type: 'problem',
    docs: {
      description:
        "Restrict anyState() in Column 1 (FROM) to stay(), finalState(), or VIA === 'ERROR', and forbid anyState() inside Column 1 state arrays.",
    },
    schema: [],
    messages: {
      invalidAnyStateTarget:
        "anyState() in Column 1 (FROM) is only allowed with stay(), finalState(), or when Column 2 (VIA) is 'ERROR' (no Hope-Driven state jumps to '{{target}}').",
      anyStateInArray:
        'anyState() cannot be used inside a Column 1 (FROM) state array.',
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
          if (!parsed) {
            continue;
          }

          if (parsed.fromNode.type === AST_NODE_TYPES.ArrayExpression) {
            const hasAnyState = parsed.fromNode.elements.some(
              (item) => extractNodeKey(item) === 'anyState()',
            );
            if (hasAnyState) {
              context.report({
                node: parsed.fromNode,
                messageId: 'anyStateInArray',
              });
            }
            continue;
          }

          if (parsed.fromKey === 'anyState()') {
            const isStayOrFinal =
              parsed.toKey === 'stay()' || parsed.toKey === 'finalState()';
            const isErrorVia = parsed.viaKey === 'ERROR';

            if (!isStayOrFinal && !isErrorVia) {
              context.report({
                node: parsed.toNode,
                messageId: 'invalidAnyStateTarget',
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

