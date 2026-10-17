/**
 * Rule: group-contiguous-transitions
 * All rows sharing the exact same `[FROM, VIA]` pair must be placed directly adjacent to each other.
 * Also forbids state arrays `['stateA', 'stateB']` in Column 1.
 */

import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import { getAnyTransitionsArray, parseTransitionRow } from '../ast-utils.js';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export type MessageIds = 'nonContiguousGroup' | 'noStateArrayInColumn1';

export const groupContiguousTransitions = createRule<[], MessageIds>({
  name: 'group-contiguous-transitions',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce that all transition rows sharing the same [FROM, VIA] pair are placed directly adjacent to each other.',
    },
    fixable: 'code',
    schema: [],
    messages: {
      nonContiguousGroup:
        "Transition row for '[{{from}}, {{via}}]' is separated from its previous '[{{from}}, {{via}}]' group. All rows sharing the same [FROM, VIA] must be contiguous.",
      noStateArrayInColumn1:
        'State arrays in Column 1 (FROM) are forbidden to preserve strict transition grouping. Use subMachine() for shared exits.',
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

        const elements = arrayNode.elements;
        const seenGroups = new Set<string>();
        let lastGroupKey: string | null = null;
        let hasViolation = false;

        for (const el of elements) {
          if (!el) {
            continue;
          }
          if (
            el.type === AST_NODE_TYPES.ArrayExpression &&
            el.elements[0]?.type === AST_NODE_TYPES.ArrayExpression
          ) {
            context.report({
              node: el.elements[0],
              messageId: 'noStateArrayInColumn1',
            });
            continue;
          }

          const parsed = parseTransitionRow(el);
          if (!parsed || !parsed.groupKey) {
            lastGroupKey = null;
            continue;
          }

          if (parsed.groupKey !== lastGroupKey) {
            if (seenGroups.has(parsed.groupKey)) {
              hasViolation = true;
              context.report({
                node: parsed.node,
                messageId: 'nonContiguousGroup',
                data: {
                  from: parsed.fromKey ?? '',
                  via: parsed.viaKey ?? '',
                },
                fix: hasViolation
                  ? (fixer) => {
                      const sourceCode = context.sourceCode;
                      // Group contiguous elements by first appearance order of groupKey
                      const buckets = new Map<string, TSESTree.Node[]>();
                      const order: Array<{ type: 'group'; key: string } | { type: 'other'; node: TSESTree.Node }> = [];

                      for (const item of elements) {
                        if (!item) {
                          continue;
                        }
                        const row = parseTransitionRow(item);
                        if (row && row.groupKey) {
                          if (!buckets.has(row.groupKey)) {
                            buckets.set(row.groupKey, []);
                            order.push({ type: 'group', key: row.groupKey });
                          }
                          buckets.get(row.groupKey)!.push(item);
                        } else {
                          order.push({ type: 'other', node: item });
                        }
                      }

                      const sortedNodes: TSESTree.Node[] = [];
                      for (const entry of order) {
                        if (entry.type === 'group') {
                          sortedNodes.push(...(buckets.get(entry.key) ?? []));
                        } else {
                          sortedNodes.push(entry.node);
                        }
                      }

                      const newBody = sortedNodes
                        .map((n) => `  ${sourceCode.getText(n)},`)
                        .join('\n');
                      return fixer.replaceText(arrayNode, `[\n${newBody}\n]`);
                    }
                  : null,
              });
            } else {
              seenGroups.add(parsed.groupKey);
            }
            lastGroupKey = parsed.groupKey;
          }
        }
      },
    };
  },
});
