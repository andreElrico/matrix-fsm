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
import {
  COFFEE_MENU,
} from './features/coffee-shop/coffee-shop.domain';
import { coffeeShopFSM } from './features/coffee-shop/coffee-shop.machine';
import { CoffeeShopStore } from './features/coffee-shop/coffee-shop.store';
import { CoffeeShopApiService } from './features/coffee-shop/coffee-shop-api.service';

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

  it('verifies coffee-shop.machine.ts passes all 7 AST rules of @matrix-fsm/eslint-plugin with zero errors', () => {
    const machinePath = path.resolve(
      import.meta.dirname,
      './features/coffee-shop/coffee-shop.machine.ts',
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
      { filename: 'coffee-shop.machine.ts' },
    );

    expect(messages).toEqual([]);
  });

  it('executes regular Coffee Shop flow: order -> card check -> customer pays -> barista brews -> customer drinks', async () => {
    const injector = Injector.create({
      providers: [
        { provide: CoffeeShopApiService, useClass: CoffeeShopApiService, deps: [] },
        { provide: CoffeeShopStore, useClass: CoffeeShopStore, deps: [] },
      ],
    });
    const store = runInInjectionContext(injector, () => injector.get(CoffeeShopStore));
    const flatWhite = COFFEE_MENU[2]; // Velvet Flat White ($5.0)

    expect(store.fsmState()).toBe('customerBrowsing');

    // 1. Placing order without selecting a drink triggers stay() fallback
    store.send('PLACE_ORDER');
    expect(store.fsmState()).toBe('customerBrowsing');
    expect(store.fsmContext().error).toBe('Please select a coffee first!');

    // 2. Select a drink and place order -> checkingLoyalty (awaiting state)
    store.send('SELECT_DRINK', { drink: flatWhite });
    expect(store.fsmContext().selectedDrink?.name).toBe('Velvet Flat White');
    expect(store.fsmContext().error).toBeNull();

    store.send('PLACE_ORDER');
    // Task runs (small delay)
    await new Promise((r) => setTimeout(r, 200));

    // Stamps was 3 -> 4th drink, so not free. Moves to awaitingPayment
    expect(store.fsmState()).toBe('awaitingPayment');
    expect(store.fsmContext().isFreeDrink).toBe(false);
    expect(store.fsmContext().finalPrice).toBe(5.0);

    // 3. Customer pays cashier -> enters barista subMachine ('barista' / 'ticketQueued')
    store.send('PAY');
    expect(store.fsmState()).toBe('barista');
    expect(store.fsmSubState()).toBe('ticketQueued');
    expect(store.fsmContext().isPaid).toBe(true);

    // 4. Barista starts brewing -> subState becomes 'brewingCoffee' -> finalState('COFFEE_READY') -> 'coffeeReady'
    store.send('START_BREWING');
    expect(store.fsmSubState()).toBe('brewingCoffee');
    expect(store.isPending()).toBe(true);
    await new Promise((r) => setTimeout(r, 500));

    expect(store.fsmState()).toBe('coffeeReady');
    expect(store.fsmSubState()).toBeNull();
    expect(store.fsmContext().baristaResult?.temperatureCelsius).toBe(67);

    // 5. Customer takes coffee and drinks it
    store.send('TAKE_COFFEE');
    expect(store.fsmState()).toBe('drinkingCoffee');

    // 6. Finish coffee -> resets to customerBrowsing with stamps incremented (3 -> 4)
    store.send('FINISH_COFFEE');
    expect(store.fsmState()).toBe('customerBrowsing');
    expect(store.fsmContext().customerCard.currentStamps).toBe(4);
    expect(store.fsmContext().selectedDrink).toBeNull();

    const mermaid = toMermaid(coffeeShopFSM);
    expect(mermaid).toContain('state barista {');
    expect(mermaid).toContain('state "⚡ brewingCoffee" as brewingCoffee');
  });

  it('executes 10th drink FREE flow: customer with 9 stamps gets free coffee without paying', async () => {
    const injector = Injector.create({
      providers: [
        { provide: CoffeeShopApiService, useClass: CoffeeShopApiService, deps: [] },
        { provide: CoffeeShopStore, useClass: CoffeeShopStore, deps: [] },
      ],
    });
    const store = runInInjectionContext(injector, () => injector.get(CoffeeShopStore));
    const cappuccino = COFFEE_MENU[1]; // Oat Milk Cappuccino

    // Set customer stamps to 9
    store.send('SET_STAMPS', { stamps: 9 });
    expect(store.fsmContext().customerCard.currentStamps).toBe(9);

    store.send('SELECT_DRINK', { drink: cappuccino });
    store.send('PLACE_ORDER');

    await new Promise((r) => setTimeout(r, 200));

    // Guard isFreeDrink matched -> bypassed awaitingPayment directly into barista subMachine!
    expect(store.fsmState()).toBe('barista');
    expect(store.fsmSubState()).toBe('ticketQueued');
    expect(store.fsmContext().isFreeDrink).toBe(true);
    expect(store.fsmContext().finalPrice).toBe(0);

    // Barista brews
    store.send('START_BREWING');
    await new Promise((r) => setTimeout(r, 500));

    expect(store.fsmState()).toBe('coffeeReady');
    expect(store.fsmSubState()).toBeNull();

    store.send('TAKE_COFFEE');
    expect(store.fsmState()).toBe('drinkingCoffee');

    // 10th free drink completed -> stamp card resets to 0!
    store.send('FINISH_COFFEE');
    expect(store.fsmState()).toBe('customerBrowsing');
    expect(store.fsmContext().customerCard.currentStamps).toBe(0);
  });

  it('handles Loyalty API timeout via TaggedError and allows cashier to bypass or retry', async () => {
    const injector = Injector.create({
      providers: [
        { provide: CoffeeShopApiService, useClass: CoffeeShopApiService, deps: [] },
        { provide: CoffeeShopStore, useClass: CoffeeShopStore, deps: [] },
      ],
    });
    const api = injector.get(CoffeeShopApiService);
    const store = runInInjectionContext(injector, () => injector.get(CoffeeShopStore));
    const espresso = COFFEE_MENU[0];

    api.setSimulationMode('timeout');
    store.send('SELECT_DRINK', { drink: espresso });
    store.send('PLACE_ORDER');

    await new Promise((r) => setTimeout(r, 200));

    // TaggedError routed directly to loyaltyErrorView
    expect(store.fsmState()).toBe('loyaltyErrorView');

    // Cashier can bypass card manually
    store.send('BYPASS_CARD');
    expect(store.fsmState()).toBe('awaitingPayment');
  });
});
