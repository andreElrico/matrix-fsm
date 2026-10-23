/**
 * Rule: no-conflicting-final-output
 * Forbids combining a named `finalState('OUTCOME')` (with argument !== 'DONE') in Column 3
 * with `{ output: ... }` in Column 4 (`TransitionOptions`).
 */

import {
  AST_NODE_TYPES,
  ESLintUtils,
  type TSESTree,
} from '@typescript-eslint/utils';
import { getAnyTransitionsArray, parseTransitionRow } from '../ast-utils.js';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export type MessageIds = 'conflictingFinalOutput';

function getNamedFinalStateOutcome(node: TSESTree.Node): string | null {
  if (
    node.type !== AST_NODE_TYPES.CallExpression ||
    node.callee.type !== AST_NODE_TYPES.Identifier ||
    node.callee.name !== 'finalState' ||
    node.arguments.length === 0
  ) {
    return null;
  }
  const firstArg = node.arguments[0];
  if (
    firstArg.type === AST_NODE_TYPES.Identifier &&
    firstArg.name === 'undefined'
  ) {
    return null;
  }
  if (
    firstArg.type === AST_NODE_TYPES.Literal &&
    typeof firstArg.value === 'string'
  ) {
    return firstArg.value !== 'DONE' ? firstArg.value : null;
  }
  return 'NAMED';
}

function getOutputProperty(
  optionsNode: TSESTree.Node | null,
): TSESTree.Property | null {
  if (!optionsNode || optionsNode.type !== AST_NODE_TYPES.ObjectExpression) {
    return null;
  }
  for (const prop of optionsNode.properties) {
    if (
      prop.type === AST_NODE_TYPES.Property &&
      ((prop.key.type === AST_NODE_TYPES.Identifier &&
        prop.key.name === 'output') ||
        (prop.key.type === AST_NODE_TYPES.Literal &&
          prop.key.value === 'output'))
    ) {
      if (
        prop.value.type === AST_NODE_TYPES.Identifier &&
        prop.value.name === 'undefined'
      ) {
        return null;
      }
      return prop;
    }
  }
  return null;
}

export const noConflictingFinalOutput = createRule<[], MessageIds>({
  name: 'no-conflicting-final-output',
  meta: {
    type: 'problem',
    docs: {
      description:
        "Forbid combining named `finalState('OUTCOME')` in Column 3 with `{ output: ... }` in Column 4.",
    },
    schema: [],
    messages: {
      conflictingFinalOutput:
        "Cannot combine named finalState('{{outcome}}') in Column 3 with `{ output: ... }` in Column 4. Use either `finalState('{{outcome}}')` (for void outcomes) or `finalState()` with `{ output: [...] }`.",
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
          const outcome = getNamedFinalStateOutcome(parsed.toNode);
          if (!outcome) {
            continue;
          }
          const outputProp = getOutputProperty(parsed.optionsNode);
          if (outputProp) {
            context.report({
              node: outputProp,
              messageId: 'conflictingFinalOutput',
              data: { outcome },
            });
          }
        }
      },
    };
  },
});
