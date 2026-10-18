/**
 * Rule: align-matrix-columns
 * Enforces that the first 3 columns `[FROM, VIA, TO]` of every transition tuple
 * in `createFSM`, `subMachine`, and `transitions` are formatted on a single line
 * and vertically aligned into a strict 3-column Matrix.
 *
 * The 4th element (`OPTIONS`) may either follow on the same line or be placed on
 * the line underneath with standard formatting.
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

export interface AlignMatrixColumnsOptions {
  readonly minColumnGap?: number;
}

export type MessageIds =
  | 'brokenTripletLine'
  | 'unalignedMatrixColumns';

function normalizeSingleLineText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function buildAlignedTripletPrefix(
  row: ParsedTransitionRow,
  sourceCode: { getText(node?: TSESTree.Node): string },
  col1Width: number,
  col2Width: number,
  gap: number,
): string {
  const col1 = normalizeSingleLineText(sourceCode.getText(row.fromNode));
  const col2 = normalizeSingleLineText(sourceCode.getText(row.viaNode));
  const col3 = normalizeSingleLineText(sourceCode.getText(row.toNode));

  const col1Padded = `${col1},`.padEnd(col1Width + 1 + gap, ' ');
  const col2Padded = `${col2},`.padEnd(col2Width + 1 + gap, ' ');

  return `[${col1Padded}${col2Padded}${col3}`;
}

function fixRowTriplet(
  fixer: TSESLintFixer,
  row: ParsedTransitionRow,
  sourceCode: { getText(node?: TSESTree.Node): string },
  col1Width: number,
  col2Width: number,
  gap: number,
) {
  const prefix = buildAlignedTripletPrefix(
    row,
    sourceCode,
    col1Width,
    col2Width,
    gap,
  );
  if (!row.optionsNode) {
    return fixer.replaceText(row.node, `${prefix}]`);
  }
  return fixer.replaceTextRange(
    [row.node.range[0], row.toNode.range[1]],
    prefix,
  );
}

type TSESLintFixer = {
  replaceText(node: TSESTree.Node, text: string): any;
  replaceTextRange(range: readonly [number, number], text: string): any;
};

export const alignMatrixColumns = createRule<
  [AlignMatrixColumnsOptions?],
  MessageIds
>({
  name: 'align-matrix-columns',
  meta: {
    type: 'layout',
    docs: {
      description:
        'Enforce that the first 3 columns [FROM, VIA, TO] of every transition row are on the same line and vertically aligned as a matrix.',
    },
    fixable: 'whitespace',
    schema: [
      {
        type: 'object',
        properties: {
          minColumnGap: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      brokenTripletLine:
        "Transition triplet '[{{from}}, {{via}}, {{to}}]' must be on a single horizontal line (OPTIONS may wrap to the next line).",
      unalignedMatrixColumns:
        'Matrix columns [FROM, VIA, TO] are not vertically aligned across this transitions table.',
    },
  },
  defaultOptions: [
    {
      minColumnGap: 2,
    },
  ],
  create(context, [userOptions]) {
    const gap = userOptions?.minColumnGap ?? 2;

    return {
      CallExpression(node: TSESTree.CallExpression) {
        const arrayNode = getAnyTransitionsArray(node);
        if (!arrayNode) {
          return;
        }

        const sourceCode = context.sourceCode;
        const rows: ParsedTransitionRow[] = [];

        for (const el of arrayNode.elements) {
          const parsed = parseTransitionRow(el);
          if (parsed) {
            rows.push(parsed);
          }
        }

        if (rows.length === 0) {
          return;
        }

        const col1Width = Math.max(
          4,
          ...rows.map(
            (r) => normalizeSingleLineText(sourceCode.getText(r.fromNode)).length,
          ),
        );
        const col2Width = Math.max(
          3,
          ...rows.map(
            (r) => normalizeSingleLineText(sourceCode.getText(r.viaNode)).length,
          ),
        );

        // 1. Check that [FROM, VIA, TO] are on the same opening line of the tuple
        let hasBrokenTriplet = false;
        for (const row of rows) {
          const startLine = row.node.loc.start.line;
          const toEndLine = row.toNode.loc.end.line;
          const closingOnSameLineWhenNoOptions =
            row.optionsNode !== null || row.node.loc.end.line === startLine;

          if (startLine !== toEndLine || !closingOnSameLineWhenNoOptions) {
            hasBrokenTriplet = true;
            context.report({
              node: row.node,
              messageId: 'brokenTripletLine',
              data: {
                from:
                  row.fromKey ??
                  normalizeSingleLineText(sourceCode.getText(row.fromNode)),
                via:
                  row.viaKey ??
                  normalizeSingleLineText(sourceCode.getText(row.viaNode)),
                to: normalizeSingleLineText(sourceCode.getText(row.toNode)),
              },
              fix(fixer) {
                return rows.map((r) =>
                  fixRowTriplet(fixer, r, sourceCode, col1Width, col2Width, gap),
                );
              },
            });
          }
        }

        if (hasBrokenTriplet || rows.length < 2) {
          return;
        }

        // 2. Check vertical column alignment of FROM, VIA, TO across all rows
        const targetFromCol = rows[0].fromNode.loc.start.column;
        const targetViaCol = rows[0].viaNode.loc.start.column;
        const targetToCol = rows[0].toNode.loc.start.column;

        let isAligned = true;
        for (const row of rows) {
          const fromCol = row.fromNode.loc.start.column;
          const fromEndCol = row.fromNode.loc.end.column;
          const viaCol = row.viaNode.loc.start.column;
          const viaEndCol = row.viaNode.loc.end.column;
          const toCol = row.toNode.loc.start.column;

          if (
            fromCol !== targetFromCol ||
            viaCol !== targetViaCol ||
            toCol !== targetToCol ||
            viaCol - (fromEndCol + 1) < gap ||
            toCol - (viaEndCol + 1) < gap
          ) {
            isAligned = false;
            break;
          }
        }

        if (!isAligned) {
          context.report({
            node: arrayNode,
            messageId: 'unalignedMatrixColumns',
            fix(fixer) {
              return rows.map((r) =>
                fixRowTriplet(fixer, r, sourceCode, col1Width, col2Width, gap),
              );
            },
          });
        }
      },
    };
  },
});
