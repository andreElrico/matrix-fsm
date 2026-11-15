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
            const fromArr = el.elements[0];
            const restEls = el.elements.slice(1);
            const canExpand =
              fromArr.elements.length > 0 &&
              fromArr.elements.every(
                (item): item is TSESTree.Expression =>
                  item !== null && item.type !== AST_NODE_TYPES.SpreadElement,
              ) &&
              restEls.length >= 2 &&
              restEls.every(
                (item): item is TSESTree.Expression =>
                  item !== null && item.type !== AST_NODE_TYPES.SpreadElement,
              );
            context.report({
              node: fromArr,
              messageId: 'noStateArrayInColumn1',
              fix: canExpand
                ? (fixer) => {
                    const sourceCode = context.sourceCode;
                    const indent = ' '.repeat(el.loc.start.column);
                    const restText = restEls
                      .map((r) => sourceCode.getText(r))
                      .join(', ');
                    const expanded = fromArr.elements
                      .map(
                        (item) =>
                          `[${sourceCode.getText(item!)}, ${restText}]`,
                      )
                      .join(`,\n${indent}`);
                    return fixer.replaceText(el, expanded);
                  }
                : null,
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
                      const nonNullElements = elements.filter(
                        (item): item is TSESTree.SpreadElement | TSESTree.Expression =>
                          item !== null,
                      );
                      const allComments = sourceCode.getCommentsInside(arrayNode);
                      const leadingByNode = new Map<TSESTree.Node, string[]>();
                      const trailingInlineByNode = new Map<TSESTree.Node, string[]>();

                      nonNullElements.forEach((item, idx) => {
                        const prev = nonNullElements[idx - 1];
                        const leading = sourceCode
                          .getCommentsBefore(item)
                          .filter(
                            (c) => !prev || c.loc.start.line > prev.loc.end.line,
                          )
                          .map((c) => sourceCode.text.slice(c.range[0], c.range[1]));
                        const trailingInline = allComments
                          .filter(
                            (c) =>
                              c.loc.start.line === item.loc.end.line &&
                              c.range[0] >= item.range[1],
                          )
                          .map((c) => sourceCode.text.slice(c.range[0], c.range[1]));
                        leadingByNode.set(item, leading);
                        trailingInlineByNode.set(item, trailingInline);
                      });

                      const lastItem = nonNullElements[nonNullElements.length - 1];
                      const footerComments = lastItem
                        ? allComments
                            .filter(
                              (c) =>
                                c.loc.start.line > lastItem.loc.end.line &&
                                c.range[1] < arrayNode.range[1],
                            )
                            .map((c) => `  ${sourceCode.text.slice(c.range[0], c.range[1])}`)
                        : [];

                      // Group contiguous elements by first appearance order of groupKey
                      const buckets = new Map<string, TSESTree.Node[]>();
                      const order: Array<{ type: 'group'; key: string } | { type: 'other'; node: TSESTree.Node }> = [];

                      for (const item of nonNullElements) {
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

                      const formattedRows = sortedNodes.map((n) => {
                        const leading = leadingByNode.get(n) ?? [];
                        const trailing = trailingInlineByNode.get(n) ?? [];
                        const prefix = leading.length > 0
                          ? `${leading.map((c) => `  ${c}`).join('\n')}\n`
                          : '';
                        const suffix = trailing.length > 0
                          ? ` ${trailing.join(' ')}`
                          : '';
                        return `${prefix}  ${sourceCode.getText(n)},${suffix}`;
                      });
                      const newBody = [...formattedRows, ...footerComments].join('\n');
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
