/**
 * Rule: require-awaiting-handlers
 * Every state wrapped in `awaiting('x')` in Column 3 must have at least one
 * `[ 'x', 'DONE', ... ]` row and at least one `[ 'x', 'ERROR', ... ]` row in Column 1.
 */

import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import {
  getExtractedTransitionsArray,
  getMachineTransitionsArray,
  parseTransitionRow,
  type ParsedTransitionRow,
} from '../ast-utils.js';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export type MessageIds = 'missingAwaitingHandlers';

export const requireAwaitingHandlers = createRule<[], MessageIds>({
  name: 'require-awaiting-handlers',
  meta: {
    type: 'problem',
    docs: {
      description:
        "Require every awaiting('x') state to have both a ['x', 'DONE', ...] and an ['x', 'ERROR', ...] transition row.",
    },
    schema: [],
    messages: {
      missingAwaitingHandlers:
        "Awaiting state '{{state}}' is missing mandatory {{missing}} transition row(s) in Column 1.",
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
        for (const el of arrayNode.elements) {
          if (!el) {
            continue;
          }
          if (
            el.type === AST_NODE_TYPES.SpreadElement &&
            el.argument.type === AST_NODE_TYPES.Identifier
          ) {
            const spreadRows = extractedVars.get(el.argument.name);
            if (spreadRows) {
              allRows.push(...spreadRows);
            }
            continue;
          }
          const parsed = parseTransitionRow(el);
          if (parsed) {
            allRows.push(parsed);
          }
        }

        const doneStates = new Set<string>();
        const errorStates = new Set<string>();

        for (const row of allRows) {
          if (row.fromKey && row.viaKey === 'DONE') {
            doneStates.add(row.fromKey);
          }
          if (row.fromKey && row.viaKey === 'ERROR') {
            errorStates.add(row.fromKey);
          }
        }

        for (const row of allRows) {
          if (!row.awaitingCall) {
            continue;
          }
          const { stateName, callNode } = row.awaitingCall;
          const hasDone = doneStates.has(stateName);
          const hasError = errorStates.has(stateName);

          if (!hasDone || !hasError) {
            const missingParts: string[] = [];
            if (!hasDone) {
              missingParts.push(`['${stateName}', 'DONE', ...]`);
            }
            if (!hasError) {
              missingParts.push(`['${stateName}', 'ERROR', ...]`);
            }
            context.report({
              node: callNode,
              messageId: 'missingAwaitingHandlers',
              data: {
                state: stateName,
                missing: missingParts.join(' and '),
              },
            });
          }
        }
      },
    };
  },
});
