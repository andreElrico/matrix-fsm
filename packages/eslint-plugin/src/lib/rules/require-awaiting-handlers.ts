/**
 * Rule: require-awaiting-handlers
 * Every state wrapped in `awaiting('x')` in Column 3 must have at least one
 * `[ 'x', 'DONE', ... ]` row and at least one `[ 'x', 'ERROR', ... ]` row in Column 1.
 */

import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import {
  getExtractedTransitionsArray,
  getMachineTransitionsArray,
  hasCallOption,
  parseTransitionRow,
  type ParsedTransitionRow,
} from '../ast-utils.js';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export type MessageIds = 'missingAwaitingHandlers' | 'missingAwaitingCall';

export const requireAwaitingHandlers = createRule<[], MessageIds>({
  name: 'require-awaiting-handlers',
  meta: {
    type: 'problem',
    docs: {
      description:
        "Require every awaiting('x') state to have a { call } option on entry and both an outcome ('DONE' or named outcome) and an 'ERROR' transition row.",
    },
    schema: [],
    messages: {
      missingAwaitingHandlers:
        "Awaiting state '{{state}}' is missing mandatory {{missing}} transition row(s) in Column 1.",
      missingAwaitingCall:
        "Transition into awaiting('{{state}}') requires a '{ call: (m) => m._method }' option in Column 4.",
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

        const awaitingStateNames = new Set<string>();
        for (const row of allRows) {
          if (row.awaitingCall) {
            awaitingStateNames.add(row.awaitingCall.stateName);
          }
        }

        const externalEvents = new Set<string>(['CANCEL', 'ERROR']);
        for (const row of allRows) {
          const viaKeys =
            row.viaNode.type === AST_NODE_TYPES.ArrayExpression
              ? row.viaNode.elements
                  .map((el) =>
                    el &&
                    el.type === AST_NODE_TYPES.Literal &&
                    typeof el.value === 'string'
                      ? el.value
                      : null,
                  )
                  .filter((k): k is string => k !== null)
              : row.viaKey
                ? [row.viaKey]
                : [];
          const isFromNonAwaiting = row.fromKeys.some(
            (fKey) => fKey !== 'anyState()' && !awaitingStateNames.has(fKey),
          );
          if (isFromNonAwaiting) {
            for (const v of viaKeys) {
              if (v !== 'DONE' && v !== 'ALL_DONE') {
                externalEvents.add(v);
              }
            }
          }
        }

        const doneStates = new Set<string>();
        const errorStates = new Set<string>();

        for (const row of allRows) {
          const viaKeys =
            row.viaNode.type === AST_NODE_TYPES.ArrayExpression
              ? row.viaNode.elements
                  .map((el) =>
                    el &&
                    el.type === AST_NODE_TYPES.Literal &&
                    typeof el.value === 'string'
                      ? el.value
                      : null,
                  )
                  .filter((k): k is string => k !== null)
              : row.viaKey
                ? [row.viaKey]
                : [];
          for (const fKey of row.fromKeys) {
            if (
              viaKeys.includes('DONE') ||
              viaKeys.includes('ALL_DONE') ||
              (awaitingStateNames.has(fKey) &&
                viaKeys.some(
                  (v) =>
                    !externalEvents.has(v) &&
                    !v.startsWith('after(') &&
                    !v.startsWith('every(') &&
                    v !== 'always()',
                ))
            ) {
              doneStates.add(fKey);
            }
            if (viaKeys.includes('ERROR')) {
              errorStates.add(fKey);
            }
          }
        }

        for (const row of allRows) {
          if (row.anyCombinatorCall && !hasUnresolvedSpread) {
            const { stateKey, callNode } = row.anyCombinatorCall;
            const hasError =
              errorStates.has(stateKey) || errorStates.has('anyState()');
            if (!hasError) {
              context.report({
                node: callNode,
                messageId: 'missingAwaitingHandlers',
                data: {
                  state: 'any(...)',
                  missing: `[any(...), 'ERROR', ...]`,
                },
              });
            }
          }
          if (!row.awaitingCall) {
            continue;
          }
          const { stateName, callNode } = row.awaitingCall;
          if (!hasCallOption(row.optionsNode)) {
            context.report({
              node: callNode,
              messageId: 'missingAwaitingCall',
              data: {
                state: stateName,
              },
            });
          }
          if (hasUnresolvedSpread) {
            continue;
          }
          const hasDone =
            doneStates.has(stateName) || doneStates.has('anyState()');
          const hasError =
            errorStates.has(stateName) || errorStates.has('anyState()');

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
