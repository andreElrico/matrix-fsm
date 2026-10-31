/**
 * Rule: no-unreachable-states
 * Every state or sub-actor placed in Column 1 (`FROM`, excluding `anyState()`)
 * must either be the `initial` state of the machine or appear at least once
 * as a target in Column 3 (`TO`, including resolved local `...transitions([...])` spreads).
 */

import {
  AST_NODE_TYPES,
  ESLintUtils,
  type TSESTree,
} from '@typescript-eslint/utils';
import {
  getExtractedTransitionsArray,
  getMachineInitialStateKey,
  getMachineTransitionsArray,
  parseTransitionRow,
  type ParsedTransitionRow,
} from '../ast-utils.js';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export type MessageIds = 'unreachableState';

export const noUnreachableStates = createRule<[], MessageIds>({
  name: 'no-unreachable-states',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow states or sub-actors in Column 1 (FROM) that are neither the initial state nor entered in any Column 3 (TO).',
    },
    schema: [],
    messages: {
      unreachableState:
        "State '{{state}}' in Column 1 (FROM) is unreachable because it is neither the 'initial' state nor entered in any Column 3 (TO).",
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

        const initialKey = getMachineInitialStateKey(node);
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

        const reachableStates = new Set<string>();
        if (initialKey) {
          reachableStates.add(initialKey);
        }

        for (const row of allRows) {
          if (
            row.toKey &&
            row.toKey !== 'stay()' &&
            row.toKey !== 'finalState()' &&
            row.toKey !== row.fromKey
          ) {
            reachableStates.add(row.toKey);
            for (const childKey of row.toChildKeys) {
              if (childKey !== row.fromKey) {
                reachableStates.add(childKey);
              }
            }
          }
        }

        const reportedStates = new Set<string>();
        for (const row of allRows) {
          for (const fKey of row.fromKeys) {
            if (
              !fKey ||
              fKey === 'anyState()' ||
              reachableStates.has(fKey) ||
              reportedStates.has(fKey)
            ) {
              continue;
            }
            reportedStates.add(fKey);
            const displayName = fKey.startsWith('ref:')
              ? fKey.slice(4)
              : fKey;
            context.report({
              node: row.fromNode,
              messageId: 'unreachableState',
              data: {
                state: displayName,
              },
            });
          }
        }
      },
    };
  },
});
