/**
 * @matrix-fsm/eslint-plugin - Shared AST Inspection Utilities for Matrix Tuples
 */

import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

export interface ParsedTransitionRow {
  readonly node: TSESTree.ArrayExpression;
  readonly fromNode: TSESTree.Node;
  readonly viaNode: TSESTree.Node;
  readonly toNode: TSESTree.Node;
  readonly optionsNode: TSESTree.Node | null;
  readonly fromKey: string | null;
  readonly viaKey: string | null;
  readonly groupKey: string | null;
  readonly hasGuard: boolean;
  readonly awaitingCall: {
    readonly callNode: TSESTree.CallExpression;
    readonly stateName: string;
  } | null;
}

export function extractNodeKey(
  node: TSESTree.Node | null | undefined,
): string | null {
  if (!node) {
    return null;
  }
  if (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') {
    return node.value;
  }
  if (
    node.type === AST_NODE_TYPES.TemplateLiteral &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  }
  if (node.type === AST_NODE_TYPES.Identifier) {
    return `ref:${node.name}`;
  }
  if (
    node.type === AST_NODE_TYPES.CallExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === 'each' &&
    node.arguments.length >= 1
  ) {
    const firstArg = extractNodeKey(node.arguments[0]);
    if (firstArg) {
      return `each:${firstArg}`;
    }
  }
  if (
    node.type === AST_NODE_TYPES.CallExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === 'after' &&
    node.arguments.length >= 1
  ) {
    const firstArg = node.arguments[0];
    if (
      firstArg.type === AST_NODE_TYPES.Literal &&
      typeof firstArg.value === 'number'
    ) {
      return `after(${firstArg.value})`;
    }
    const argKey = extractNodeKey(firstArg);
    if (argKey) {
      return `after(${argKey})`;
    }
  }
  return null;
}

export function extractAwaitingCall(
  node: TSESTree.Node | null | undefined,
): {
  readonly callNode: TSESTree.CallExpression;
  readonly stateName: string;
} | null {
  if (!node || node.type !== AST_NODE_TYPES.CallExpression) {
    return null;
  }
  if (
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === 'awaiting' &&
    node.arguments.length >= 1
  ) {
    const arg = node.arguments[0];
    if (arg.type === AST_NODE_TYPES.Literal && typeof arg.value === 'string') {
      return {
        callNode: node,
        stateName: arg.value,
      };
    }
  }
  return null;
}

export function hasGuardOption(
  optionsNode: TSESTree.Node | null | undefined,
): boolean {
  if (!optionsNode || optionsNode.type !== AST_NODE_TYPES.ObjectExpression) {
    return false;
  }
  for (const prop of optionsNode.properties) {
    if (prop.type === AST_NODE_TYPES.Property) {
      if (
        (prop.key.type === AST_NODE_TYPES.Identifier &&
          prop.key.name === 'guard') ||
        (prop.key.type === AST_NODE_TYPES.Literal && prop.key.value === 'guard')
      ) {
        if (
          prop.value.type === AST_NODE_TYPES.Identifier &&
          prop.value.name === 'undefined'
        ) {
          return false;
        }
        return true;
      }
    }
  }
  return false;
}

export function parseTransitionRow(
  element: TSESTree.Node | null,
): ParsedTransitionRow | null {
  if (!element || element.type !== AST_NODE_TYPES.ArrayExpression) {
    return null;
  }
  const [fromEl, viaEl, toEl, optionsEl] = element.elements;
  if (!fromEl || !viaEl || !toEl) {
    return null;
  }
  if (
    fromEl.type === AST_NODE_TYPES.SpreadElement ||
    viaEl.type === AST_NODE_TYPES.SpreadElement ||
    toEl.type === AST_NODE_TYPES.SpreadElement
  ) {
    return null;
  }

  const fromKey = extractNodeKey(fromEl);
  const viaKey = extractNodeKey(viaEl);
  const groupKey = fromKey && viaKey ? `${fromKey}::${viaKey}` : null;
  const optionsNode =
    optionsEl && optionsEl.type !== AST_NODE_TYPES.SpreadElement
      ? optionsEl
      : null;

  return {
    node: element,
    fromNode: fromEl,
    viaNode: viaEl,
    toNode: toEl,
    optionsNode,
    fromKey,
    viaKey,
    groupKey,
    hasGuard: hasGuardOption(optionsNode),
    awaitingCall: extractAwaitingCall(toEl),
  };
}

export function unwrapCallee(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.CallExpression ||
    current.type === AST_NODE_TYPES.TSInstantiationExpression
  ) {
    current =
      current.type === AST_NODE_TYPES.CallExpression
        ? current.callee
        : current.expression;
  }
  return current;
}

function isMachineCreatorCallee(node: TSESTree.CallExpression): boolean {
  const callee = unwrapCallee(node.callee);
  return (
    callee.type === AST_NODE_TYPES.Identifier &&
    (callee.name === 'createFSM' ||
      callee.name === 'createMachineFeature' ||
      callee.name === 'subMachine')
  );
}

/**
 * Checks if a CallExpression is `createFSM({ ... })`, `createFSM<...>()({ ... })`,
 * or `subMachine({ ... })` and returns its `transitions` ArrayExpression if present.
 */
export function getMachineTransitionsArray(
  node: TSESTree.CallExpression,
): TSESTree.ArrayExpression | null {
  if (!isMachineCreatorCallee(node)) {
    return null;
  }
  const configArg = node.arguments[0];
  if (!configArg || configArg.type !== AST_NODE_TYPES.ObjectExpression) {
    return null;
  }
  for (const prop of configArg.properties) {
    if (
      prop.type === AST_NODE_TYPES.Property &&
      ((prop.key.type === AST_NODE_TYPES.Identifier &&
        prop.key.name === 'transitions') ||
        (prop.key.type === AST_NODE_TYPES.Literal &&
          prop.key.value === 'transitions')) &&
      prop.value.type === AST_NODE_TYPES.ArrayExpression
    ) {
      return prop.value;
    }
  }
  return null;
}

/**
 * Checks if a CallExpression is `transitions([...])`, `transitions<T>([...])`,
 * or curried `transitions<T>()([...])` and returns its ArrayExpression argument.
 */
export function getExtractedTransitionsArray(
  node: TSESTree.CallExpression,
): TSESTree.ArrayExpression | null {
  const callee = unwrapCallee(node.callee);
  if (
    callee.type === AST_NODE_TYPES.Identifier &&
    callee.name === 'transitions' &&
    node.arguments[0]?.type === AST_NODE_TYPES.ArrayExpression
  ) {
    return node.arguments[0];
  }
  return null;
}

export function getAnyTransitionsArray(
  node: TSESTree.CallExpression,
): TSESTree.ArrayExpression | null {
  return getMachineTransitionsArray(node) ?? getExtractedTransitionsArray(node);
}
