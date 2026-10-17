/**
 * Rule: complete-extracted-groups
 * A `[FROM, VIA]` pair defined inside a `transitions([...])` variable must not be split
 * across both the variable and the parent `createFSM` / `subMachine` array.
 */

import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import {
  getExtractedTransitionsArray,
  getMachineTransitionsArray,
  parseTransitionRow,
} from '../ast-utils.js';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export type MessageIds = 'splitExtractedGroup';

export const completeExtractedGroups = createRule<[], MessageIds>({
  name: 'complete-extracted-groups',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow splitting a [FROM, VIA] transition group across a transitions([...]) variable and a parent createFSM array.',
    },
    schema: [],
    messages: {
      splitExtractedGroup:
        "Transition group '[{{from}}, {{via}}]' is split between extracted variable '{{varName}}' and the parent machine. Extracted groups must be complete.",
    },
  },
  defaultOptions: [],
  create(context) {
    const extractedGroupsByVar = new Map<string, Set<string>>();

    return {
      VariableDeclarator(node: TSESTree.VariableDeclarator) {
        if (
          node.id.type === AST_NODE_TYPES.Identifier &&
          node.init?.type === AST_NODE_TYPES.CallExpression
        ) {
          const arr = getExtractedTransitionsArray(node.init);
          if (arr) {
            const keys = new Set<string>();
            for (const el of arr.elements) {
              const parsed = parseTransitionRow(el);
              if (parsed?.groupKey) {
                keys.add(parsed.groupKey);
              }
            }
            extractedGroupsByVar.set(node.id.name, keys);
          }
        }
      },
      CallExpression(node: TSESTree.CallExpression) {
        const arrayNode = getMachineTransitionsArray(node);
        if (!arrayNode) {
          return;
        }

        // Map groupKey -> varName for all spread extracted variables in this machine
        const spreadGroupOwners = new Map<string, { varName: string; spreadNode: TSESTree.SpreadElement }>();

        for (const el of arrayNode.elements) {
          if (
            el &&
            el.type === AST_NODE_TYPES.SpreadElement &&
            el.argument.type === AST_NODE_TYPES.Identifier
          ) {
            const varName = el.argument.name;
            const keys = extractedGroupsByVar.get(varName);
            if (!keys) {
              continue;
            }
            for (const key of keys) {
              const existing = spreadGroupOwners.get(key);
              if (existing && existing.varName !== varName) {
                const [from, via] = key.split('::');
                context.report({
                  node: el,
                  messageId: 'splitExtractedGroup',
                  data: {
                    from,
                    via,
                    varName,
                  },
                });
              } else {
                spreadGroupOwners.set(key, { varName, spreadNode: el });
              }
            }
          }
        }

        if (spreadGroupOwners.size === 0) {
          return;
        }

        // Check if any direct row in the parent array shares a groupKey with an extracted spread variable
        for (const el of arrayNode.elements) {
          const parsed = parseTransitionRow(el);
          if (!parsed || !parsed.groupKey) {
            continue;
          }
          const owner = spreadGroupOwners.get(parsed.groupKey);
          if (owner) {
            context.report({
              node: parsed.node,
              messageId: 'splitExtractedGroup',
              data: {
                from: parsed.fromKey ?? '',
                via: parsed.viaKey ?? '',
                varName: owner.varName,
              },
            });
          }
        }
      },
    };
  },
});
