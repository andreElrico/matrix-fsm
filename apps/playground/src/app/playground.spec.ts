import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injector, runInInjectionContext } from '@angular/core';
import { toMermaid } from '@matrix-fsm/core';
import { configs as matrixFsmConfigs } from '@matrix-fsm/eslint-plugin';
import { type ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { AuthApiService, GlobalAuthStore, UserRole } from './core';
import { calculateSubscriptionPrice } from './domain/pricing.domain';
import { authFSM } from './features/auth/auth.machine';
import { AuthFeatureStore } from './features/auth/auth.store';

function setupPlaygroundInjector() {
  const injector = Injector.create({
    providers: [
      { provide: GlobalAuthStore, useClass: GlobalAuthStore, deps: [] },
      { provide: AuthApiService, useClass: AuthApiService, deps: [] },
      { provide: AuthFeatureStore, useClass: AuthFeatureStore, deps: [] },
    ],
  });

  const globalAuth = injector.get(GlobalAuthStore);
  const authApi = injector.get(AuthApiService);
  const store = runInInjectionContext(injector, () => injector.get(AuthFeatureStore));

  return {
    injector,
    globalAuth,
    authApi,
    store,
    mermaidDiagram: toMermaid(authFSM),
  };
}

describe('@matrix-fsm/playground - Angular DI & Blueprint E2E Verification', () => {
  it('verifies auth.machine.ts passes all 7 AST rules of @matrix-fsm/eslint-plugin with zero errors', () => {
    const machinePath = path.resolve(
      import.meta.dirname,
      './features/auth/auth.machine.ts',
    );
    const machineSource = fs.readFileSync(machinePath, 'utf-8');

    const linter = new Linter({ configType: 'flat' });
    const messages = linter.verify(
      machineSource,
      [
        {
          files: ['**/*.ts'],
          languageOptions: {
            parser: tseslint.parser as Linter.Parser,
            ecmaVersion: 'latest',
            sourceType: 'module',
          },
          plugins: {
            '@matrix-fsm': matrixFsmConfigs.recommended.plugins['@matrix-fsm'] as unknown as ESLint.Plugin,
          },
          rules: matrixFsmConfigs.recommended.rules as Linter.RulesRecord,
        },
      ],
      { filename: 'auth.machine.ts' },
    );

    expect(messages).toEqual([]);
  });

  it('executes the complete 3-layer AuthFeatureStore flow via Angular DI', async () => {
    const { globalAuth, authApi, store, mermaidDiagram } =
      setupPlaygroundInjector();

    expect(store.fsmState()).toBe('loginView');
    expect(mermaidDiagram).toContain(
      'state "⚡ authenticating" as authenticating',
    );

    // 1. Invalid email triggers stay() and patches error in-place
    store.send('LOGIN');
    expect(store.fsmState()).toBe('loginView');
    expect(store.fsmContext().error).toBe('Invalid email');
    expect(authApi.callCount).toBe(0);

    // 2. Valid credentials with Free role -> authenticating -> proUpsellPromo -> loggedIn
    store.send('UPDATE_CREDENTIALS', {
      email: 'free@matrix-fsm.dev',
      password: 'password123',
    });
    expect(store.fsmContext().error).toBeNull();

    store.send('LOGIN');
    await new Promise((r) => setTimeout(r, 20));

    expect(store.fsmState()).toBe('proUpsellPromo');
    expect(store.fsmContext().user?.email).toBe('free@matrix-fsm.dev');
    expect(calculateSubscriptionPrice(100, store.fsmContext().policy)).toBe(
      100,
    );

    store.send('DISMISS_PROMO');
    expect(store.fsmState()).toBe('loggedIn');

    // 3. Logout and switch GlobalAuthStore role to Pro -> skips proUpsellPromo!
    store.send('LOGOUT');
    expect(store.fsmState()).toBe('loginView');

    globalAuth.setRole(UserRole.Pro);
    expect(store.fsmContext().policy.showUpsellAds).toBe(false);
    expect(calculateSubscriptionPrice(100, store.fsmContext().policy)).toBe(90);

    store.send('LOGIN');
    await new Promise((r) => setTimeout(r, 20));
    expect(store.fsmState()).toBe('loggedIn');
  });

  it('retries 2 times on NetworkTimeoutError and routes via _tag to offlineRetryView, then recovers on RETRY', async () => {
    const { globalAuth, authApi, store } = setupPlaygroundInjector();
    globalAuth.setRole(UserRole.Admin);
    authApi.setSimulationMode('timeout');

    store.send('UPDATE_CREDENTIALS', {
      email: 'admin@matrix-fsm.dev',
      password: 'admin',
    });
    store.send('LOGIN');

    await new Promise((r) => setTimeout(r, 80));

    expect(authApi.callCount).toBe(3);
    expect(store.fsmState()).toBe('offlineRetryView');

    authApi.setSimulationMode('success');
    store.send('RETRY');
    await new Promise((r) => setTimeout(r, 20));

    expect(store.fsmState()).toBe('loggedIn');
    expect(store.fsmContext().user?.email).toBe('admin@matrix-fsm.dev');
  });
});
