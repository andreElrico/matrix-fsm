/**
 * Rule: awaiting-naming-convention
 * State names inside `awaiting('...')` must use the present participle suffix `-ing`
 * (e.g., `'authenticating'`, `'loadingData'`).
 */

import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export type MessageIds = 'invalidAwaitingName';

function isPresentParticipleStateName(name: string): boolean {
  if (name.endsWith('ing') && name.length > 3) {
    return true;
  }
  // Also allow camelCase starting with a present participle verb, e.g. 'loadingData', 'fetchingUser'
  const firstWordMatch = name.match(/^[a-z]+/);
  if (
    firstWordMatch &&
    firstWordMatch[0].endsWith('ing') &&
    firstWordMatch[0].length > 3
  ) {
    return true;
  }
  return false;
}

export const awaitingNamingConvention = createRule<[], MessageIds>({
  name: 'awaiting-naming-convention',
  meta: {
    type: 'problem',
    docs: {
      description:
        "Enforce that state names inside awaiting('...') use the present participle '-ing' form (e.g., 'authenticating', 'loadingData').",
    },
    schema: [],
    messages: {
      invalidAwaitingName:
        "Awaiting state '{{state}}' must use the present participle '-ing' form (e.g., 'authenticating', 'loadingData').",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node: TSESTree.CallExpression) {
        if (
          node.callee.type !== AST_NODE_TYPES.Identifier ||
          node.callee.name !== 'awaiting' ||
          node.arguments.length === 0
        ) {
          return;
        }

        const arg = node.arguments[0];
        if (arg.type === AST_NODE_TYPES.Literal && typeof arg.value === 'string') {
          if (!isPresentParticipleStateName(arg.value)) {
            context.report({
              node: arg,
              messageId: 'invalidAwaitingName',
              data: {
                state: arg.value,
              },
            });
          }
        }
      },
    };
  },
});
