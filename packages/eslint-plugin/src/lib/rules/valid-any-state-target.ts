/**
 * Rule: valid-any-state-target
 * Restricts `anyState()` in Column 1 (`FROM`) strictly to:
 * - `TO === stay()`
 * - `TO === finalState(...)`
 * - `TO === initial` (global reset to the machine's initial state)
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
  getMachineInitialStateKey,
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
        "Restrict anyState() in Column 1 (FROM) to stay(), finalState(), the machine's initial state, or VIA === 'ERROR', and forbid anyState() inside Column 1 state arrays.",
    },
    schema: [],
    messages: {
      invalidAnyStateTarget:
        "anyState() in Column 1 (FROM) is only allowed with stay(), finalState(), the machine's initial state, or when Column 2 (VIA) is 'ERROR' (no Hope-Driven state jumps to '{{target}}').",
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
        const initialKey = getMachineInitialStateKey(node);

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
            const isInitialReset =
              initialKey !== null &&
              parsed.toKey === initialKey &&
              parsed.awaitingCall === null;
            const isErrorVia =
              parsed.viaKey === 'ERROR' ||
              (parsed.viaNode.type === AST_NODE_TYPES.ArrayExpression &&
                parsed.viaNode.elements.some(
                  (v) => extractNodeKey(v) === 'ERROR',
                ));

            if (!isStayOrFinal && !isInitialReset && !isErrorVia) {
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
