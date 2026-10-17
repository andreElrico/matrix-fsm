/**
 * Rule: pure-machine-definition
 * Forbids importing `@angular/core` (`inject`), services, or stores inside `*.machine.ts` files.
 */

import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://matrix-fsm.dev/rules/${name}`,
);

export type MessageIds =
  | 'forbiddenAngularImport'
  | 'forbiddenServiceOrStoreImport'
  | 'forbiddenInjectCall';

const IMPURE_IMPORT_PATTERN = /\.(service|store)(\.[cm]?[jt]s)?$/i;
const EXEMPT_FILE_PATTERN = /\.(store|component|service|directive|pipe|module|spec|test)\.[cm]?[jt]sx?$/i;

export const pureMachineDefinition = createRule<[], MessageIds>({
  name: 'pure-machine-definition',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid importing @angular/core (inject), services, or stores inside pure *.machine.ts files.',
    },
    schema: [],
    messages: {
      forbiddenAngularImport:
        "Importing '{{source}}' is forbidden in pure machine definitions (*.machine.ts). Keep topology 100% pure and move DI into *.store.ts.",
      forbiddenServiceOrStoreImport:
        "Importing service or store '{{source}}' is forbidden in pure machine definitions (*.machine.ts). Move IO/store access into *.store.ts.",
      forbiddenInjectCall:
        'Calling inject() is forbidden in pure machine or domain files. Use syncContext or tasks in *.store.ts instead.',
    },
  },
  defaultOptions: [],
  create(context) {
    const filename = context.filename ?? '';
    if (EXEMPT_FILE_PATTERN.test(filename)) {
      return {};
    }

    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration) {
        if (node.importKind === 'type') {
          return;
        }
        const source = node.source.value;
        if (typeof source !== 'string') {
          return;
        }

        if (source === '@angular/core' || source.startsWith('@angular/')) {
          context.report({
            node,
            messageId: 'forbiddenAngularImport',
            data: { source },
          });
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
          return (
            localName.endsWith('Service') ||
            localName.endsWith('Store')
          );
        });

        if (
          IMPURE_IMPORT_PATTERN.test(source) ||
          hasValueStoreOrServiceSpecifier
        ) {
          context.report({
            node,
            messageId: 'forbiddenServiceOrStoreImport',
            data: { source },
          });
        }
      },
      CallExpression(node: TSESTree.CallExpression) {
        if (
          node.callee.type === AST_NODE_TYPES.Identifier &&
          node.callee.name === 'inject'
        ) {
          context.report({
            node,
            messageId: 'forbiddenInjectCall',
          });
        }
      },
    };
  },
});
