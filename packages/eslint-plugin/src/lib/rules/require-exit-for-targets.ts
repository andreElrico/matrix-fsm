/**
 * Rule: require-exit-for-targets
 * Every transient or active target node (`awaiting('...')`, sub-machine reference,
 * `all(...)`, `race(...)`, `any(...)`, `each(...)`) entered in Column 3 (`TO`)
 * must have at least one outgoing transition in Column 1 (`FROM`) that transitions
 * to a different state (`TO !== FROM` and `TO !== stay()`).
 * Resting string states (`'idle'`, `'orderConfirmed'`, etc.) are exempt.
 */

import {
  AST_NODE_TYPES,
  ESLintUtils,
  type TSESTree,
} from '@typescript-eslint/utils';
import {
  getExtractedTransitionsArray,
  getMachineTransitionsArray,
  parseTransitionRow,
  type ParsedTransitionRow,
} from '../ast-utils.js';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export type MessageIds = 'missingExitTransition';

export const requireExitForTargets = createRule<[], MessageIds>({
  name: 'require-exit-for-targets',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every transient or active target node (awaiting, sub-machine, combinator, each) entered in Column 3 (TO) to have at least one non-self-loop, non-stay() exit transition in Column 1 (FROM).',
    },
    schema: [],
    messages: {
      missingExitTransition:
        "Transient target '{{target}}' entered in Column 3 (TO) has no outgoing exit transition in Column 1 (FROM) where TO !== FROM and TO !== stay().",
    },
  },
  defaultOptions: [],
  create(context) {
    const extractedVars = new Map<string, ParsedTransitionRow[]>();

    return {
      VariableDeclarator(node: TSESTree.VariableDeclarator) {
        if (
          node.id.type === AST_NODE_TYPES.Identifier &&
          node.init?.type === AST_NODE_TYPES.CallExpression
        ) {
          const arr = getExtractedTransitionsArray(node.init);
          if (arr) {
            const rows: ParsedTransitionRow[] = [];
            for (const el of arr.elements) {
              const parsed = parseTransitionRow(el);
              if (parsed) {
                rows.push(parsed);
              }
            }
            extractedVars.set(node.id.name, rows);
          }
        }
      },
      CallExpression(node: TSESTree.CallExpression) {
        const arrayNode = getMachineTransitionsArray(node);
        if (!arrayNode) {
          return;
        }

        const allRows: ParsedTransitionRow[] = [];
        let hasUnresolvedSpread = false;

        for (const el of arrayNode.elements) {
          if (!el) {
            continue;
          }
          if (el.type === AST_NODE_TYPES.SpreadElement) {
            if (el.argument.type === AST_NODE_TYPES.Identifier) {
              const spreadRows = extractedVars.get(el.argument.name);
              if (spreadRows) {
                allRows.push(...spreadRows);
              } else {
                hasUnresolvedSpread = true;
              }
            } else {
              hasUnresolvedSpread = true;
            }
            continue;
          }
          const parsed = parseTransitionRow(el);
          if (parsed) {
            allRows.push(parsed);
          }
        }

        if (hasUnresolvedSpread) {
          return;
        }

        const statesWithValidExit = new Set<string>();
        for (const row of allRows) {
          for (const fKey of row.fromKeys) {
            if (
              fKey &&
              row.toKey &&
              row.toKey !== 'stay()' &&
              row.toKey !== fKey
            ) {
              statesWithValidExit.add(fKey);
            }
          }
        }

        for (const row of allRows) {
          if (!row.isTransientTarget || !row.toKey) {
            continue;
          }
          if (!statesWithValidExit.has(row.toKey)) {
            context.report({
              node: row.toNode,
              messageId: 'missingExitTransition',
              data: {
                target: row.targetDisplayName || row.toKey,
              },
            });
          }
        }
      },
    };
  },
});
