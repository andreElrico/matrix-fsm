import * as fs from 'node:fs';
import * as path from 'node:path';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { configs as matrixFsmConfigs } from '@matrix-fsm/eslint-plugin';
import { bootstrapPlayground } from './main.js';
import { UserRole } from './core/index.js';

describe('@matrix-fsm/playground - End-to-End Blueprint Verification', () => {
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
          ...(matrixFsmConfigs.recommended as unknown as Linter.Config),
        },
      ],
      { filename: 'auth.machine.ts' },
    );

    expect(messages).toEqual([]);
  });

  it('executes the complete 3-layer Auth flow with Policy-Driven Design and Effect-TS retry', async () => {
    const { globalAuth, authApi, store, mermaidDiagram, calculateSubscriptionPrice } =
      bootstrapPlayground();

    expect(store.fsmState()).toBe('loginView');
    expect(mermaidDiagram).toContain('state "⚡ authenticating" as authenticating');

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
    expect(calculateSubscriptionPrice(100, store.fsmContext().policy)).toBe(100);

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
    const { globalAuth, authApi, store } = bootstrapPlayground();
    globalAuth.setRole(UserRole.Admin);
    authApi.setSimulationMode('timeout');

    store.send('UPDATE_CREDENTIALS', {
      email: 'admin@matrix-fsm.dev',
      password: 'admin',
    });
    store.send('LOGIN');

    await new Promise((r) => setTimeout(r, 80));

    // 1 initial attempt + 2 retries = 3 calls
    expect(authApi.callCount).toBe(3);
    expect(store.fsmState()).toBe('offlineRetryView');

    // Network recovers -> RETRY transitions to authenticating -> loggedIn
    authApi.setSimulationMode('success');
    store.send('RETRY');
    await new Promise((r) => setTimeout(r, 20));

    expect(store.fsmState()).toBe('loggedIn');
    expect(store.fsmContext().user?.email).toBe('admin@matrix-fsm.dev');
  });

  it('aborts in-flight Effect task when CANCEL is dispatched', async () => {
    const { authApi, store } = bootstrapPlayground();
    authApi.setSimulationMode('slow_success');

    store.send('UPDATE_CREDENTIALS', {
      email: 'slow@matrix-fsm.dev',
      password: 'pass',
    });
    store.send('LOGIN');
    expect(store.fsmState()).toBe('authenticating');
    expect(store.isPending()).toBe(true);

    store.send('CANCEL');
    expect(store.fsmState()).toBe('loginView');
    expect(store.isPending()).toBe(false);

    await new Promise((r) => setTimeout(r, 250));
    expect(store.fsmState()).toBe('loginView');
    expect(store.fsmContext().user).toBeNull();
  });
});
