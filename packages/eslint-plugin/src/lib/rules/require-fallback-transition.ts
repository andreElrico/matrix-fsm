/**
 * Rule: require-fallback-transition
 * If any row in a `[FROM, VIA]` group defines a `{ guard }`, the last row of that
 * `[FROM, VIA]` group must NOT have a `guard` (use `stay()` if no state change is desired).
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

export type MessageIds = 'missingFallback';

export const requireFallbackTransition = createRule<[], MessageIds>({
  name: 'require-fallback-transition',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require an unguarded fallback transition at the end of any guarded [FROM, VIA] group.',
    },
    schema: [],
    messages: {
      missingFallback:
        "Transition group '[{{from}}, {{via}}]' has guarded transitions, but its last row is also guarded. Add a final unguarded fallback row (use stay() if no state change is desired).",
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
          const hasAnyGuard = rows.some((r) => r.hasGuard);
          if (!hasAnyGuard) {
            continue;
          }
          const lastRow = rows[rows.length - 1];
          if (lastRow.hasGuard) {
            context.report({
              node: lastRow.node,
              messageId: 'missingFallback',
              data: {
                from: lastRow.fromKey ?? '',
                via: lastRow.viaKey ?? '',
              },
            });
          }
        }
      },
    };
  },
});
