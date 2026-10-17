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

        const groups = new Map<string, ParsedTransitionRow[]>();
        for (const el of arrayNode.elements) {
          const parsed = parseTransitionRow(el);
          if (!parsed || !parsed.groupKey) {
            continue;
          }
          const list = groups.get(parsed.groupKey) ?? [];
          list.push(parsed);
          groups.set(parsed.groupKey, list);
        }

        for (const [, rows] of groups) {
          let seenUnguarded = false;
          for (const row of rows) {
            if (seenUnguarded) {
              context.report({
                node: row.node,
                messageId: 'unreachableTransition',
                data: {
                  from: row.fromKey ?? '',
                  via: row.viaKey ?? '',
                },
              });
            } else if (!row.hasGuard) {
              seenUnguarded = true;
            }
          }
        }
      },
    };
  },
});
