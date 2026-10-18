/**
 * Rule: complete-extracted-groups
 * 1. A `[FROM, VIA]` pair defined inside a `transitions([...])` variable must not be split
 *    across both the variable and the parent `createFSM` / `subMachine` array.
 * 2. Only extract transition groups into a `transitions([...])` variable when there are
 *    more than 3 cases (`minRows: 4` by default). Smaller groups (<= 3 rows) must stay inline.
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

export interface CompleteExtractedGroupsOptions {
  readonly minRows?: number;
}

export type MessageIds = 'splitExtractedGroup' | 'tooFewRowsToExtract';

export const completeExtractedGroups = createRule<
  [CompleteExtractedGroupsOptions?],
  MessageIds
>({
  name: 'complete-extracted-groups',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow splitting a [FROM, VIA] transition group across a transitions([...]) variable and a parent createFSM array, and require > 3 rows to justify extraction.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          minRows: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      splitExtractedGroup:
        "Transition group '[{{from}}, {{via}}]' is split between extracted variable '{{varName}}' and the parent machine. Extracted groups must be complete.",
      tooFewRowsToExtract:
        "Extracted transition group '{{varName}}' only has {{count}} row(s) (minimum is {{minRows}}, i.e. > 3 cases). Keep small groups inline in the matrix for readability.",
    },
  },
  defaultOptions: [{ minRows: 4 }],
  create(context, [userOptions]) {
    const minRows = userOptions?.minRows ?? 4;
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
            let validRowCount = 0;
            for (const el of arr.elements) {
              const parsed = parseTransitionRow(el);
              if (parsed) {
                validRowCount++;
                if (parsed.groupKey) {
                  keys.add(parsed.groupKey);
                }
              }
            }
            extractedGroupsByVar.set(node.id.name, keys);

            if (validRowCount < minRows) {
              context.report({
                node: node.init,
                messageId: 'tooFewRowsToExtract',
                data: {
                  varName: node.id.name,
                  count: String(validRowCount),
                  minRows: String(minRows),
                },
              });
            }
          }
        }
      },
      CallExpression(node: TSESTree.CallExpression) {
        const arrayNode = getMachineTransitionsArray(node);
        if (!arrayNode) {
          return;
        }

        // Map groupKey -> varName for all spread extracted variables in this machine
        const spreadGroupOwners = new Map<
          string,
          { varName: string; spreadNode: TSESTree.SpreadElement }
        >();

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
