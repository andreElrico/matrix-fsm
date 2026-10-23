/**
 * Rule: pure-machine-definition
 * 1. Forbids importing `@angular/core` (`inject`), services, or stores inside pure `*.machine.ts` files
 *    (unless the file uses the Sandwich-Pattern `createMachineFeature`).
 * 2. Always forbids calling `inject()` inside `transitions: [...]` arrays (even inside `createMachineFeature` or `*.feature.ts`).
 * 3. Enforces that `call` in transition options is a single pure method reference `(m) => m.methodName`
 *    (never invoking `m.method()` directly or calling multiple methods in a block).
 */

import {
  AST_NODE_TYPES,
  ESLintUtils,
  type TSESTree,
} from '@typescript-eslint/utils';
import {
  getAnyTransitionsArray,
  parseTransitionRow,
  unwrapCallee,
} from '../ast-utils.js';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export type MessageIds =
  | 'forbiddenAngularImport'
  | 'forbiddenServiceOrStoreImport'
  | 'forbiddenInjectCall'
  | 'invalidTransitionCallSelector';

const IMPURE_IMPORT_PATTERN = /\.(service|store)(\.[cm]?[jt]s)?$/i;
const EXEMPT_FILE_PATTERN =
  /\.(feature|store|component|service|directive|pipe|module|spec|test)\.[cm]?[jt]sx?$/i;

function isValidCallSelectorProperty(valueNode: TSESTree.Node): boolean {
  if (
    valueNode.type === AST_NODE_TYPES.Literal &&
    typeof valueNode.value === 'string'
  ) {
    return true;
  }
  if (valueNode.type === AST_NODE_TYPES.Identifier) {
    return true;
  }
  if (
    valueNode.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    valueNode.type === AST_NODE_TYPES.FunctionExpression
  ) {
    if (valueNode.body.type === AST_NODE_TYPES.MemberExpression) {
      return true;
    }
    return false;
  }
  return false;
}

function isNodeInsideRange(
  inner: TSESTree.Node,
  outer: TSESTree.Node,
): boolean {
  return inner.range[0] >= outer.range[0] && inner.range[1] <= outer.range[1];
}

export const pureMachineDefinition = createRule<[], MessageIds>({
  name: 'pure-machine-definition',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid importing @angular/core (inject), services, or stores inside pure *.machine.ts files, forbid inject() inside transitions arrays, and enforce single method reference in transition `call` selectors.',
    },
    schema: [],
    messages: {
      forbiddenAngularImport:
        "Importing '{{source}}' is forbidden in pure machine definitions (*.machine.ts). Keep topology 100% pure and move DI into *.store.ts or createMachineFeature.",
      forbiddenServiceOrStoreImport:
        "Importing service or store '{{source}}' is forbidden in pure machine definitions (*.machine.ts). Move IO/store access into *.store.ts or createMachineFeature.",
      forbiddenInjectCall:
        'Calling inject() is forbidden in pure machine definitions and inside transitions: [...] arrays. Use tasks or methods in createMachineFeature / *.store.ts instead.',
      invalidTransitionCallSelector:
        "Transition option 'call' must reference a single store method (e.g. `{ call: (m) => m._selectDrink }`), never invoke methods directly or execute multiple methods.",
    },
  },
  defaultOptions: [],
  create(context) {
    const filename = context.filename ?? '';
    const isExemptFile = EXEMPT_FILE_PATTERN.test(filename);
    let hasCreateMachineFeature = false;

    const pendingAngularImports: Array<{
      node: TSESTree.ImportDeclaration;
      source: string;
    }> = [];
    const pendingImpureImports: Array<{
      node: TSESTree.ImportDeclaration;
      source: string;
    }> = [];
    const injectCalls: TSESTree.CallExpression[] = [];
    const transitionArrays: TSESTree.ArrayExpression[] = [];

    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration) {
        if (node.importKind === 'type') {
          return;
        }
        for (const spec of node.specifiers) {
          if (
            spec.type === AST_NODE_TYPES.ImportSpecifier &&
            spec.imported.type === AST_NODE_TYPES.Identifier &&
            spec.imported.name === 'createMachineFeature'
          ) {
            hasCreateMachineFeature = true;
          }
        }

        const source = node.source.value;
        if (typeof source !== 'string') {
          return;
        }

        if (source === '@angular/core' || source.startsWith('@angular/')) {
          pendingAngularImports.push({ node, source });
          return;
        }

        const hasValueStoreOrServiceSpecifier = node.specifiers.some((spec) => {
          if (
            spec.type === AST_NODE_TYPES.ImportSpecifier &&
            spec.importKind === 'type'
          ) {
            return false;
          }
          const localName = spec.local.name;
          return localName.endsWith('Service') || localName.endsWith('Store');
        });

        if (
          IMPURE_IMPORT_PATTERN.test(source) ||
          hasValueStoreOrServiceSpecifier
        ) {
          pendingImpureImports.push({ node, source });
        }
      },
      CallExpression(node: TSESTree.CallExpression) {
        const unwrapped = unwrapCallee(node.callee);
        if (
          unwrapped.type === AST_NODE_TYPES.Identifier &&
          unwrapped.name === 'createMachineFeature'
        ) {
          hasCreateMachineFeature = true;
        }

        if (
          node.callee.type === AST_NODE_TYPES.Identifier &&
          node.callee.name === 'inject'
        ) {
          injectCalls.push(node);
        }

        const arrayNode = getAnyTransitionsArray(node);
        if (!arrayNode) {
          return;
        }
        transitionArrays.push(arrayNode);

        for (const el of arrayNode.elements) {
          const parsed = parseTransitionRow(el);
          if (
            !parsed?.optionsNode ||
            parsed.optionsNode.type !== AST_NODE_TYPES.ObjectExpression
          ) {
            continue;
          }
          for (const prop of parsed.optionsNode.properties) {
            if (
              prop.type === AST_NODE_TYPES.Property &&
              ((prop.key.type === AST_NODE_TYPES.Identifier &&
                prop.key.name === 'call') ||
                (prop.key.type === AST_NODE_TYPES.Literal &&
                  prop.key.value === 'call'))
            ) {
              if (!isValidCallSelectorProperty(prop.value)) {
                context.report({
                  node: prop.value,
                  messageId: 'invalidTransitionCallSelector',
                });
              }
            }
          }
        }
      },
      'Program:exit'() {
        const allowFileLevelDI = isExemptFile || hasCreateMachineFeature;

        if (!allowFileLevelDI) {
          for (const item of pendingAngularImports) {
            context.report({
              node: item.node,
              messageId: 'forbiddenAngularImport',
              data: { source: item.source },
            });
          }
          for (const item of pendingImpureImports) {
            context.report({
              node: item.node,
              messageId: 'forbiddenServiceOrStoreImport',
              data: { source: item.source },
            });
          }
        }

        for (const injectNode of injectCalls) {
          const isInsideTransitions = transitionArrays.some((arr) =>
            isNodeInsideRange(injectNode, arr),
          );
          if (isInsideTransitions || !allowFileLevelDI) {
            context.report({
              node: injectNode,
              messageId: 'forbiddenInjectCall',
            });
          }
        }
      },
    };
  },
});
