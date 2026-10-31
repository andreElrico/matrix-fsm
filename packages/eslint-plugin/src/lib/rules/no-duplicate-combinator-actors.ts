/**
 * Rule: no-duplicate-combinator-actors
 * Forbids passing the same actor more than once to `all(...)`, `race(...)`, or `any(...)`,
 * as `all()` keys its output map by actor ID and duplicate actors would overwrite each other's outputs.
 */

import {
  AST_NODE_TYPES,
  ESLintUtils,
  type TSESTree,
} from '@typescript-eslint/utils';
import { extractNodeKey } from '../ast-utils.js';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export type MessageIds = 'duplicateCombinatorActor';

export const noDuplicateCombinatorActors = createRule<[], MessageIds>({
  name: 'no-duplicate-combinator-actors',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow duplicate actors inside all(...), race(...), or any(...) combinators.',
    },
    schema: [],
    messages: {
      duplicateCombinatorActor:
        "Duplicate actor '{{actor}}' inside '{{combinator}}(...)'. Each actor in a combinator must be unique.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node: TSESTree.CallExpression) {
        if (
          node.callee.type !== AST_NODE_TYPES.Identifier ||
          (node.callee.name !== 'all' &&
            node.callee.name !== 'race' &&
            node.callee.name !== 'any')
        ) {
          return;
        }

        const combinatorName = node.callee.name;
        const seen = new Set<string>();

        for (const arg of node.arguments) {
          const key = extractNodeKey(arg);
          if (!key) {
            continue;
          }
          const displayName = key.startsWith('ref:') ? key.slice(4) : key;
          if (seen.has(key)) {
            context.report({
              node: arg,
              messageId: 'duplicateCombinatorActor',
              data: {
                actor: displayName,
                combinator: combinatorName,
              },
            });
          } else {
            seen.add(key);
          }
        }
      },
    };
  },
});
