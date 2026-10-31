/**
 * Rule: no-unreachable-transitions
 * An unguarded row for `[FROM, VIA]` must never appear above another row with the same `[FROM, VIA]`.
 */

import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import {
  getAnyTransitionsArray,
  parseTransitionRow,
  type ParsedTransitionRow,
} from '../ast-utils.js';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export type MessageIds = 'unreachableTransition';

export const noUnreachableTransitions = createRule<[], MessageIds>({
  name: 'no-unreachable-transitions',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow unguarded [FROM, VIA] transition rows appearing above other rows with the same [FROM, VIA].',
    },
    schema: [],
    messages: {
      unreachableTransition:
        "Transition row for '[{{from}}, {{via}}]' is unreachable because an earlier unguarded row for '[{{from}}, {{via}}]' always matches first (First-Match-Wins).",
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

        const extractViaKeys = (row: ParsedTransitionRow): string[] => {
          if (row.viaNode.type === 'ArrayExpression') {
            return row.viaNode.elements
              .map((el) =>
                el && el.type === 'Literal' && typeof el.value === 'string'
                  ? el.value
                  : null,
              )
              .filter((k): k is string => k !== null);
          }
          return row.viaKey ? [row.viaKey] : [];
        };

        const groups = new Map<string, ParsedTransitionRow[]>();
        const unguardedAnyStateEvents = new Set<string>();
        const shadowedByAnyState = new Set<ParsedTransitionRow>();
        const reportedNodes = new Set<TSESTree.Node>();

        for (const el of arrayNode.elements) {
          const parsed = parseTransitionRow(el);
          if (!parsed || !parsed.fromKey) {
            continue;
          }
          const viaKeys = extractViaKeys(parsed);
          if (viaKeys.length === 0) {
            continue;
          }
          for (const vKey of viaKeys) {
            if (
              parsed.fromKey !== 'anyState()' &&
              unguardedAnyStateEvents.has(vKey)
            ) {
              shadowedByAnyState.add(parsed);
            }
            if (parsed.fromKey === 'anyState()' && !parsed.hasGuard) {
              unguardedAnyStateEvents.add(vKey);
            }
            const gKey = `${parsed.fromKey}::${vKey}`;
            const list = groups.get(gKey) ?? [];
            list.push(parsed);
            groups.set(gKey, list);
          }
        }

        for (const [, rows] of groups) {
          let seenUnguarded = false;
          for (const row of rows) {
            if (seenUnguarded) {
              if (!reportedNodes.has(row.node)) {
                reportedNodes.add(row.node);
                context.report({
                  node: row.node,
                  messageId: 'unreachableTransition',
                  data: {
                    from: row.fromKey ?? '',
                    via: row.viaKey ?? '',
                  },
                });
              }
            } else if (!row.hasGuard) {
              seenUnguarded = true;
            }
          }
        }

        for (const row of shadowedByAnyState) {
          if (!reportedNodes.has(row.node)) {
            reportedNodes.add(row.node);
            context.report({
              node: row.node,
              messageId: 'unreachableTransition',
              data: {
                from: row.fromKey ?? '',
                via: row.viaKey ?? '',
              },
            });
          }
        }
      },
    };
  },
});
