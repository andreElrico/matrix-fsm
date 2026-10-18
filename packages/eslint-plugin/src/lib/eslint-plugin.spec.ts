import tseslint from 'typescript-eslint';
import { type ESLint, Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { plugin } from '../index.js';

function verifyRule(
  ruleId: keyof typeof plugin.rules,
  code: string,
  filename = 'auth.machine.ts',
) {
  const linter = new Linter({ configType: 'flat' });
  const config: Linter.Config[] = [
    {
      files: ['**/*.ts'],
      languageOptions: {
        parser: tseslint.parser as Linter.Parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      plugins: {
        '@matrix-fsm': plugin as unknown as ESLint.Plugin,
      },
      rules: {
        [`@matrix-fsm/${ruleId}`]: 'error',
      },
    },
  ];
  return {
    messages: linter.verify(code, config, { filename }),
    fixed: linter.verifyAndFix(code, config, { filename }),
  };
}

describe('@matrix-fsm/eslint-plugin (7 AST Rules)', () => {
  describe('1. group-contiguous-transitions', () => {
    it('allows contiguous [FROM, VIA] transition groups', () => {
      const { messages } = verifyRule(
        'group-contiguous-transitions',
        `
        createFSM({
          id: 'auth',
          initial: 'loginView',
          context: {},
          transitions: [
            ['loginView', 'LOGIN', 'authenticating', { guard: isValid }],
            ['loginView', 'LOGIN', stay()],
            ['authenticating', 'CANCEL', 'loginView'],
          ],
        });
        `,
      );
      expect(messages).toHaveLength(0);
    });

    it('reports and auto-fixes non-contiguous [FROM, VIA] transition rows', () => {
      const { messages, fixed } = verifyRule(
        'group-contiguous-transitions',
        `createFSM({
  id: 'auth',
  initial: 'loginView',
  context: {},
  transitions: [
    ['loginView', 'LOGIN', 'authenticating', { guard: isValid }],
    ['authenticating', 'CANCEL', 'loginView'],
    ['loginView', 'LOGIN', stay()],
  ],
});`,
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('nonContiguousGroup');
      expect(fixed.fixed).toBe(true);
      expect(fixed.output).toContain(
        `  ['loginView', 'LOGIN', 'authenticating', { guard: isValid }],\n  ['loginView', 'LOGIN', stay()],\n  ['authenticating', 'CANCEL', 'loginView'],`,
      );
    });

    it('forbids state arrays in Column 1', () => {
      const { messages } = verifyRule(
        'group-contiguous-transitions',
        `
        createFSM({
          id: 'auth',
          initial: 'a',
          context: {},
          transitions: [
            [['a', 'b'], 'CANCEL', 'idle'],
          ],
        });
        `,
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('noStateArrayInColumn1');
    });
  });

  describe('2. require-fallback-transition', () => {
    it('passes when guarded group ends with an unguarded fallback row', () => {
      const { messages } = verifyRule(
        'require-fallback-transition',
        `
        createFSM({
          id: 'auth',
          initial: 'loginView',
          context: {},
          transitions: [
            ['loginView', 'LOGIN', awaiting('authenticating'), { guard: hasValidInput }],
            ['loginView', 'LOGIN', stay(), { patch: setError }],
          ],
        });
        `,
      );
      expect(messages).toHaveLength(0);
    });

    it('reports error when guarded group lacks an unguarded fallback row', () => {
      const { messages } = verifyRule(
        'require-fallback-transition',
        `
        createFSM({
          id: 'auth',
          initial: 'loginView',
          context: {},
          transitions: [
            ['loginView', 'LOGIN', awaiting('authenticating'), { guard: hasValidInput }],
          ],
        });
        `,
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('missingFallback');
    });
  });

  describe('3. no-unreachable-transitions', () => {
    it('passes when guarded rows precede the unguarded fallback row', () => {
      const { messages } = verifyRule(
        'no-unreachable-transitions',
        `
        transitions([
          ['authenticating', 'DONE', 'proUpsellPromo', { guard: shouldShowPromo }],
          ['authenticating', 'DONE', 'loggedIn'],
        ]);
        `,
      );
      expect(messages).toHaveLength(0);
    });

    it('reports error when an unguarded row appears above another row with the same [FROM, VIA]', () => {
      const { messages } = verifyRule(
        'no-unreachable-transitions',
        `
        transitions([
          ['authenticating', 'DONE', 'loggedIn'],
          ['authenticating', 'DONE', 'proUpsellPromo', { guard: shouldShowPromo }],
        ]);
        `,
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('unreachableTransition');
    });
  });

  describe('4. require-awaiting-handlers', () => {
    it('passes when awaiting("authenticating") has both DONE and ERROR handlers', () => {
      const { messages } = verifyRule(
        'require-awaiting-handlers',
        `
        const handleLoginSubmit = transitions([
          ['loginView', 'LOGIN', awaiting('authenticating')],
        ]);
        createFSM({
          id: 'auth',
          initial: 'loginView',
          context: {},
          transitions: [
            ...handleLoginSubmit,
            ['authenticating', 'DONE', 'loggedIn'],
            ['authenticating', 'ERROR', 'loginView'],
          ],
        });
        `,
      );
      expect(messages).toHaveLength(0);
    });

    it('reports error when awaiting("authenticating") is missing ERROR or DONE', () => {
      const { messages } = verifyRule(
        'require-awaiting-handlers',
        `
        createFSM({
          id: 'auth',
          initial: 'loginView',
          context: {},
          transitions: [
            ['loginView', 'LOGIN', awaiting('authenticating')],
            ['authenticating', 'DONE', 'loggedIn'],
          ],
        });
        `,
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('missingAwaitingHandlers');
      expect(messages[0].message).toContain("['authenticating', 'ERROR', ...]");
    });
  });

  describe('5. awaiting-naming-convention', () => {
    it('passes for state names ending with -ing', () => {
      const { messages } = verifyRule(
        'awaiting-naming-convention',
        `const row = ['idle', 'LOAD', awaiting('loadingData')];`,
      );
      expect(messages).toHaveLength(0);
    });

    it('reports error for awaiting state names not ending with -ing', () => {
      const { messages } = verifyRule(
        'awaiting-naming-convention',
        `const row = ['idle', 'LOAD', awaiting('fetchData')];`,
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('invalidAwaitingName');
    });
  });

  describe('6. complete-extracted-groups', () => {
    it('passes when extracted transitions([...]) group has > 3 rows and is not split across parent createFSM', () => {
      const { messages } = verifyRule(
        'complete-extracted-groups',
        `
        const handleLogin = transitions([
          ['loginView', 'LOGIN', 'ssoRedirect',             { guard: isSsoDomain }],
          ['loginView', 'LOGIN', 'mfaChallenge',            { guard: requiresMfa }],
          ['loginView', 'LOGIN', awaiting('authenticating'), { guard: isValid }],
          ['loginView', 'LOGIN', stay()],
        ]);
        createFSM({
          id: 'auth',
          initial: 'loginView',
          context: {},
          transitions: [
            ...handleLogin,
            ['authenticating', 'DONE', 'loggedIn'],
            ['authenticating', 'ERROR', 'loginView'],
          ],
        });
        `,
      );
      expect(messages).toHaveLength(0);
    });

    it('reports error when extracted transitions([...]) variable has 3 or fewer rows', () => {
      const { messages } = verifyRule(
        'complete-extracted-groups',
        `
        const handleLogin = transitions([
          ['loginView', 'LOGIN', awaiting('authenticating'), { guard: isValid }],
          ['loginView', 'LOGIN', stay()],
        ]);
        `,
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('tooFewRowsToExtract');
    });

    it('reports error when [FROM, VIA] is split between transitions([...]) variable and parent createFSM', () => {
      const { messages } = verifyRule(
        'complete-extracted-groups',
        `
        const handleLogin = transitions([
          ['loginView', 'LOGIN', 'ssoRedirect',             { guard: isSsoDomain }],
          ['loginView', 'LOGIN', 'mfaChallenge',            { guard: requiresMfa }],
          ['loginView', 'LOGIN', awaiting('authenticating'), { guard: isValid }],
          ['loginView', 'LOGIN', 'rateLimited',             { guard: isRateLimited }],
        ]);
        createFSM({
          id: 'auth',
          initial: 'loginView',
          context: {},
          transitions: [
            ...handleLogin,
            ['loginView', 'LOGIN', stay()],
          ],
        });
        `,
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('splitExtractedGroup');
    });
  });

  describe('7. pure-machine-definition', () => {
    it('passes for pure *.machine.ts files without Angular DI or service/store imports', () => {
      const { messages } = verifyRule(
        'pure-machine-definition',
        `
        import { createFSM, awaiting, stay } from '@matrix-fsm/core';
        import type { AuthStore } from './auth.store';
        export const authFSM = createFSM({ id: 'auth', initial: 'idle', context: {}, transitions: [] });
        `,
        'auth.machine.ts',
      );
      expect(messages).toHaveLength(0);
    });

    it('forbids importing @angular/core, services, stores, or calling inject() in *.machine.ts', () => {
      const { messages } = verifyRule(
        'pure-machine-definition',
        `
        import { inject } from '@angular/core';
        import { AuthApiService } from './auth-api.service';
        const api = inject(AuthApiService);
        `,
        'auth.machine.ts',
      );
      expect(messages.length).toBeGreaterThanOrEqual(3);
      expect(messages.map((m) => m.messageId)).toContain(
        'forbiddenAngularImport',
      );
      expect(messages.map((m) => m.messageId)).toContain(
        'forbiddenServiceOrStoreImport',
      );
      expect(messages.map((m) => m.messageId)).toContain('forbiddenInjectCall');
    });
  });

  describe('8. align-matrix-columns', () => {
    it('passes when [FROM, VIA, TO] columns are vertically aligned (with OPTIONS on same line or next line)', () => {
      const { messages } = verifyRule(
        'align-matrix-columns',
        `
        createFSM({
          id: 'auth',
          initial: 'loginView',
          context: {},
          transitions: [
            ['loginView',       'LOGIN',   awaiting('authenticating'), { guard: hasValidInput }],
            ['loginView',       'LOGIN',   stay(),
              { patch: () => ({ error: 'Invalid email' }) }],
            ['authenticating',  'CANCEL',  'loginView'],
          ],
        });
        `,
      );
      expect(messages).toHaveLength(0);
    });

    it('reports and auto-fixes unaligned or broken [FROM, VIA, TO] triplets into aligned columns', () => {
      const { messages, fixed } = verifyRule(
        'align-matrix-columns',
        `createFSM({
  id: 'auth',
  initial: 'loginView',
  context: {},
  transitions: [
    ['loginView', 'LOGIN', awaiting('authenticating'), { guard: hasValidInput }],
    [
      'authenticating',
      'CANCEL',
      'loginView',
    ],
  ],
});`,
      );
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(fixed.fixed).toBe(true);
      expect(fixed.output).toContain(
        `    ['loginView',       'LOGIN',   awaiting('authenticating'), { guard: hasValidInput }],\n    ['authenticating',  'CANCEL',  'loginView'],`,
      );
    });
  });
});
