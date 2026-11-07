import { computed, inject, InjectionToken, signal } from '@angular/core';
import {
  patchState,
  signalStore,
  withMethods,
  withState,
} from '@ngrx/signals';
import { Data, Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  after,
  all,
  always,
  any,
  anyState,
  awaiting,
  createFeatureTester,
  createFSM,
  createMachineFeature,
  each,
  every,
  finalState,
  getShortestPaths,
  MatrixFsmInfiniteLoopError,
  provideStateMachine,
  race,
  stay,
  withStateMachine,
  type Subscribable,
} from '../index.js';
import * as AngularPkg from '../index.js';
import * as EffectPkg from '../effect/index.js';

class NetworkTimeoutError extends Data.TaggedError('NetworkTimeoutError')<{
  readonly message: string;
}> {}

interface User {
  id: string;
  email: string;
}

interface UserEntitlements {
  showUpsellAds: boolean;
  canBypassApproval: boolean;
  discountPercent: number;
  maxProjects: number;
}

interface AuthContext {
  credentials: { email: string; password: string };
  user: User | null;
  policy: UserEntitlements;
  error: string | null;
}

type AuthStates =
  | 'loginView'
  | 'authenticating'
  | 'proUpsellPromo'
  | 'offlineRetryView'
  | 'loggedIn';

type AuthEvents = {
  SET_EMAIL: { email: string };
  LOGIN: void;
  DISMISS_PROMO: void;
  CANCEL: void;
  NetworkTimeoutError: { message: string };
};

type AuthMethods = {
  _setEmail(payload: { email: string }): void;
  _setInvalidEmail(): void;
  _authenticate(
    payload: void,
    signal: AbortSignal,
    ctx: Readonly<AuthContext>,
  ): unknown;
  _saveUser(res: { user: User }): void;
  _setError(err: Error): void;
};

const initialAuthState: AuthContext = {
  credentials: { email: '', password: '' },
  user: null,
  policy: {
    showUpsellAds: true,
    canBypassApproval: false,
    discountPercent: 0,
    maxProjects: 3,
  },
  error: null,
};

const hasValidInput = (ctx: AuthContext) => ctx.credentials.email.includes('@');
const shouldShowPromo = (ctx: AuthContext, res?: { user: User }) =>
  (res?.user ?? ctx.user) !== null && ctx.policy.showUpsellAds;

const authFSM = createFSM<{
  events: AuthEvents;
  context: AuthContext;
  states: AuthStates;
  methods: AuthMethods;
}>()({
  id: 'auth',
  initial: 'loginView',
  transitions: [
    ['loginView',         'SET_EMAIL',            stay(),                      { call: (m) => m._setEmail }],
    ['loginView',         'LOGIN',                awaiting('authenticating'),  { guard: hasValidInput, call: (m) => m._authenticate }],
    ['loginView',         'LOGIN',                stay(),                      { call: (m) => m._setInvalidEmail }],
    ['authenticating',    'CANCEL',               'loginView'],
    ['authenticating',    'DONE',                 'proUpsellPromo',            { guard: shouldShowPromo, call: (m) => m._saveUser }],
    ['authenticating',    'DONE',                 'loggedIn',                  { call: (m) => m._saveUser }],
    ['authenticating',    'NetworkTimeoutError',  'offlineRetryView'],
    ['authenticating',    'ERROR',                'loginView',                 { call: (m) => m._setError }],
    ['proUpsellPromo',    'DISMISS_PROMO',        'loggedIn'],
  ],
});

describe('@matrix-fsm/angular - withStateMachine', () => {
  it('aligns with SignalStore withState & withMethods (call), syncContext, and passes DONE payload to guards and methods', async () => {
    const policySignal = signal<UserEntitlements>({
      showUpsellAds: true,
      canBypassApproval: false,
      discountPercent: 0,
      maxProjects: 3,
    });

    const AuthStore = signalStore(
      withState<AuthContext>(initialAuthState),
      withMethods(
        (store): AuthMethods => ({
          _setEmail: ({ email }) =>
            patchState(store, {
              credentials: { ...store.credentials(), email },
              error: null,
            }),
          _setInvalidEmail: () =>
            patchState(store, {
              error: 'Invalid email',
            }),
          _authenticate: async (_payload, _signal, ctx) => ({
            user: {
              id: 'u1',
              email: ctx.credentials.email,
            },
          }),
          _saveUser: ({ user }) =>
            patchState(store, {
              user,
              error: null,
            }),
          _setError: (err) =>
            patchState(store, {
              error: err.message,
            }),
        }),
      ),
      withStateMachine(authFSM, {
        syncContext: () => ({
          policy: policySignal,
        }),
      }),
    );

    const store = new AuthStore();
    expect(store.fsmState()).toBe('loginView');
    expect(store.isPending()).toBe(false);

    // 1. Invalid email -> stay() and call _setInvalidEmail on store
    store.send('LOGIN');
    expect(store.fsmState()).toBe('loginView');
    // Both native SignalStore withState signal (`store.error()`) and `store.fsmContext().error` update!
    expect(store.error()).toBe('Invalid email');
    expect(store.fsmContext().error).toBe('Invalid email');

    // 2. Set valid email via call: (m) => m._setEmail and login with showUpsellAds: true
    store.send('SET_EMAIL', { email: 'alice@matrix.dev' });
    expect(store.credentials().email).toBe('alice@matrix.dev');
    store.send('LOGIN');

    await new Promise((r) => setTimeout(r, 15));

    expect(store.fsmState()).toBe('proUpsellPromo');
    expect(store.user()).toEqual({
      id: 'u1',
      email: 'alice@matrix.dev',
    });

    store.send('DISMISS_PROMO');
    expect(store.fsmState()).toBe('loggedIn');

    // 3. Reactive syncContext: switch user role policy to Pro (showUpsellAds: false)
    store.reset();
    expect(store.user()).toBeNull();
    policySignal.set({
      showUpsellAds: false,
      canBypassApproval: false,
      discountPercent: 10,
      maxProjects: 100,
    });
    expect(store.fsmContext().policy.showUpsellAds).toBe(false);

    store.send('SET_EMAIL', { email: 'pro@matrix.dev' });
    store.send('LOGIN');
    await new Promise((r) => setTimeout(r, 15));

    // Skips proUpsellPromo and goes straight to loggedIn!
    expect(store.fsmState()).toBe('loggedIn');
  });

  it('supports RxJS Observable / Subscribable methods natively on awaiting() and unsubscribes on state exit', async () => {
    let unsubscribed = false;

    const createSlowObservable = (): Subscribable<{ user: User }> => ({
      subscribe(observer) {
        const timer = setTimeout(() => {
          observer?.next?.({
            user: { id: 'rx-1', email: 'rxjs@matrix.dev' },
          });
          observer?.complete?.();
        }, 40);
        return {
          unsubscribe() {
            clearTimeout(timer);
            unsubscribed = true;
          },
        };
      },
    });

    const RxStore = signalStore(
      withState<AuthContext>({
        ...initialAuthState,
        credentials: { email: 'rxjs@matrix.dev', password: 'pw' },
      }),
      withMethods(
        (store): AuthMethods => ({
          _setEmail: ({ email }) =>
            patchState(store, { credentials: { ...store.credentials(), email } }),
          _setInvalidEmail: () => patchState(store, { error: 'Invalid email' }),
          _authenticate: () => createSlowObservable(),
          _saveUser: ({ user }) => patchState(store, { user, error: null }),
          _setError: (err) => patchState(store, { error: err.message }),
        }),
      ),
      withStateMachine(authFSM),
    );

    const store = new RxStore();
    store.send('LOGIN');
    expect(store.fsmState()).toBe('authenticating');

    // Cancel before observable completes -> triggers unsubscribe()!
    store.send('CANCEL');
    expect(store.fsmState()).toBe('loginView');
    expect(unsubscribed).toBe(true);
  });

  it('routes Effect TaggedError via _tag to matching matrix row or falls back to ERROR via @matrix-fsm/angular/effect', async () => {
    let failMode: 'tagged' | 'generic' = 'tagged';

    const authEffectFeature = EffectPkg.createEffectMachineFeature<{
      events: AuthEvents;
      states: AuthStates;
    }>()({
      id: 'auth',
      initial: 'loginView',
      transitions: [
        ['loginView',         'SET_EMAIL',            stay(),                      { call: (m) => m._setEmail }],
        ['loginView',         'LOGIN',                awaiting('authenticating'),  { guard: hasValidInput, call: (m) => m._authenticate }],
        ['loginView',         'LOGIN',                stay(),                      { call: (m) => m._setInvalidEmail }],
        ['authenticating',    'CANCEL',               'loginView'],
        ['authenticating',    'DONE',                 'proUpsellPromo',            { guard: shouldShowPromo, call: (m) => m._saveUser }],
        ['authenticating',    'DONE',                 'loggedIn',                  { call: (m) => m._saveUser }],
        ['authenticating',    'NetworkTimeoutError',  'offlineRetryView'],
        ['authenticating',    'ERROR',                'loginView',                 { call: (m) => m._setError }],
        ['proUpsellPromo',    'DISMISS_PROMO',        'loggedIn'],
      ],
      state: initialAuthState,
      methods: (store) => ({
        _setEmail: ({ email }: { email: string }) =>
          patchState(store, {
            credentials: { ...store.credentials(), email },
            error: null,
          }),
        _setInvalidEmail: () => patchState(store, { error: 'Invalid email' }),
        _authenticate: () =>
          failMode === 'tagged'
            ? Effect.fail(
                new NetworkTimeoutError({ message: 'Gateway timeout' }),
              )
            : Effect.fail(new Error('Invalid credentials')),
        _saveUser: ({ user }: { user: User }) =>
          patchState(store, { user, error: null }),
        _setError: (err: Error) => patchState(store, { error: err.message }),
      }),
    });

    const AuthStore = signalStore(withStateMachine(authEffectFeature));

    const store = new AuthStore();
    store.send('SET_EMAIL', { email: 'bob@matrix.dev' });
    store.send('LOGIN');

    await new Promise((r) => setTimeout(r, 15));
    expect(store.fsmState()).toBe('offlineRetryView');

    // Reset and test generic error fallback to 'ERROR'
    store.reset();
    failMode = 'generic';
    store.send('SET_EMAIL', { email: 'bob@matrix.dev' });
    store.send('LOGIN');

    await new Promise((r) => setTimeout(r, 15));
    expect(store.fsmState()).toBe('loginView');
    expect(store.error()).toBe('Invalid credentials');
  });

  it('aborts AbortSignal and interrupts Effect Fiber when leaving awaiting state on CANCEL', async () => {
    let wasInterrupted = false;
    let abortSignalTriggered = false;

    const authCancelEffectFeature = EffectPkg.createEffectMachineFeature<{
      events: AuthEvents;
      states: AuthStates;
    }>()({
      id: 'auth',
      initial: 'loginView',
      transitions: [
        ['loginView',         'SET_EMAIL',            stay(),                      { call: (m) => m._setEmail }],
        ['loginView',         'LOGIN',                awaiting('authenticating'),  { guard: hasValidInput, call: (m) => m._authenticate }],
        ['loginView',         'LOGIN',                stay(),                      { call: (m) => m._setInvalidEmail }],
        ['authenticating',    'CANCEL',               'loginView'],
        ['authenticating',    'DONE',                 'loggedIn',                  { call: (m) => m._saveUser }],
        ['authenticating',    'ERROR',                'loginView',                 { call: (m) => m._setError }],
      ],
      state: initialAuthState,
      methods: (store) => ({
        _setEmail: ({ email }: { email: string }) =>
          patchState(store, {
            credentials: { ...store.credentials(), email },
            error: null,
          }),
        _setInvalidEmail: () => patchState(store, { error: 'Invalid email' }),
        _authenticate: (_payload: void, abortSignal: AbortSignal) => {
          abortSignal.addEventListener('abort', () => {
            abortSignalTriggered = true;
          });
          return Effect.sleep('500 millis').pipe(
            Effect.map(() => ({
              user: { id: 'late', email: 'late@matrix.dev' },
            })),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                wasInterrupted = true;
              }),
            ),
          );
        },
        _saveUser: ({ user }: { user: User }) =>
          patchState(store, { user, error: null }),
        _setError: (err: Error) => patchState(store, { error: err.message }),
      }),
    });

    const AuthStore = signalStore(withStateMachine(authCancelEffectFeature));

    const store = new AuthStore();
    store.send('SET_EMAIL', { email: 'cancel@matrix.dev' });
    store.send('LOGIN');

    expect(store.fsmState()).toBe('authenticating');
    expect(store.isPending()).toBe(true);

    // User cancels in-flight request
    store.send('CANCEL');
    expect(store.fsmState()).toBe('loginView');
    expect(store.isPending()).toBe(false);
    expect(abortSignalTriggered).toBe(true);

    await new Promise((r) => setTimeout(r, 25));
    expect(wasInterrupted).toBe(true);
    expect(store.user()).toBeNull();
  });

  it('orchestrates parallel child machines via each() and dispatches ALL_DONE when all finish', () => {
    const itemFSM = createFSM<{
      events: { COMPLETE: void };
      context: { done: boolean };
    }>()({
      id: 'uploadItem',
      initial: 'uploading',
      transitions: [
        [
          'uploading',
          'COMPLETE',
          finalState('DONE'),
        ],
      ],
    });

    const batchFSM = createFSM<{
      events: { START_BATCH: void };
      context: { fileIds: string[] };
    }>()({
      id: 'batchUpload',
      initial: 'idle',
      transitions: [
        ['idle',                   'START_BATCH',  each('fileIds', itemFSM)],
        [each('fileIds', itemFSM), 'ALL_DONE',     'completed'],
      ],
    });

    const BatchStore = signalStore(
      withState({ fileIds: ['file-1', 'file-2'] }),
      withStateMachine(batchFSM),
    );
    const store = new BatchStore();

    expect(store.fsmState()).toBe('idle');
    store.send('START_BATCH');
    expect(store.fsmState()).toBe('each:fileIds');
    expect(store.childMachines()['fileIds']).toHaveLength(2);

    // Complete first child -> still in each:fileIds
    store.sendToChild('fileIds', 'file-1', 'COMPLETE');
    expect(store.fsmState()).toBe('each:fileIds');

    // Complete second child -> automatically dispatches ALL_DONE -> 'completed'!
    store.sendToChild('fileIds', 'file-2', 'COMPLETE');
    expect(store.fsmState()).toBe('completed');
    expect(store.childMachines()['fileIds']).toHaveLength(2);
    expect(store.childMachines()['fileIds'].every((c) => c.isDone)).toBe(true);
  });

  it('supports zero-leakage sub-machine stores (BaristaStore) and explicit input/output contracts', async () => {
    interface SubCtx {
      selectedDrink: string | null;
      brewed: boolean;
      error: string | null;
    }
    type SubMethods = {
      _brew(
        payload: void,
        signal: AbortSignal,
        ctx: Readonly<SubCtx>,
      ): Promise<{ brewed: boolean }>;
      _onBrewed(res: { brewed: boolean }): void;
      _setBrewError(err: Error): void;
    };
    const subBarista = createFSM<{
      events: { START_BREWING: void };
      states: 'ticketQueued' | 'brewingCoffee' | 'maintenance';
      context: SubCtx;
      methods: SubMethods;
    }>()({
      id: 'barista',
      initial: 'ticketQueued',
      transitions: [
        ['ticketQueued',  'START_BREWING', awaiting('brewingCoffee'), { call: (m) => m._brew }],
        ['brewingCoffee', 'DONE',          finalState('COFFEE_READY'), { call: (m) => m._onBrewed }],
        ['brewingCoffee', 'ERROR',         'maintenance',             { call: (m) => m._setBrewError }],
      ],
    });

    interface ShopCtx {
      drinkOrder: string;
      paid: boolean;
      cupReady: boolean;
    }
    type ShopMethods = {
      _checkLoyalty(): void;
      _markPaid(): void;
      _onCupReady(output: SubCtx): void;
    };
    const shopFSM = createFSM<{
      events: { ORDER: void; PAY: void; CANCEL: void };
      states: 'browsing' | 'checkingLoyalty' | 'awaitingPayment' | 'ready';
      context: ShopCtx;
      methods: ShopMethods;
    }>()({
      id: 'shop',
      initial: 'browsing',
      transitions: [
        ['browsing',        'ORDER',        awaiting('checkingLoyalty'), { call: (m) => m._checkLoyalty }],
        ['checkingLoyalty', 'DONE',         'awaitingPayment'],
        ['checkingLoyalty', 'ERROR',        'browsing'],
        [
          'awaitingPayment',
          'PAY',
          subBarista,
          {
            call: (m) => m._markPaid,
            input: (ctx) => ({ selectedDrink: ctx.drinkOrder }),
          },
        ],
        [subBarista,        'CANCEL',       'browsing'],
        [subBarista,        'COFFEE_READY', 'ready',                   { call: (m) => m._onCupReady }],
      ],
    });

    // Self-contained child store (Zero leakage into parent!)
    const BaristaStore = signalStore(
      withStateMachine(subBarista, {
        state: {
          selectedDrink: null,
          brewed: false,
          error: null,
        },
        methods: (store): SubMethods => ({
          _brew: async (_payload, _sig, ctx) => ({
            brewed: ctx.selectedDrink === 'Flat White',
          }),
          _onBrewed: ({ brewed }) => patchState(store, { brewed }),
          _setBrewError: (err) => patchState(store, { error: err.message }),
        }),
      }),
    );
    expect(BaristaStore).toBeDefined();

    // 1. Omitting parent's OWN method (`_onCupReady`) or child's OWN method (`_setBrewError`) triggers a compile error:
    if (false as boolean) {
      // @ts-expect-error - Own method '_onCupReady' is missing in store methods
      signalStore(
        withState<ShopCtx>({ drinkOrder: 'Flat White', paid: false, cupReady: false }),
        withMethods(() => ({
          _checkLoyalty: () => undefined,
          _markPaid: () => undefined,
        })),
        withStateMachine(shopFSM),
      );

      // @ts-expect-error - '_setBrewError' is omitted from both withMethods and config.methods
      signalStore(
        withState<SubCtx>({
          selectedDrink: null,
          brewed: false,
          error: null,
        }),
        withStateMachine(subBarista),
      );

      const syncOnlyWithMethodFSM = createFSM<{
        events: { RESET_ERR: Error };
        states: 'idle';
        methods: SubMethods;
      }>()({
        id: 'syncOnlyWithMethod',
        initial: 'idle',
        transitions: [
          ['idle', 'RESET_ERR', stay(), { call: (m) => m._setBrewError }],
        ],
      });

      // @ts-expect-error - '_setBrewError' is missing when config is omitted
      signalStore(
        withState({ error: null as string | null }),
        withStateMachine(syncOnlyWithMethodFSM),
      );
    }

    // 2. Zero-Leakage Parent Store: ZERO Barista state, ZERO Barista methods!
    const ZeroLeakageShopStore = signalStore(
      withState<ShopCtx>({ drinkOrder: 'Flat White', paid: false, cupReady: false }),
      withMethods((store): ShopMethods => ({
        _checkLoyalty: () => undefined,
        _markPaid: () => patchState(store, { paid: true }),
        _onCupReady: (output) => patchState(store, { cupReady: output.brewed }),
      })),
      withStateMachine(shopFSM),
    );

    const shop = new ZeroLeakageShopStore();
    shop.send('ORDER');
    expect(shop.fsmState()).toBe('awaitingPayment');
    shop.send('PAY');
    expect(shop.fsmState()).toBe('barista');
    expect(shop.fsmSubState()).toBe('ticketQueued');
    // Child received mapped input `{ selectedDrink: 'Flat White' }`!
    expect(shop.fsmSubContext()?.['selectedDrink']).toBe('Flat White');

    shop.send('START_BREWING');
    await new Promise((r) => setTimeout(r, 15));
    expect(shop.fsmState()).toBe('ready');
    expect(shop.cupReady()).toBe(true);
  });

  it('executes async awaiting() tasks and nested sub-machines inside 1:N each() pools and aborts all on parent interrupt', async () => {
    let abortedCount = 0;

    const orderItemFSM = createFSM<{
      events: { BREW: void };
      states: 'queued' | 'brewingItem';
      context: { id: string; drink: string; done: boolean };
      methods: {
        _brewItem: (_payload: void, signal: AbortSignal) => Promise<void>;
      };
    }>()({
      id: 'orderItem',
      initial: 'queued',
      transitions: [
        ['queued',      'BREW',  awaiting('brewingItem'), { call: (m) => m._brewItem }],
        ['brewingItem', 'DONE',  finalState('ORDER_READY')],
        ['brewingItem', 'ERROR', 'queued'],
      ],
    });

    provideStateMachine(orderItemFSM, {
      state: { id: '', drink: '', done: false },
      methods: (store) => ({
        _brewItem: (_payload, signal) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              patchState(store, { done: true });
              resolve();
            }, 25);
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              abortedCount++;
            });
          }),
      }),
    });

    const shopPoolFSM = createFSM<{
      events: { DISPATCH_ALL: void; CANCEL_ALL: void };
      context: { orders: Array<{ id: string; drink: string; done: boolean }> };
    }>()({
      id: 'shopPool',
      initial: 'idle',
      transitions: [
        ['idle',                       'DISPATCH_ALL', each('orders', orderItemFSM)],
        [each('orders', orderItemFSM), 'CANCEL_ALL',   'idle'],
        [each('orders', orderItemFSM), 'ALL_DONE',     'allFulfilled'],
      ],
    });

    const PoolStore = signalStore(
      withState({
        orders: [
          { id: 'ord-1', drink: 'Espresso', done: false },
          { id: 'ord-2', drink: 'Cappuccino', done: false },
        ],
      }),
      withStateMachine(shopPoolFSM),
    );

    const store = new PoolStore();
    store.send('DISPATCH_ALL');
    expect(store.fsmState()).toBe('each:orders');
    expect(store.childMachines()['orders']).toHaveLength(2);

    // Trigger async brewing on both concurrent items
    store.sendToChild('orders', 'ord-1', 'BREW');
    store.sendToChild('orders', 'ord-2', 'BREW');
    expect(store.isPending()).toBe(true);

    // Wait for both async child tasks to finish -> automatically dispatches ALL_DONE!
    await new Promise((r) => setTimeout(r, 45));
    expect(store.fsmState()).toBe('allFulfilled');
    expect(store.isPending()).toBe(false);

    // Now test parent group-interrupt on active 1:N pool (`CANCEL_ALL`)
    store.reset();
    store.send('DISPATCH_ALL');
    store.sendToChild('orders', 'ord-1', 'BREW');
    store.sendToChild('orders', 'ord-2', 'BREW');
    expect(store.isPending()).toBe(true);

    store.send('CANCEL_ALL');
    expect(store.fsmState()).toBe('idle');
    expect(abortedCount).toBe(2);
  });

  it('immediately aborts a 1:1 sub-machine AbortSignal when parent dispatches CANCEL during an awaiting() sub-state', () => {
    let subAborted = false;

    const childBaristaFSM = createFSM<{
      events: { START_BREWING: void };
      states: 'ticketQueued' | 'brewingCoffee';
      context: { brewed: boolean };
      methods: {
        _brewCoffee: (_payload: void, abortSignal: AbortSignal) => Promise<void>;
      };
    }>()({
      id: 'baristaInterruptTest',
      initial: 'ticketQueued',
      transitions: [
        ['ticketQueued',  'START_BREWING', awaiting('brewingCoffee'), { call: (m) => m._brewCoffee }],
        ['brewingCoffee', 'DONE',          finalState('COFFEE_READY')],
        ['brewingCoffee', 'ERROR',         'ticketQueued'],
      ],
    });

    provideStateMachine(childBaristaFSM, {
      state: { brewed: false },
      methods: (store) => ({
        _brewCoffee: (_payload, abortSignal) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              patchState(store, { brewed: true });
              resolve();
            }, 100);
            abortSignal.addEventListener('abort', () => {
              clearTimeout(timer);
              subAborted = true;
            });
          }),
      }),
    });

    const parentShopFSM = createFSM<{
      events: { PAY: void; CANCEL: void };
      states: 'idle' | 'ready';
    }>()({
      id: 'parentShopInterruptTest',
      initial: 'idle',
      transitions: [
        ['idle',          'PAY',          childBaristaFSM],
        [childBaristaFSM, 'CANCEL',       'idle'],
        [childBaristaFSM, 'COFFEE_READY', 'ready'],
      ],
    });

    const ParentStore = signalStore(withStateMachine(parentShopFSM));
    const store = new ParentStore();

    store.send('PAY');
    expect(store.fsmState()).toBe('baristaInterruptTest');
    expect(store.fsmSubState()).toBe('ticketQueued');

    store.send('START_BREWING');
    expect(store.fsmSubState()).toBe('brewingCoffee');
    expect(store.isPending()).toBe(true);
    expect(subAborted).toBe(false);

    // Parent group-interrupt while sub-machine is inside awaiting('brewingCoffee')
    store.send('CANCEL');
    expect(store.fsmState()).toBe('idle');
    expect(store.fsmSubState()).toBeNull();
    expect(store.isPending()).toBe(false);
    expect(subAborted).toBe(true);
  });

  it('supports createMachineFeature (Sandwich-Pattern), store.actors.<id>() reactive signals, unified output tuple selectors, intermediate outputs with parent stay() or exit kill, Cooperative Cancel vs Hard Kill, and Runtime Fail-Fast Guard', async () => {
    interface BaristaInputs {
      readonly selectedDrink: { readonly name: string; readonly price: number };
      readonly simulateBrewError?: boolean;
    }

    type BaristaEvents = {
      START_BREWING: void;
      TICK_PROGRESS: { readonly percent: number };
      EMERGENCY_OVERHEAT: void;
      RETRY_BREW: void;
    };

    type BaristaOutputs = {
      COFFEE_READY: {
        readonly drinkName: string;
        readonly temperatureCelsius: number;
      };
      BREW_PROGRESS: {
        readonly percent: number;
      };
      OVERHEAT_ALERT: void;
    };

    let brewAborted = false;

    const baristaFeature = createMachineFeature<{
      inputs: BaristaInputs;
      events: BaristaEvents;
      outputs: BaristaOutputs;
      states: 'ticketQueued' | 'brewingCoffee' | 'maintenance';
    }>()({
      id: 'barista',
      initial: 'ticketQueued',
      // prettier-ignore
      transitions: [
        ['ticketQueued',   'START_BREWING',      awaiting('brewingCoffee'), { call: (m) => m._brewCoffee }],
        ['brewingCoffee',  'TICK_PROGRESS',      stay(),                    { call: (m) => m._setProgress, output: ['BREW_PROGRESS', (ctx) => ({ percent: ctx.progressPercent })] }],
        ['brewingCoffee',  'EMERGENCY_OVERHEAT', stay(),                    { output: 'OVERHEAT_ALERT' }],
        ['brewingCoffee',  'DONE',               finalState(),              { call: (m) => m._saveBrewResult, output: ['COFFEE_READY', (ctx, res) => ({ drinkName: ctx.selectedDrink.name, temperatureCelsius: res.temperatureCelsius })] }],
        ['brewingCoffee',  'ERROR',              'maintenance',             { call: (m) => m._setBrewError }],
        ['maintenance',    'RETRY_BREW',         awaiting('brewingCoffee'), { call: (m) => m._brewCoffee }],
      ],
      state: {
        temperatureCelsius: null as number | null,
        progressPercent: 0,
        brewError: null as string | null,
      },
      methods: (store) => ({
        _setProgress: (ev: { readonly percent: number }) =>
          patchState(store, { progressPercent: ev.percent }),
        _setBrewError: (err: Error) =>
          patchState(store, { brewError: err.message }),
        _saveBrewResult: (res: { temperatureCelsius: number }) =>
          patchState(store, {
            temperatureCelsius: res.temperatureCelsius,
            brewError: null,
          }),
        _brewCoffee: (
          _payload: void,
          signal: AbortSignal,
          ctx: Readonly<
            BaristaInputs & {
              temperatureCelsius: number | null;
              progressPercent: number;
              brewError: string | null;
            }
          >,
        ) =>
          new Promise<{ temperatureCelsius: number }>((resolve, reject) => {
            if (ctx.simulateBrewError) {
              reject(new Error('Boiler pressure low'));
              return;
            }
            const timer = setTimeout(
              () => resolve({ temperatureCelsius: 67 }),
              25,
            );
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              brewAborted = true;
            });
          }),
      }),
    });

    interface ShopContext {
      selectedDrink: { readonly name: string; readonly price: number } | null;
      simulateBrewError: boolean;
      lastProgress: number;
      preparedDrink: {
        readonly drinkName: string;
        readonly temperatureCelsius: number;
      } | null;
    }

    type ShopMethods = {
      _onCoffeeReady(output: {
        readonly drinkName: string;
        readonly temperatureCelsius: number;
      }): void;
      _onBrewProgress(output: { readonly percent: number }): void;
    };

    // Compile-time checks for `createMachineFeature`:
    if (false as boolean) {
      createFSM<{
        events: { PAY: void };
        context: ShopContext;
      }>()({
        id: 'missingInputCompileTest',
        initial: 'browsing',
        transitions: [
          // @ts-expect-error - Missing required `{ input: (ctx) => BaristaInputs }`
          ['browsing',     'PAY',            baristaFeature],
          [baristaFeature, 'COFFEE_READY',   'ready'],
          [baristaFeature, 'BREW_PROGRESS',  stay()],
          [baristaFeature, 'OVERHEAT_ALERT', 'browsing'],
        ],
      });

      createFSM<{
        events: { PAY: void };
        context: ShopContext;
      }>()({
        id: 'missingOutputCompileTest',
        initial: 'browsing',
        transitions: [
          [
            'browsing',
            'PAY',
            // @ts-expect-error - Missing required transition rows for sub-machine outputs
            baristaFeature,
            { input: (ctx) => ({ selectedDrink: ctx.selectedDrink! }) },
          ],
        ],
      });
    }

    const shopFSM = createFSM<{
      events: { PAY: void; CANCEL: void };
      states: 'browsing' | 'ready';
      context: ShopContext;
      methods: ShopMethods;
    }>()({
      id: 'coffeeShop',
      initial: 'browsing',
      transitions: [
        [
          'browsing',
          'PAY',
          baristaFeature,
          {
            input: (ctx) => ({
              selectedDrink: ctx.selectedDrink!,
              simulateBrewError: ctx.simulateBrewError,
            }),
          },
        ],
        [baristaFeature, 'CANCEL',         'browsing'],
        [baristaFeature, 'BREW_PROGRESS',  stay(),     { call: (m) => m._onBrewProgress }],
        [baristaFeature, 'OVERHEAT_ALERT', 'browsing'],
        [baristaFeature, 'COFFEE_READY',   'ready',    { call: (m) => m._onCoffeeReady }],
      ],
    });

    // Notice: Zero BaristaStore, zero provideStateMachine!
    const ShopStore = signalStore(
      withState<ShopContext>({
        selectedDrink: { name: 'Oat Cappuccino', price: 4.8 },
        simulateBrewError: true,
        lastProgress: 0,
        preparedDrink: null,
      }),
      withMethods(
        (store): ShopMethods => ({
          _onCoffeeReady: (output) =>
            patchState(store, { preparedDrink: output }),
          _onBrewProgress: (output) =>
            patchState(store, { lastProgress: output.percent }),
        }),
      ),
      withStateMachine(shopFSM),
    );

    const store = new ShopStore();
    expect(store.fsmState()).toBe('browsing');
    // Inactive sub-machine -> store.actors.barista() is null
    expect(store.actors.barista()).toBeNull();

    // Enter baristaFeature with simulateBrewError: true
    store.send('PAY');
    expect(store.fsmState()).toBe('barista');
    expect(store.fsmSubState()).toBe('ticketQueued');
    expect(store.actors.barista()?.selectedDrink.name).toBe('Oat Cappuccino');
    expect(store.actors.barista()?.brewError).toBeNull();

    // Start brewing -> fails and transitions to 'maintenance' with brewError patched via patchState(store, ...)
    store.send('START_BREWING');
    await new Promise((r) => setTimeout(r, 10));
    expect(store.fsmSubState()).toBe('maintenance');
    expect(store.actors.barista()?.brewError).toBe('Boiler pressure low');
    // Zero internal state leaked into parent store!
    expect('brewError' in store.fsmContext()).toBe(false);

    // Fix error and retry -> succeeds and emits COFFEE_READY with mapped payload!
    store.send('CANCEL');
    expect(store.fsmState()).toBe('browsing');
    expect(store.actors.barista()).toBeNull();

    store.patchContext({ simulateBrewError: false });
    store.send('PAY');
    store.send('START_BREWING');
    expect(store.fsmSubState()).toBe('brewingCoffee');
    expect(store.isPending()).toBe(true);

    // Test intermediate output (`stay()` + `output: ['BREW_PROGRESS', ...]`) updates both `store.actors.barista()` and parent!
    store.send('TICK_PROGRESS', { percent: 55 });
    expect(store.actors.barista()?.progressPercent).toBe(55);
    expect(store.lastProgress()).toBe(55);
    expect(store.fsmState()).toBe('barista');
    expect(store.fsmSubState()).toBe('brewingCoffee');

    // Test Hard Kill when parent transitions away from sub-machine on intermediate output (`OVERHEAT_ALERT` -> `'browsing'`)
    store.send('EMERGENCY_OVERHEAT');
    expect(brewAborted).toBe(true);
    expect(store.fsmState()).toBe('browsing');
    expect(store.actors.barista()).toBeNull();

    // Re-enter and test Hard Kill via direct parent CANCEL during brewing -> aborts AbortSignal immediately
    brewAborted = false;
    store.send('PAY');
    store.send('START_BREWING');
    store.send('CANCEL');
    expect(brewAborted).toBe(true);
    expect(store.fsmState()).toBe('browsing');
    expect(store.actors.barista()).toBeNull();

    // Re-enter and let brewing finish -> COFFEE_READY payload delivered to _onCoffeeReady
    store.send('PAY');
    store.send('START_BREWING');
    await new Promise((r) => setTimeout(r, 40));
    expect(store.fsmState()).toBe('ready');
    expect(store.actors.barista()).toBeNull();
    expect(store.preparedDrink()).toEqual({
      drinkName: 'Oat Cappuccino',
      temperatureCelsius: 67,
    });

    // Test Runtime Fail-Fast Guard when sub-machine emits an unhandled output via `as any`:
    const unhandledSub = createMachineFeature<{
      events: { FAIL_BEANS: void };
      outputs: { BEAN_EMPTY: void };
      states: 'idle';
    }>()({
      id: 'barista',
      initial: 'idle',
      transitions: [
        ['idle', 'FAIL_BEANS', finalState('BEAN_EMPTY')],
      ],
    });
    const brokenParentFSM = createFSM<{
      events: { ENTER: void };
    }>()({
      id: 'coffeeShop',
      initial: 'browsing',
      transitions: [
        ['browsing', 'ENTER', unhandledSub],
      ] as any,
    });
    const BrokenStore = signalStore(withStateMachine(brokenParentFSM));
    const brokenStore = new BrokenStore();
    brokenStore.send('ENTER');
    expect(() => brokenStore.send('FAIL_BEANS' as any)).toThrow(
      "[MatrixFSM Error]: Sub-machine 'barista' emitted output 'BEAN_EMPTY', but parent 'coffeeShop' has no matching transition. Prevented silent deadlock!",
    );
  });

  it('tests a createMachineFeature in pure Vitest without Angular TestBed via createFeatureTester', async () => {
    const baristaFSM = createMachineFeature<{
      inputs: {
        readonly drink: {
          readonly id: string;
          readonly name: string;
          readonly price: number;
        };
      };
      events: { START_BREWING: void };
      outputs: {
        COFFEE_READY: {
          readonly drinkName: string;
          readonly result: {
            readonly drinkName: string;
            readonly brewedAt: number;
          };
        };
      };
      states: 'ticketQueued' | 'brewingCoffee' | 'maintenance';
    }>()({
      id: 'barista',
      initial: 'ticketQueued',
      // prettier-ignore
      transitions: [
        ['ticketQueued',  'START_BREWING', awaiting('brewingCoffee'), { call: (m) => m._brewCoffee }],
        ['brewingCoffee', 'DONE',          finalState(),              { call: (m) => m._saveResult, output: ['COFFEE_READY', (ctx, res) => ({ drinkName: ctx.drink.name, result: res })] }],
        ['brewingCoffee', 'ERROR',         'maintenance'],
      ],
      state: {
        baristaResult: null as {
          readonly drinkName: string;
          readonly brewedAt: number;
        } | null,
        error: null as string | null,
      },
      methods: (
        store,
        api = (() => {
          throw new Error(
            'Angular DI inject() must not be called in createFeatureTester!',
          );
        })(),
      ) => ({
        _brewCoffee: async (
          _payload: void,
          _signal: AbortSignal,
          _ctx: any,
        ): Promise<{ readonly drinkName: string; readonly brewedAt: number }> =>
          api,
        _saveResult: (res: {
          readonly drinkName: string;
          readonly brewedAt: number;
        }) => patchState(store, { baristaResult: res, error: null }),
      }),
    });

    const tester = createFeatureTester(baristaFSM, {
      inputs: { drink: { id: 'espresso', name: 'Espresso', price: 3 } },
      methods: {
        _brewCoffee: async (_payload: void, _signal: AbortSignal, ctx: any) => ({
          drinkName: ctx.drink.name,
          brewedAt: 12345,
        }),
      },
    });

    expect(tester.state()).toBe('ticketQueued');
    expect(tester.context().drink.name).toBe('Espresso');

    tester.send('START_BREWING');
    expect(tester.state()).toBe('brewingCoffee');

    // Warte auf Abschluss des gemockten Tasks:
    await tester.flushTasks();

    expect(tester.isCompleted()).toBe(true);
    expect(tester.emittedOutputs()).toEqual([
      {
        type: 'COFFEE_READY',
        payload: {
          drinkName: 'Espresso',
          result: { drinkName: 'Espresso', brewedAt: 12345 },
        },
      },
    ]);
  });

  it('orchestrates parallel createMachineFeature actors via each("drinks", baristaFSM), waits for ALL_DONE, and aborts all AbortSignals on parent CANCEL', async () => {
    const abortedDrinks: string[] = [];
    const resolvers = new Map<string, () => void>();

    const baristaFSM = createMachineFeature<{
      inputs: {
        readonly drink: {
          readonly id: string;
          readonly name: string;
          readonly price: number;
        };
      };
      events: { START_BREWING: void };
      outputs: {
        COFFEE_READY: { readonly drinkId: string; readonly drinkName: string };
      };
      states: 'ticketQueued' | 'brewingCoffee' | 'maintenance';
    }>()({
      id: 'barista',
      initial: 'ticketQueued',
      // prettier-ignore
      transitions: [
        ['ticketQueued',  'START_BREWING', awaiting('brewingCoffee'), { call: (m) => m._brewCoffee }],
        ['brewingCoffee', 'DONE',          finalState(),              { output: ['COFFEE_READY', (ctx) => ({ drinkId: ctx.drink.id, drinkName: ctx.drink.name })] }],
        ['brewingCoffee', 'ERROR',         'maintenance'],
      ],
      state: {
        brewed: false,
      },
      methods: (store) => ({
        _brewCoffee: (
          _payload: void,
          abortSignal: AbortSignal,
          ctx: Readonly<{
            drink: { id: string; name: string; price: number };
            brewed: boolean;
          }>,
        ) =>
          new Promise<void>((resolve) => {
            resolvers.set(ctx.drink.id, () => {
              patchState(store, { brewed: true });
              resolve();
            });
            abortSignal.addEventListener('abort', () => {
              abortedDrinks.push(ctx.drink.id);
            });
          }),
      }),
    });

    const batchOrderFSM = createFSM<{
      events: { PLACE_BATCH: void; CANCEL: void };
      states: 'idle' | 'orderCompleted';
      context: {
        drinks: Array<{ id: string; name: string; price: number }>;
        completedCups: Array<{ drinkId: string; drinkName: string }>;
      };
      methods: {
        _onAllDone(
          outputs: Array<{ drinkId: string; drinkName: string }>,
        ): void;
      };
    }>()({
      id: 'batchOrder',
      initial: 'idle',
      transitions: [
        ['idle',                       'PLACE_BATCH', each('drinks', baristaFSM)],
        [each('drinks', baristaFSM),   'CANCEL',      'idle'],
        [each('drinks', baristaFSM),   'ALL_DONE',    'orderCompleted',          { call: (m) => m._onAllDone }],
      ],
    });

    const BatchStore = signalStore(
      withState({
        drinks: [
          { id: 'espresso', name: 'Espresso', price: 3 },
          { id: 'latte', name: 'Latte', price: 4 },
        ],
        completedCups: [] as Array<{ drinkId: string; drinkName: string }>,
      }),
      withMethods((store) => ({
        _onAllDone: (outputs: Array<{ drinkId: string; drinkName: string }>) =>
          patchState(store, { completedCups: outputs }),
      })),
      withStateMachine(batchOrderFSM),
    );

    const store = new BatchStore();

    // 1. Start batch and trigger brewing on both parallel baristaFSM actors:
    store.send('PLACE_BATCH');
    expect(store.fsmState()).toBe('each:drinks');
    expect(store.childMachines()['drinks']).toHaveLength(2);

    store.send('START_BREWING');
    expect(store.isPending()).toBe(true);

    // First actor finishes -> parent MUST remain in 'each:drinks' until second actor finishes!
    resolvers.get('espresso')?.();
    await new Promise((r) => setTimeout(r, 5));
    expect(store.fsmState()).toBe('each:drinks');

    // Second actor finishes -> ALL_DONE fires and transitions parent to 'orderCompleted'!
    resolvers.get('latte')?.();
    await new Promise((r) => setTimeout(r, 5));
    expect(store.fsmState()).toBe('orderCompleted');
    expect(store.completedCups()).toEqual([
      { drinkId: 'espresso', drinkName: 'Espresso' },
      { drinkId: 'latte', drinkName: 'Latte' },
    ]);

    // 2. Parent interrupt: [each('drinks', baristaFSM), 'CANCEL', 'idle'] aborts all running instances:
    store.reset();
    resolvers.clear();
    store.send('PLACE_BATCH');
    store.send('START_BREWING');
    expect(store.isPending()).toBe(true);

    store.send('CANCEL');
    expect(store.fsmState()).toBe('idle');
    expect(store.isPending()).toBe(false);
    expect(abortedDrinks).toEqual(['espresso', 'latte']);
  });

  describe('Cycle 9: Global Event Handling with anyState() in Angular SignalStore', () => {
    it('hard-kills in-flight awaiting tasks and active sub-actors on global anyState() transition, while stay() is non-interrupting and child cooperative handlers take precedence', async () => {
      let uploadAborted = false;
      let childAborted = false;
      const eventsLog: string[] = [];

      const childActor = createMachineFeature<{
        events: { BEGIN_WORK: void; PING: void; CHILD_FINISH: void };
        states: 'ready' | 'working';
      }>()({
        id: 'childActor',
        initial: 'ready',
        transitions: [
          ['ready',   'BEGIN_WORK',   awaiting('working'), { call: (m) => m._work }],
          ['working', 'PING',         stay(),              { call: (m) => m._onChildPing }],
          ['working', 'DONE',         finalState()],
          ['working', 'ERROR',        'ready'],
          ['working', 'CHILD_FINISH', finalState()],
        ],
        methods: () => ({
          _onChildPing: () => eventsLog.push('childPing'),
          _work: (_payload: void, sig: AbortSignal) =>
            new Promise<void>((_resolve, reject) => {
              sig.addEventListener('abort', () => {
                childAborted = true;
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }),
        }),
      });

      const parentFSM = createFSM<{
        events: {
          START_UPLOAD: void;
          ENTER_CHILD: void;
          PING: void;
          LOGOUT: void;
        };
        outputs: {
          loggedOut: void;
        };
        states: 'idle' | 'uploading' | 'done' | 'loggedOut';
        methods: {
          _upload(_payload: void, sig: AbortSignal): Promise<void>;
          _onParentPing(): void;
          _onLogout(): void;
        };
      }>()({
        id: 'parentWithAnyState',
        initial: 'idle',
        transitions: [
          ['idle',      'START_UPLOAD', awaiting('uploading'),    { call: (m) => m._upload }],
          ['idle',      'ENTER_CHILD',  childActor],
          ['uploading', 'DONE',         'done'],
          ['uploading', 'ERROR',        'idle'],
          [childActor,  'DONE',         'done'],
          [anyState(),  'PING',         stay(),                   { call: (m) => m._onParentPing }],
          [anyState(),  'LOGOUT',       finalState('loggedOut'),  { call: (m) => m._onLogout }],
        ],
      });

      const Store = signalStore(
        withStateMachine(parentFSM, {
          methods: () => ({
            _upload: (_payload: void, sig: AbortSignal) =>
              new Promise<void>((_resolve, reject) => {
                sig.addEventListener('abort', () => {
                  uploadAborted = true;
                  reject(new DOMException('Aborted', 'AbortError'));
                });
              }),
            _onParentPing: () => eventsLog.push('parentPing'),
            _onLogout: () => eventsLog.push('logout'),
          }),
        }),
      );

      const store = new Store();

      // 1. Start awaiting('uploading'); global PING with stay() does NOT abort the task!
      store.send('START_UPLOAD');
      expect(store.fsmState()).toBe('uploading');
      expect(store.isPending()).toBe(true);

      store.send('PING');
      expect(store.fsmState()).toBe('uploading');
      expect(uploadAborted).toBe(false);
      expect(eventsLog).toEqual(['parentPing']);

      // 2. Global LOGOUT with target 'loggedOut' hard-kills the in-flight uploading task!
      store.send('LOGOUT');
      expect(store.fsmState()).toBe('loggedOut');
      expect(uploadAborted).toBe(true);
      expect(store.isPending()).toBe(false);
      expect(eventsLog).toEqual(['parentPing', 'logout']);

      // 3. Reset, enter childActor; child handles PING cooperatively before parent's [anyState(), 'PING', ...]
      store.reset();
      eventsLog.length = 0;
      store.send('ENTER_CHILD');
      expect(store.fsmState()).toBe('childActor');
      store.send('BEGIN_WORK');
      expect(store.fsmSubState()).toBe('working');

      store.send('PING');
      expect(eventsLog).toEqual(['childPing']);

      // 4. Child does NOT handle LOGOUT -> parent's [anyState(), 'LOGOUT', 'loggedOut'] destroys childActor!
      store.send('LOGOUT');
      expect(store.fsmState()).toBe('loggedOut');
      expect(childAborted).toBe(true);
      expect(eventsLog).toEqual(['childPing', 'logout']);
    });
  });

  describe('Cycle 10: Promise-Style Actor Combinators (all, race, any) & Cross-Store Signal Bridge (whenSignal)', () => {
    it('all(m1, m2): resolves with tuple [out1, out2] on DONE and fails fast (aborting siblings) on first ERROR', async () => {
      let m2Aborted = false;
      let resolveM1!: () => void;
      let resolveM2!: () => void;

      const m1 = createMachineFeature<{
        outputs: { DONE: { flightId: string }; ERROR: { reason: string } };
        states: 'init' | 'bookingFlight';
      }>()({
        id: 'flightActor',
        initial: 'init',
        transitions: [
          ['init',          always(), awaiting('bookingFlight'), { call: (m) => m._bookFlight }],
          ['bookingFlight', 'DONE',   finalState(),              { output: ['DONE', () => ({ flightId: 'FL-100' })] }],
          ['bookingFlight', 'ERROR',  finalState(),              { output: ['ERROR', () => ({ reason: 'no-flights' })] }],
        ],
        methods: () => ({
          _bookFlight: () =>
            new Promise<void>((resolve) => {
              resolveM1 = resolve;
            }),
        }),
      });

      const m2 = createMachineFeature<{
        outputs: { DONE: { hotelId: string }; ERROR: { reason: string } };
        states: 'init' | 'bookingHotel';
      }>()({
        id: 'hotelActor',
        initial: 'init',
        transitions: [
          ['init',         always(), awaiting('bookingHotel'), { call: (m) => m._bookHotel }],
          ['bookingHotel', 'DONE',   finalState(),             { output: ['DONE', () => ({ hotelId: 'HT-200' })] }],
          ['bookingHotel', 'ERROR',  finalState(),             { output: ['ERROR', () => ({ reason: 'no-rooms' })] }],
        ],
        methods: () => ({
          _bookHotel: (_payload: void, sig: AbortSignal) =>
            new Promise<void>((resolve, reject) => {
              resolveM2 = resolve;
              sig.addEventListener('abort', () => {
                m2Aborted = true;
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }),
        }),
      });

      const recordedPayloads: unknown[] = [];

      const travelFSM = createFSM<{
        events: { BOOK: void; FAIL_FLIGHT: void };
        states: 'idle' | 'confirmed' | 'failed';
        methods: {
          _onAllBooked(tuple: [{ flightId: string }, { hotelId: string }]): void;
          _onFailed(err: { reason: string }): void;
        };
      }>()({
        id: 'travelAll',
        initial: 'idle',
        transitions: [
          ['idle',      'BOOK',  all(m1, m2)],
          [all(m1, m2), 'DONE',  'confirmed', { call: (m) => m._onAllBooked }],
          [all(m1, m2), 'ERROR', 'failed',    { call: (m) => m._onFailed }],
        ],
      });

      const TravelStore = signalStore(
        withStateMachine(travelFSM, {
          methods: () => ({
            _onAllBooked: (tuple) => recordedPayloads.push(tuple),
            _onFailed: (err) => recordedPayloads.push(err),
          }),
        }),
      );

      const store = new TravelStore();
      store.send('BOOK');
      expect(store.fsmState()).toBe('all:flightActor,hotelActor');

      resolveM1();
      await new Promise((r) => setTimeout(r, 5));
      expect(store.fsmState()).toBe('all:flightActor,hotelActor');

      resolveM2();
      await new Promise((r) => setTimeout(r, 5));
      expect(store.fsmState()).toBe('confirmed');
      expect(recordedPayloads).toEqual([
        [{ flightId: 'FL-100' }, { hotelId: 'HT-200' }],
      ]);

      // Fail-fast check: if m1 emits ERROR, m2 is immediately aborted and parent transitions to 'failed'
      const m1Fail = createMachineFeature<{
        outputs: { DONE: { flightId: string }; ERROR: { reason: string } };
        states: 'init' | 'bookingFlight';
      }>()({
        id: 'flightActorFail',
        initial: 'init',
        transitions: [
          ['init',          always(), awaiting('bookingFlight'), { call: (m) => m._bookFlight }],
          ['bookingFlight', 'DONE',   finalState(),              { output: ['ERROR', () => ({ reason: 'flight-rejected' })] }],
          ['bookingFlight', 'ERROR',  finalState(),              { output: ['ERROR', () => ({ reason: 'flight-rejected' })] }],
        ],
        methods: () => ({
          _bookFlight: async () => undefined,
        }),
      });

      const failFastFSM = createFSM<{
        events: { BOOK: void };
        states: 'idle' | 'confirmed' | 'failed';
      }>()({
        id: 'travelFailFast',
        initial: 'idle',
        transitions: [
          ['idle',          'BOOK',  all(m1Fail, m2)],
          [all(m1Fail, m2), 'DONE',  'confirmed'],
          [all(m1Fail, m2), 'ERROR', 'failed'],
        ],
      });

      const FailFastStore = signalStore(withStateMachine(failFastFSM));
      const failStore = new FailFastStore();
      failStore.send('BOOK');
      await new Promise((r) => setTimeout(r, 10));
      expect(failStore.fsmState()).toBe('failed');
      expect(m2Aborted).toBe(true);
    });

    it('race(m1, m2): winner takes all and immediately aborts the loser', async () => {
      let slowAborted = false;

      const fastActor = createMachineFeature<{
        outputs: { FOUND: string };
        states: 'init' | 'searching';
      }>()({
        id: 'fastActor',
        initial: 'init',
        transitions: [
          ['init',      always(), awaiting('searching'), { call: (m) => m._search }],
          ['searching', 'DONE',   finalState(),          { output: ['FOUND', () => 'cache-hit'] }],
          ['searching', 'ERROR',  finalState(),          { output: ['FOUND', () => 'fallback'] }],
        ],
        methods: () => ({
          _search: async () => undefined,
        }),
      });

      const slowActor = createMachineFeature<{
        outputs: { TIMEOUT: void };
        states: 'init' | 'waiting';
      }>()({
        id: 'slowActor',
        initial: 'init',
        transitions: [
          ['init',    always(), awaiting('waiting'), { call: (m) => m._wait }],
          ['waiting', 'DONE',   finalState('TIMEOUT')],
          ['waiting', 'ERROR',  finalState('TIMEOUT')],
        ],
        methods: () => ({
          _wait: (_payload: void, sig: AbortSignal) =>
            new Promise<void>((_resolve, reject) => {
              sig.addEventListener('abort', () => {
                slowAborted = true;
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }),
        }),
      });

      const winners: string[] = [];

      const raceFSM = createFSM<{
        events: { START: void };
        states: 'idle' | 'won' | 'timedOut';
        methods: { _onFound(val: string): void };
      }>()({
        id: 'raceMachine',
        initial: 'idle',
        transitions: [
          ['idle',                       'START',   race(fastActor, slowActor)],
          [race(fastActor, slowActor),   'FOUND',   'won',                      { call: (m) => m._onFound }],
          [race(fastActor, slowActor),   'TIMEOUT', 'timedOut'],
        ],
      });

      const RaceStore = signalStore(
        withStateMachine(raceFSM, {
          methods: () => ({
            _onFound: (val: string) => winners.push(val),
          }),
        }),
      );

      const store = new RaceStore();
      store.send('START');
      await new Promise((r) => setTimeout(r, 10));

      expect(store.fsmState()).toBe('won');
      expect(winners).toEqual(['cache-hit']);
      expect(slowAborted).toBe(true);
    });

    it('any(m1, m2): ignores individual ERRORs until first DONE wins, or emits AggregateError tuple if all fail', async () => {
      let backupAborted = false;

      const failingPrimary = createMachineFeature<{
        outputs: { DONE: string; ERROR: string };
        states: 'init' | 'connecting';
      }>()({
        id: 'failingPrimary',
        initial: 'init',
        transitions: [
          ['init',       always(), awaiting('connecting'), { call: (m) => m._connect }],
          ['connecting', 'DONE',   finalState(),           { output: ['ERROR', () => 'primary-down'] }],
          ['connecting', 'ERROR',  finalState(),           { output: ['ERROR', () => 'primary-down'] }],
        ],
        methods: () => ({
          _connect: async () => undefined,
        }),
      });

      const succeedingMirror = createMachineFeature<{
        outputs: { DONE: string; ERROR: string };
        states: 'init' | 'connecting';
      }>()({
        id: 'succeedingMirror',
        initial: 'init',
        transitions: [
          ['init',       always(), awaiting('connecting'), { call: (m) => m._connect }],
          ['connecting', 'DONE',   finalState(),           { output: ['DONE', () => 'mirror-ok'] }],
          ['connecting', 'ERROR',  finalState(),           { output: ['ERROR', () => 'mirror-down'] }],
        ],
        methods: () => ({
          _connect: () => new Promise<void>((r) => setTimeout(r, 5)),
        }),
      });

      const slowBackup = createMachineFeature<{
        outputs: { DONE: string; ERROR: string };
        states: 'init' | 'connecting';
      }>()({
        id: 'slowBackup',
        initial: 'init',
        transitions: [
          ['init',       always(), awaiting('connecting'), { call: (m) => m._connect }],
          ['connecting', 'DONE',   finalState(),           { output: ['DONE', () => 'backup-ok'] }],
          ['connecting', 'ERROR',  finalState(),           { output: ['ERROR', () => 'backup-down'] }],
        ],
        methods: () => ({
          _connect: (_payload: void, sig: AbortSignal) =>
            new Promise<void>((_resolve, reject) => {
              sig.addEventListener('abort', () => {
                backupAborted = true;
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }),
        }),
      });

      const results: unknown[] = [];

      const anySuccessFSM = createFSM<{
        events: { CONNECT: void };
        states: 'idle' | 'connected' | 'allFailed';
        methods: { _onConnected(res: string): void };
      }>()({
        id: 'anySuccess',
        initial: 'idle',
        transitions: [
          ['idle',                                                 'CONNECT', any(failingPrimary, succeedingMirror, slowBackup)],
          [any(failingPrimary, succeedingMirror, slowBackup),      'DONE',    'connected', { call: (m) => m._onConnected }],
          [any(failingPrimary, succeedingMirror, slowBackup),      'ERROR',   'allFailed'],
        ],
      });

      const AnySuccessStore = signalStore(
        withStateMachine(anySuccessFSM, {
          methods: () => ({
            _onConnected: (res: string) => results.push(res),
          }),
        }),
      );

      const store = new AnySuccessStore();
      store.send('CONNECT');
      await new Promise((r) => setTimeout(r, 20));

      expect(store.fsmState()).toBe('connected');
      expect(results).toEqual(['mirror-ok']);
      expect(backupAborted).toBe(true);

      // Now test all failing -> emits ERROR with tuple of errors
      const failingMirror = createMachineFeature<{
        outputs: { DONE: string; ERROR: string };
        states: 'init' | 'connecting';
      }>()({
        id: 'failingMirror',
        initial: 'init',
        transitions: [
          ['init',       always(), awaiting('connecting'), { call: (m) => m._connect }],
          ['connecting', 'DONE',   finalState(),           { output: ['ERROR', () => 'mirror-down'] }],
          ['connecting', 'ERROR',  finalState(),           { output: ['ERROR', () => 'mirror-down'] }],
        ],
        methods: () => ({
          _connect: async () => undefined,
        }),
      });

      const aggregateErrors: unknown[] = [];
      const anyFailFSM = createFSM<{
        events: { CONNECT: void };
        states: 'idle' | 'connected' | 'allFailed';
        methods: { _onAllFailed(errs: [string, string]): void };
      }>()({
        id: 'anyFail',
        initial: 'idle',
        transitions: [
          ['idle',                               'CONNECT', any(failingPrimary, failingMirror)],
          [any(failingPrimary, failingMirror),   'DONE',    'connected'],
          [any(failingPrimary, failingMirror),   'ERROR',   'allFailed', { call: (m) => m._onAllFailed }],
        ],
      });

      const AnyFailStore = signalStore(
        withStateMachine(anyFailFSM, {
          methods: () => ({
            _onAllFailed: (errs) => aggregateErrors.push(errs),
          }),
        }),
      );

      const failStore = new AnyFailStore();
      failStore.send('CONNECT');
      await new Promise((r) => setTimeout(r, 15));

      expect(failStore.fsmState()).toBe('allFailed');
      expect(aggregateErrors).toEqual([['primary-down', 'mirror-down']]);
    });

    it('supports passing a root createMachineFeature directly to signalStore(withStateMachine(feature)) without config, withState, or withMethods', async () => {
      const externalPromoSig = signal<boolean>(false);

      const myRootFeature = createMachineFeature<{
        events: {
          SELECT_ITEM: { item: string };
          CHECKOUT: void;
          PROMO_ACTIVATED: void;
        };
        states: 'browsing' | 'processingCheckout' | 'completed';
      }>()({
        id: 'myRootFeature',
        initial: 'browsing',
        // prettier-ignore
        transitions: [
          ['browsing',           'SELECT_ITEM',     stay(),                         { call: (m) => m._selectItem }],
          ['browsing',           'PROMO_ACTIVATED', stay(),                         { call: (m) => m._enablePromo }],
          ['browsing',           'CHECKOUT',        awaiting('processingCheckout'), { call: (m) => m._processCheckout }],
          ['processingCheckout', 'DONE',            'completed',                    { call: (m) => m._setOrder }],
          ['processingCheckout', 'ERROR',           'browsing'],
        ],
        state: {
          selectedItem: null as string | null,
          promoActive: false,
          orderId: null as string | null,
        },
        syncContext: () => ({
          promoActive: externalPromoSig,
        }),
        methods: (store) => ({
          _selectItem: ({ item }: { item: string }) =>
            patchState(store, { selectedItem: item }),
          _enablePromo: () => patchState(store, { promoActive: true }),
          _processCheckout: async (
            _payload: void,
            _signal: AbortSignal,
            ctx: Readonly<{
              selectedItem: string | null;
              promoActive: boolean;
              orderId: string | null;
            }>,
          ) => ({
            orderId: `ORD-${ctx.selectedItem}`,
          }),
          _setOrder: (res: { orderId: string }) =>
            patchState(store, { orderId: res.orderId }),
        }),
      });

      const RootFeatureStore = signalStore(withStateMachine(myRootFeature));
      const store = new RootFeatureStore();

      expect(store.fsmState()).toBe('browsing');
      expect(store.selectedItem()).toBeNull();
      expect(store.promoActive()).toBe(false);
      expect(store.orderId()).toBeNull();

      // 1. Feature `syncContext` signal mirroring works automatically
      externalPromoSig.set(true);
      expect(store.promoActive()).toBe(true);

      // 2. Feature `methods` work automatically and update store state signals
      store.send('SELECT_ITEM', { item: 'Espresso' });
      expect(store.selectedItem()).toBe('Espresso');

      // 3. Feature async execution works automatically
      store.send('CHECKOUT');
      await new Promise((r) => setTimeout(r, 15));
      expect(store.fsmState()).toBe('completed');
      expect(store.orderId()).toBe('ORD-Espresso');
    });
  });

  describe('Cycle 15: after(ms) on initial State & Sub-Actor Timer Cleanup on Hard-Kill', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('schedules after(ms) on initial state without prior send() and clears sub-actor timers on parent Hard-Kill (CANCEL)', () => {
      // 1. Machine whose initial state 'splash' has ['splash', after(1000), 'home'] without prior send()
      const splashFeature = createMachineFeature<{
        states: 'splash' | 'home';
      }>()({
        id: 'splashFeature',
        initial: 'splash',
        transitions: [
          ['splash', after(1000), 'home'],
        ],
      });

      const SplashStore = signalStore(withStateMachine(splashFeature));
      const splashStore = new SplashStore();
      expect(splashStore.fsmState()).toBe('splash');

      vi.advanceTimersByTime(1000);
      expect(splashStore.fsmState()).toBe('home');

      // 2. Sub-actor with internal after(5000) transition interrupted at t = 1000ms by parent CANCEL (Hard Kill)
      let subTimerFired = false;

      const timedSubFeature = createMachineFeature<{
        outputs: { DONE: void };
        states: 'waitingInSub';
      }>()({
        id: 'timedSubFeature',
        initial: 'waitingInSub',
        transitions: [
          ['waitingInSub', after(5000), finalState('DONE'), { call: (m) => m._onSubTimeout }],
        ],
        methods: () => ({
          _onSubTimeout: () => {
            subTimerFired = true;
          },
        }),
      });

      const parentFeature = createMachineFeature<{
        events: { START: void; CANCEL: void };
        states: 'idle' | 'completed';
      }>()({
        id: 'parentWithTimedSub',
        initial: 'idle',
        transitions: [
          ['idle',            'START',  timedSubFeature],
          [timedSubFeature,   'CANCEL', 'idle'],
          [timedSubFeature,   'DONE',   'completed'],
        ],
      });

      const ParentStore = signalStore(withStateMachine(parentFeature));
      const parentStore = new ParentStore();

      parentStore.send('START');
      expect(parentStore.fsmState()).toBe('timedSubFeature');
      expect(parentStore.fsmSubState()).toBe('waitingInSub');

      // Interrupt at t = 1000ms via parent CANCEL (Hard Kill)
      vi.advanceTimersByTime(1000);
      parentStore.send('CANCEL');
      expect(parentStore.fsmState()).toBe('idle');
      expect(parentStore.fsmSubState()).toBeNull();

      // Advance to t = 5000ms -> sub-actor timer is cleared and never fires!
      vi.advanceTimersByTime(4000);
      expect(subTimerFired).toBe(false);
      expect(parentStore.fsmState()).toBe('idle');
    });
  });

  describe('Cycle 18: 8-Phase Microstep Pipeline, Live Context Sync (getState) & Zero-Tick Child Safety', () => {
    it('executes call (patchState) BEFORE input selector when entering a sub-actor in the same transition row', () => {
      const baristaSub = createMachineFeature<{
        inputs: { readonly selectedDrink: string };
        events: { FINISH: void };
        outputs: { COFFEE_READY: { readonly servedDrink: string } };
        states: 'brewing';
      }>()({
        id: 'barista',
        initial: 'brewing',
        transitions: [
          [
            'brewing',
            'FINISH',
            finalState(),
            {
              output: [
                'COFFEE_READY',
                (ctx) => ({ servedDrink: ctx.selectedDrink }),
              ],
            },
          ],
        ],
      });

      const shopFeature = createMachineFeature<{
        events: { QUICK_ORDER: { readonly drink: string } };
        states: 'idle' | 'ready';
      }>()({
        id: 'shopQuickOrder',
        initial: 'idle',
        transitions: [
          [
            'idle',
            'QUICK_ORDER',
            baristaSub,
            {
              call: (m) => m._selectDrink,
              input: (ctx) => ({ selectedDrink: ctx.selectedDrink! }),
            },
          ],
          [baristaSub, 'COFFEE_READY', 'ready', { call: (m) => m._onReady }],
        ],
        state: {
          selectedDrink: null as string | null,
          servedDrink: null as string | null,
        },
        methods: (store) => ({
          _selectDrink: ({ drink }: { readonly drink: string }) =>
            patchState(store, { selectedDrink: drink }),
          _onReady: ({ servedDrink }: { readonly servedDrink: string }) =>
            patchState(store, { servedDrink }),
        }),
      });

      const ShopStore = signalStore(withStateMachine(shopFeature));
      const store = new ShopStore();

      store.send('QUICK_ORDER', { drink: 'Espresso' });
      expect(store.fsmState()).toBe('barista');
      expect(store.selectedDrink()).toBe('Espresso');
      // Must see 'Espresso', NOT null!
      expect(store.actors.barista()?.selectedDrink).toBe('Espresso');

      store.send('FINISH' as any);
      expect(store.fsmState()).toBe('ready');
      expect(store.servedDrink()).toBe('Espresso');
    });

    it('handles zero-tick synchronous sub-actor completion during onStateEnter without dropping the terminal output event', () => {
      const zeroTickChild = createMachineFeature<{
        inputs: { readonly selectedDrink: string };
        outputs: { COFFEE_READY: { readonly drink: string } };
        states: 'init' | 'brewingCoffee';
      }>()({
        id: 'baristaZeroTick',
        initial: 'init',
        transitions: [
          ['init', always(), awaiting('brewingCoffee'), { call: (m) => m._brew }],
          [
            'brewingCoffee',
            'DONE',
            finalState(),
            {
              output: ['COFFEE_READY', (ctx) => ({ drink: ctx.selectedDrink })],
            },
          ],
        ],
        methods: () => ({
          // Synchronous 0ms task completion!
          _brew: () => undefined,
        }),
      });

      const parentShop = createMachineFeature<{
        events: { QUICK_ORDER: { readonly drink: string } };
        states: 'idle' | 'ready';
      }>()({
        id: 'parentZeroTick',
        initial: 'idle',
        transitions: [
          [
            'idle',
            'QUICK_ORDER',
            zeroTickChild,
            {
              call: (m) => m._selectDrink,
              input: (ctx) => ({ selectedDrink: ctx.selectedDrink! }),
            },
          ],
          [zeroTickChild, 'COFFEE_READY', 'ready', { call: (m) => m._onReady }],
        ],
        state: {
          selectedDrink: null as string | null,
          completedDrink: null as string | null,
        },
        methods: (store) => ({
          _selectDrink: ({ drink }: { readonly drink: string }) =>
            patchState(store, { selectedDrink: drink }),
          _onReady: ({ drink }: { readonly drink: string }) =>
            patchState(store, { completedDrink: drink }),
        }),
      });

      const Store = signalStore(withStateMachine(parentShop));
      const store = new Store();

      store.send('QUICK_ORDER', { drink: 'Cortado' });
      // Zero-tick child completed synchronously on enter -> parent must transition to 'ready' with 'Cortado'!
      expect(store.fsmState()).toBe('ready');
      expect(store.completedDrink()).toBe('Cortado');
    });
  });

  describe('Cycle 19: Self-Transition Re-Entry vs. stay() with Epoch Protection', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('aborts first awaiting("searching") task on self-transition re-entry, ignores stale async rejection/resolution via epoch guard, and starts second search cleanly', async () => {
      const searchCalls: Array<{
        query: string;
        signal: AbortSignal;
        resolve: (val: { results: string[] }) => void;
        reject: (err: unknown) => void;
      }> = [];

      const searchFeature = createMachineFeature<{
        events: { TYPE_QUERY: { query: string }; PING: void };
        states: 'idle' | 'searching' | 'resultsReady' | 'searchFailed';
      }>()({
        id: 'liveSearch',
        initial: 'idle',
        transitions: [
          ['idle',      'TYPE_QUERY', awaiting('searching'), { call: (m) => m._setQueryAndSearch }],
          ['searching', 'TYPE_QUERY', awaiting('searching'), { call: (m) => m._setQueryAndSearch }],
          ['searching', 'PING',       stay(),                { call: (m) => m._incPings }],
          ['searching', 'DONE',       'resultsReady',        { call: (m) => m._setResults }],
          ['searching', 'ERROR',      'searchFailed'],
        ],
        state: {
          query: '',
          results: [] as string[],
          pings: 0,
        },
        methods: (store) => ({
          _setQueryAndSearch: (
            { query }: { query: string },
            signal: AbortSignal,
          ) => {
            patchState(store, { query });
            return new Promise<{ results: string[] }>((resolve, reject) => {
              searchCalls.push({
                query,
                signal,
                resolve,
                reject,
              });
            });
          },
          _setResults: ({ results }: { results: string[] }) =>
            patchState(store, { results }),
          _incPings: () =>
            patchState(store, { pings: store.pings() + 1 }),
        }),
      });

      const SearchStore = signalStore(withStateMachine(searchFeature));
      const store = new SearchStore();

      // 1. Start first search ('espr')
      store.send('TYPE_QUERY', { query: 'espr' });
      expect(store.fsmState()).toBe('searching');
      expect(searchCalls).toHaveLength(1);
      expect(searchCalls[0].query).toBe('espr');
      expect(searchCalls[0].signal.aborted).toBe(false);

      // PING -> stay() does NOT abort the running search task!
      store.send('PING');
      expect(store.pings()).toBe(1);
      expect(searchCalls[0].signal.aborted).toBe(false);
      expect(searchCalls).toHaveLength(1);

      // 2. User types again ('espresso') -> self-transition re-entry into awaiting('searching')!
      store.send('TYPE_QUERY', { query: 'espresso' });
      expect(store.fsmState()).toBe('searching');
      // First search task's AbortSignal is immediately aborted:
      expect(searchCalls[0].signal.aborted).toBe(true);
      // Second search task started immediately with updated query from _setQuery:
      expect(searchCalls).toHaveLength(2);
      expect(searchCalls[1].query).toBe('espresso');
      expect(searchCalls[1].signal.aborted).toBe(false);

      // 3. First (aborted) task rejects asynchronously on the next microtask -> MUST be ignored!
      searchCalls[0].reject(new Error('Aborted stale search 1'));
      await Promise.resolve();
      expect(store.fsmState()).toBe('searching');

      // 4. Second search resolves -> transitions to 'resultsReady' with second search's output!
      searchCalls[1].resolve({ results: ['Espresso Double'] });
      await Promise.resolve();
      expect(store.fsmState()).toBe('resultsReady');
      expect(store.results()).toEqual(['Espresso Double']);
    });

    it('resets after(ms) timer on explicit self-transition ["active", "ACTIVITY", "active"] while ["active", "PING", stay()] leaves timer and awaiting() task untouched', () => {
      const sessionFeature = createMachineFeature<{
        events: { ACTIVITY: void; PING: void };
        states: 'active' | 'idle';
      }>()({
        id: 'sessionTimeout',
        initial: 'active',
        transitions: [
          ['active', 'ACTIVITY',  'active'],
          ['active', 'PING',      stay()],
          ['active', after(3000), 'idle'],
        ],
      });

      const SessionStore = signalStore(withStateMachine(sessionFeature));
      const store = new SessionStore();
      expect(store.fsmState()).toBe('active');
      const initialEpoch = (store as any).stateEpoch?.() ?? 0;

      // Advance 2000ms and send PING (stay()) -> timer NOT reset
      vi.advanceTimersByTime(2000);
      store.send('PING');
      expect(store.fsmState()).toBe('active');

      // Advance 500ms (total 2500ms) and send ACTIVITY (explicit self-transition) -> timer IS reset & epoch increments!
      vi.advanceTimersByTime(500);
      store.send('ACTIVITY');
      expect(store.fsmState()).toBe('active');
      expect((store as any).stateEpoch()).toBeGreaterThan(initialEpoch);

      // Advance 1000ms (3500ms since start, 1000ms since ACTIVITY) -> still 'active'!
      vi.advanceTimersByTime(1000);
      expect(store.fsmState()).toBe('active');

      // Advance 2000ms (3000ms since ACTIVITY) -> transitions to 'idle'!
      vi.advanceTimersByTime(2000);
      expect(store.fsmState()).toBe('idle');
    });
  });

  describe('Cycle 23: First-Class syncContext Inside createMachineFeature with Synchronous t = 0 Hydration', () => {
    it('hydrates store state signals synchronously at t = 0 from syncContext defined inside createMachineFeature and syncs subsequent external signal updates', () => {
      const externalPropSig = signal<string>('initial-external-value');

      const featureWithSync = createMachineFeature<{
        events: { PING: void };
        states: 'idle';
      }>()({
        id: 'syncContextFeature',
        initial: 'idle',
        transitions: [['idle', 'PING', stay()]],
        state: {
          syncedProp: 'stale-default',
          localCount: 0,
        },
        syncContext: () => ({
          syncedProp: externalPropSig,
        }),
      });

      // Pure 1-liner signalStore(withStateMachine(feature)) (no 2nd argument)
      const MyStore = signalStore(withStateMachine(featureWithSync));
      const store = new MyStore();

      // At t = 0 (immediately upon instantiation, before any async tick or change detection),
      // both store.syncedProp() and store.fsmContext().syncedProp equal the external signal's value!
      expect(store.syncedProp()).toBe('initial-external-value');
      expect(store.fsmContext().syncedProp).toBe('initial-external-value');

      // Subsequent changes to externalPropSig automatically sync into the store's context and state signal!
      externalPropSig.set('updated-external-value');
      expect(store.syncedProp()).toBe('updated-external-value');
      expect(store.fsmContext().syncedProp).toBe('updated-external-value');
    });

    it('supports reactive selector syntax syncContext: () => ({ syncedProp: ext.prop() }) at t = 0 and on updates', async () => {
      const extProp = signal<string>('selector-initial');
      const featureWithSelector = createMachineFeature<{
        events: { PING: void };
        states: 'idle';
      }>()({
        id: 'syncSelectorFeature',
        initial: 'idle',
        transitions: [['idle', 'PING', stay()]],
        state: {
          syncedProp: 'stale-default',
        },
        syncContext: () => ({
          syncedProp: extProp(),
        }),
      });

      const MyStore = signalStore(withStateMachine(featureWithSelector));
      const store = new MyStore();

      expect(store.syncedProp()).toBe('selector-initial');
      expect(store.fsmContext().syncedProp).toBe('selector-initial');

      extProp.set('selector-updated');
      await Promise.resolve();
      expect(store.syncedProp()).toBe('selector-updated');
      expect(store.fsmContext().syncedProp).toBe('selector-updated');
    });
  });

  describe('Cycle 21: all(actorA, actorB) Output Aggregation, Immediate Child Teardown, Specific Error Exits & stay() Support', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('tears down early-finishing child immediately, supports intermediate stay() on child completion, and aggregates keyed outputs { barista, bakery } on ALL_DONE', () => {
      let baristaPostFinishTimerFired = false;

      const baristaFSM = createMachineFeature<{
        events: { EXTRA_TICK: void };
        outputs: {
          COFFEE_READY: { readonly drink: string };
          OUT_OF_BEANS: { readonly reason: string };
        };
        states: 'brewing';
      }>()({
        id: 'barista',
        initial: 'brewing',
        transitions: [
          [
            'brewing',
            after(2000),
            finalState(),
            { output: ['COFFEE_READY', () => ({ drink: 'Espresso' })] },
          ],
          ['brewing', after(3000), 'brewing', { call: (m) => m._onExtraTick }],
        ],
        methods: () => ({
          _onExtraTick: () => {
            baristaPostFinishTimerFired = true;
          },
        }),
      });

      const bakeryFSM = createMachineFeature<{
        events: { EXTRA_TICK: void };
        outputs: { PASTRY_READY: { readonly pastry: string } };
        states: 'baking';
      }>()({
        id: 'bakery',
        initial: 'baking',
        transitions: [
          [
            'baking',
            after(4000),
            finalState(),
            { output: ['PASTRY_READY', () => ({ pastry: 'Croissant' })] },
          ],
        ],
      });

      const progressLogs: string[] = [];
      let finalSavedOrder: {
        barista: { readonly drink: string };
        bakery: { readonly pastry: string };
      } | null = null;

      const shopParallelFeature = createMachineFeature<{
        events: { ORDER_COMBO: void };
        states: 'idle' | 'orderReady' | 'orderFailed';
      }>()({
        id: 'shopParallel',
        initial: 'idle',
        transitions: [
          ['idle', 'ORDER_COMBO', all(baristaFSM, bakeryFSM)],
          [
            baristaFSM,
            'COFFEE_READY',
            stay(),
            { call: (m) => m._onCoffeeProgress },
          ],
          [baristaFSM, 'OUT_OF_BEANS', 'orderFailed'],
          [
            all(baristaFSM, bakeryFSM),
            'ALL_DONE',
            'orderReady',
            { call: (m) => m._saveAll },
          ],
          [all(baristaFSM, bakeryFSM), 'ERROR', 'orderFailed'],
        ],
        methods: () => ({
          _onCoffeeProgress: (payload: { readonly drink: string }) => {
            progressLogs.push(`coffee:${payload.drink}`);
          },
          _saveAll: (payload: {
            barista: { readonly drink: string };
            bakery: { readonly pastry: string };
          }) => {
            finalSavedOrder = payload;
          },
        }),
      });

      const ShopParallelStore = signalStore(
        withStateMachine(shopParallelFeature),
      );
      const store = new ShopParallelStore();

      store.send('ORDER_COMBO');
      expect(store.fsmState()).toBe('all:barista,bakery');

      // At 2000ms: baristaFSM finishes with COFFEE_READY -> torn down immediately, progress logged via stay(), bakeryFSM still running!
      vi.advanceTimersByTime(2000);
      expect(progressLogs).toEqual(['coffee:Espresso']);
      expect(store.fsmState()).toBe('all:barista,bakery');

      // At 3000ms: baristaFSM's 3000ms timer must NOT fire because baristaFSM was torn down at 2000ms!
      vi.advanceTimersByTime(1000);
      expect(baristaPostFinishTimerFired).toBe(false);
      expect(store.fsmState()).toBe('all:barista,bakery');

      // At 4000ms: bakeryFSM finishes with PASTRY_READY -> ALL_DONE fires with { barista: { drink: 'Espresso' }, bakery: { pastry: 'Croissant' } }!
      vi.advanceTimersByTime(1000);
      expect(store.fsmState()).toBe('orderReady');
      expect(finalSavedOrder).toEqual({
        barista: { drink: 'Espresso' },
        bakery: { pastry: 'Croissant' },
      });
    });

    it('immediately transitions parent and aborts sibling children when a child in all() emits a specific error exit (e.g. [baristaFSM, "OUT_OF_BEANS", "orderFailed"])', () => {
      let bakeryFinished = false;

      const baristaFailFSM = createMachineFeature<{
        events: { FAIL: void };
        outputs: { OUT_OF_BEANS: { readonly reason: string } };
        states: 'brewing';
      }>()({
        id: 'barista',
        initial: 'brewing',
        transitions: [
          [
            'brewing',
            after(1000),
            finalState(),
            {
              call: (m) => m._setReason,
              output: ['OUT_OF_BEANS', (ctx) => ({ reason: ctx.reason })],
            },
          ],
        ],
        state: {
          reason: 'empty',
        },
        methods: () => ({
          _setReason: () => undefined,
        }),
      });

      const bakerySlowFSM = createMachineFeature<{
        events: { DONE: void };
        outputs: { PASTRY_READY: { readonly pastry: string } };
        states: 'baking';
      }>()({
        id: 'bakery',
        initial: 'baking',
        transitions: [
          [
            'baking',
            after(4000),
            finalState(),
            {
              call: (m) => m._onDone,
              output: ['PASTRY_READY', () => ({ pastry: 'Croissant' })],
            },
          ],
        ],
        methods: () => ({
          _onDone: () => {
            bakeryFinished = true;
          },
        }),
      });

      const shopFailFeature = createMachineFeature<{
        events: { ORDER_COMBO: void };
        states: 'idle' | 'orderReady' | 'orderFailed';
      }>()({
        id: 'shopFail',
        initial: 'idle',
        transitions: [
          ['idle', 'ORDER_COMBO', all(baristaFailFSM, bakerySlowFSM)],
          [baristaFailFSM, 'OUT_OF_BEANS', 'orderFailed'],
          [all(baristaFailFSM, bakerySlowFSM), 'ALL_DONE', 'orderReady'],
        ],
      });

      const ShopFailStore = signalStore(withStateMachine(shopFailFeature));
      const store = new ShopFailStore();

      store.send('ORDER_COMBO');
      expect(store.fsmState()).toBe('all:barista,bakery');

      // At 1000ms: baristaFailFSM terminates with OUT_OF_BEANS -> parent immediately transitions to 'orderFailed' and aborts bakerySlowFSM!
      vi.advanceTimersByTime(1000);
      expect(store.fsmState()).toBe('orderFailed');

      // Advance to 5000ms -> bakerySlowFSM was aborted and never finishes!
      vi.advanceTimersByTime(4000);
      expect(bakeryFinished).toBe(false);
    });
  });

  describe('Cycle 22: Recursive Sub-Actor Task Mocking (actorTasks) & DI-Free Testing in createFeatureTester', () => {
    it('executes a full nested parent -> sub-actor flow in pure Vitest without TestBed or NG0203 using actorTasks and syncedContext', async () => {
      const PROD_BARISTA_API = new InjectionToken<{
        brew: (drink: string) => Promise<{ brewedDrink: string }>;
      }>('PROD_BARISTA_API');
      const PROD_LOYALTY_API = new InjectionToken<{
        check: (points: number) => Promise<{ loyaltyPoints: number }>;
      }>('PROD_LOYALTY_API');
      const PROD_EXTERNAL_STORE = new InjectionToken<{
        policy: ReturnType<typeof signal<'strict' | 'relaxed'>>;
        disconnectSig: ReturnType<typeof signal<boolean>>;
      }>('PROD_EXTERNAL_STORE');

      const baristaChildFSM = createMachineFeature<{
        inputs: { readonly selectedDrink: string };
        events: { CANCEL: void };
        outputs: { COFFEE_READY: { readonly servedDrink: string } };
        states: 'init' | 'brewingCoffee';
      }>()({
        id: 'barista',
        initial: 'init',
        transitions: [
          ['init', always(), awaiting('brewingCoffee'), { call: (m) => m._brew }],
          [
            awaiting('brewingCoffee'),
            'DONE',
            finalState(),
            {
              output: [
                'COFFEE_READY',
                (ctx, res) => ({
                  servedDrink:
                    (res as { brewedDrink?: string } | undefined)
                      ?.brewedDrink ??
                    ctx.brewedDrink ??
                    ctx.selectedDrink,
                }),
              ],
            },
          ],
        ],
        state: {
          brewedDrink: null as string | null,
        },
        // Production factory uses Angular inject() — would throw NG0203 outside DI!
        methods: (_store, api = inject(PROD_BARISTA_API)) => ({
          _brew: (
            _payload: void,
            _signal: AbortSignal,
            ctx: Readonly<{
              selectedDrink: string;
              brewedDrink: string | null;
            }>,
          ) => api.brew(ctx.selectedDrink),
        }),
      });

      const coffeeShopParentFSM = createMachineFeature<{
        events: {
          SELECT_DRINK: { readonly name: string };
          CHECKOUT: void;
          DISCONNECT: void;
        };
        states:
          | 'idle'
          | 'drinkSelected'
          | 'checkingLoyalty'
          | 'orderReady';
      }>()({
        id: 'coffeeShopNested',
        initial: 'idle',
        transitions: [
          ['idle', 'SELECT_DRINK', 'drinkSelected', { call: (m) => m._select }],
          ['drinkSelected', 'CHECKOUT', awaiting('checkingLoyalty'), { call: (m) => m._checkLoyalty }],
          [
            'checkingLoyalty',
            'DONE',
            baristaChildFSM,
            {
              call: (m) => m._saveLoyalty,
              input: (ctx) => ({ selectedDrink: ctx.drinkName! }),
            },
          ],
          [
            baristaChildFSM,
            'COFFEE_READY',
            'orderReady',
            { call: (m) => m._onReady },
          ],
          [['idle', 'checkingLoyalty', baristaChildFSM, 'orderReady'], 'DISCONNECT', 'idle'],
        ],
        state: {
          drinkName: null as string | null,
          loyaltyPoints: 0,
          servedDrink: null as string | null,
          policy: 'relaxed' as 'strict' | 'relaxed',
        },
        // Production factories use Angular inject() — would throw NG0203 outside DI!
        syncContext: (ext = inject(PROD_EXTERNAL_STORE)) => ({
          policy: ext.policy,
        }),
        methods: (store, loyalty = inject(PROD_LOYALTY_API)) => ({
          _select: ({ name }: { readonly name: string }) =>
            patchState(store, { drinkName: name }),
          _checkLoyalty: (
            _payload: void,
            _signal: AbortSignal,
            ctx: Readonly<{
              drinkName: string | null;
              loyaltyPoints: number;
              servedDrink: string | null;
              policy: 'strict' | 'relaxed';
            }>,
          ) => loyalty.check(ctx.loyaltyPoints),
          _saveLoyalty: (res: { loyaltyPoints: number }) =>
            patchState(store, { loyaltyPoints: res.loyaltyPoints }),
          _onReady: ({ servedDrink }: { readonly servedDrink: string }) =>
            patchState(store, { servedDrink }),
        }),
      });

      // Pure Vitest execution — ZERO TestBed!
      const tester = createFeatureTester(coffeeShopParentFSM, {
        syncedContext: { policy: 'strict' },
        methods: {
          _checkLoyalty: async () => ({ loyaltyPoints: 50 }),
        },
        actorMethods: {
          barista: {
            _brew: async (
              _payload: void,
              _signal: AbortSignal,
              ctx: { selectedDrink: string },
            ) => ({
              brewedDrink: `Mocked-${ctx.selectedDrink}`,
            }),
          },
        },
      });

      expect(tester.state()).toBe('idle');
      expect(tester.context().policy).toBe('strict');

      tester.send('SELECT_DRINK', { name: 'Flat White' });
      expect(tester.state()).toBe('drinkSelected');

      tester.send('CHECKOUT');
      expect(tester.state()).toBe('checkingLoyalty');

      await tester.flushTasks();

      expect(tester.state()).toBe('orderReady');
      expect(tester.context().loyaltyPoints).toBe(50);
      expect(tester.context().servedDrink).toBe('Mocked-Flat White');
    });
  });

  describe('Cycles 26, 27, 28 & 30: always() Branching, Snapshot Persistence (getSnapshot / restoreSnapshot) & inspect Telemetry in SignalStore', () => {
    it('supports always() eventless branching and throws MatrixFsmInfiniteLoopError on cyclic always() in SignalStore', () => {
      const feature = createMachineFeature<{
        events: {
          SET_ITEMS: { readonly count: number };
          CHECK: void;
          LOOP: void;
        };
        states: 'idle' | 'checking' | 'hasItems' | 'empty' | 'loopA' | 'loopB';
      }>()({
        id: 'angularAlways',
        initial: 'idle',
        transitions: [
          ['idle',     'SET_ITEMS', stay(),     { call: (m) => m._setCount }],
          ['idle',     'CHECK',     'checking'],
          ['checking', always(),    'hasItems', { guard: (ctx) => ctx.itemCount > 0 }],
          ['checking', always(),    'empty'],
          ['empty',    'LOOP',      'loopA'],
          ['loopA',    always(),    'loopB'],
          ['loopB',    always(),    'loopA'],
        ],
        state: {
          itemCount: 0,
        },
        methods: (store) => ({
          _setCount: ({ count }: { readonly count: number }) =>
            patchState(store, { itemCount: count }),
        }),
      });

      const Store = signalStore(withStateMachine(feature));
      const store = new Store();

      store.send('CHECK');
      expect(store.state()).toBe('empty');

      expect(() => store.send('LOOP')).toThrowError(MatrixFsmInfiniteLoopError);

      store.reset();
      store.send('SET_ITEMS', { count: 3 });
      store.send('CHECK');
      expect(store.state()).toBe('hasItems');
    });

    it('captures getSnapshot() and hydrates a fresh SignalStore via restoreSnapshot(snap) while resuming awaiting() tasks and emitting inspect telemetry', async () => {
      const inspectedEvents: Array<{
        readonly machineId: string;
        readonly from: string;
        readonly via: string;
        readonly to: string;
        readonly payload: unknown;
        readonly nextContext: unknown;
      }> = [];

      const coffeeFeature = createMachineFeature<{
        events: {
          SELECT_DRINK: { readonly drink: string };
          PLACE_ORDER: void;
        };
        states: 'browsing' | 'checkingLoyalty' | 'paid' | 'ready';
      }>()({
        id: 'snapshotCoffee',
        initial: 'browsing',
        transitions: [
          ['browsing',        'SELECT_DRINK', stay(),                      { call: (m) => m._select }],
          ['browsing',        'PLACE_ORDER',  awaiting('checkingLoyalty'), { call: (m) => m._checkLoyalty }],
          ['checkingLoyalty', 'DONE',         'paid',                      { call: (m) => m._applyLoyalty }],
          ['paid',            after(200),     'ready',                     { call: (m) => m._markReady }],
        ],
        state: {
          selectedDrink: null as string | null,
          stamps: 9,
          isFree: false,
          readyBanner: null as string | null,
        },
        methods: (store) => ({
          _select: ({ drink }: { readonly drink: string }) =>
            patchState(store, { selectedDrink: drink }),
          _checkLoyalty: async (
            _payload: void,
            _signal: AbortSignal,
            ctx: Readonly<{
              selectedDrink: string | null;
              stamps: number;
              isFree: boolean;
              readyBanner: string | null;
            }>,
          ) => ({
            stamps: ctx.stamps + 1,
            isFree: ctx.stamps + 1 >= 10,
          }),
          _applyLoyalty: (res: { stamps: number; isFree: boolean }) =>
            patchState(store, res),
          _markReady: () =>
            patchState(store, {
              readyBanner: `${store.selectedDrink()} is ready!`,
            }),
        }),
      });

      expect(getShortestPaths(coffeeFeature)['ready']).toHaveLength(3);

      const Store = signalStore(
        withStateMachine(coffeeFeature, {
          inspect: (ev) => inspectedEvents.push(ev),
        }),
      );
      const store1 = new Store();

      store1.send('SELECT_DRINK', { drink: 'Cortado' });
      store1.send('PLACE_ORDER');

      // Capture snapshot right in the middle of 'checkingLoyalty'
      const midSnap = store1.getSnapshot();
      expect(midSnap.state).toBe('checkingLoyalty');
      expect(midSnap.context.selectedDrink).toBe('Cortado');

      // Hydrate a brand new store2 from midSnap!
      const store2 = new Store();
      expect(store2.state()).toBe('browsing');
      expect(store2.selectedDrink()).toBeNull();

      store2.restoreSnapshot(midSnap);
      expect(store2.state()).toBe('checkingLoyalty');
      expect(store2.selectedDrink()).toBe('Cortado');

      // Wait for the resumed awaiting('checkingLoyalty') task on store2 to resolve!
      await new Promise((r) => setTimeout(r, 20));
      expect(store2.state()).toBe('paid');
      expect(store2.stamps()).toBe(10);
      expect(store2.isFree()).toBe(true);

      expect(inspectedEvents.length).toBeGreaterThanOrEqual(3);
      expect(inspectedEvents[0]).toMatchObject({
        machineId: 'snapshotCoffee',
        from: 'browsing',
        via: 'SELECT_DRINK',
        to: 'browsing',
        payload: { drink: 'Cortado' },
      });
    });
  });

  describe('Cycle 31 (Masterplan Cycle 1): Optional Union Event Payloads & createMachineFeature Validation Without Explicit states', () => {
    it('allows calling store.send() with 0 or 1 argument when event payload is a union with void, and enforces call/input validation when states is omitted in createMachineFeature', () => {
      const childWithInput = createMachineFeature<{
        inputs: { readonly requiredToken: string };
        outputs: { DONE: { readonly ok: boolean } };
        events: { COMPLETE: void };
      }>()({
        id: 'childWithInput',
        initial: 'working',
        transitions: [
          ['working', 'COMPLETE', finalState(), { output: ['DONE', () => ({ ok: true })] }],
        ],
        state: {},
      });

      const parentFeature = createMachineFeature<{
        events: {
          OPTIONAL_NOTE: { readonly note?: string } | void;
          REQUIRED_AMOUNT: { readonly amount: number };
          GO_CHILD: void;
        };
      }>()({
        id: 'optionalUnionFeature',
        initial: 'idle',
        transitions: [
          ['idle', 'OPTIONAL_NOTE', stay(), { call: (m) => m._onOptional }],
          ['idle', 'REQUIRED_AMOUNT', stay(), { call: (m) => m._onAmount }],
          [
            'idle',
            'GO_CHILD',
            childWithInput,
            { input: () => ({ requiredToken: 'abc' }) },
          ],
          [childWithInput, 'DONE', 'idle'],
        ],
        state: {
          lastNote: null as string | null,
          total: 0,
        },
        methods: (store) => ({
          _onOptional: (payload: { readonly note?: string } | void) =>
            patchState(store, { lastNote: payload?.note ?? 'none' }),
          _onAmount: ({ amount }: { readonly amount: number }) =>
            patchState(store, { total: store.total() + amount }),
        }),
      });

      // Verify compile-time @ts-expect-error when states is omitted in createMachineFeature:
      createMachineFeature<{
        events: { GO: { readonly count: number } };
        methods: {
          _wrongMethod: (p: { readonly wrongProp: string }) => void;
        };
      }>()({
        id: 'invalidWithoutStates',
        initial: 'idle',
        transitions: [
          // @ts-expect-error Missing required input when transitioning into childWithInput
          ['idle', 'GO', childWithInput],
          [
            'idle',
            'GO',
            stay(),
            // @ts-expect-error Incompatible payload type for _wrongMethod when states is omitted
            { call: (m) => m._wrongMethod },
          ],
          [childWithInput, 'DONE', 'idle'],
        ],
        state: {},
        methods: () => ({
          _wrongMethod: (_p: { readonly wrongProp: string }) => undefined,
        }),
      });

      const Store = signalStore(withStateMachine(parentFeature));
      const store = new Store();

      // 0-arg call on union with void:
      store.send('OPTIONAL_NOTE');
      expect(store.lastNote()).toBe('none');

      // 1-arg call on union with void:
      store.send('OPTIONAL_NOTE', { note: 'extra hot' });
      expect(store.lastNote()).toBe('extra hot');

      store.send('REQUIRED_AMOUNT', { amount: 42 });
      expect(store.total()).toBe(42);
    });
  });

  describe('Cycle 33 (Masterplan Cycle 3): Empty Array [] Synchronous FIFO ALL_DONE Dispatch in each()', () => {
    it('synchronously dispatches ALL_DONE with [] in the same send() call when entering each() with an empty array in SignalStore and createFeatureTester', () => {
      const itemFeature = createMachineFeature<{
        inputs: {
          readonly drink: { readonly id: string; readonly name: string };
        };
        outputs: {
          COFFEE_READY: { readonly drinkName: string };
        };
        events: { FINISH: void };
      }>()({
        id: 'itemFeature',
        initial: 'brewing',
        transitions: [
          [
            'brewing',
            'FINISH',
            finalState(),
            { output: ['COFFEE_READY', (ctx) => ({ drinkName: ctx.drink.name })] },
          ],
        ],
        state: {},
      });

      const batchFeature = createMachineFeature<{
        events: { START_BATCH: void };
      }>()({
        id: 'emptyEachBatch',
        initial: 'idle',
        transitions: [
          ['idle', 'START_BATCH', each('drinks', itemFeature)],
          [
            each('drinks', itemFeature),
            'ALL_DONE',
            'orderReady',
            { call: (m) => m._saveAll },
          ],
        ],
        state: {
          drinks: [] as Array<{ readonly id: string; readonly name: string }>,
          completedCups: null as ReadonlyArray<{ readonly drinkName: string }> | null,
        },
        methods: (store) => ({
          _saveAll: (cups: ReadonlyArray<{ readonly drinkName: string }>) =>
            patchState(store, { completedCups: cups }),
        }),
      });

      const Store = signalStore(withStateMachine(batchFeature));
      const store = new Store();

      store.send('START_BATCH');
      // Must transition synchronously in 0 ticks with []!
      expect(store.state()).toBe('orderReady');
      expect(store.completedCups()).toEqual([]);

      const tester = createFeatureTester(batchFeature);
      tester.send('START_BATCH');
      expect(tester.state()).toBe('orderReady');
      expect(tester.context().completedCups).toEqual([]);
    });
  });

  describe('Cycle 34 (Masterplan Cycle 4): Recursive restoreSnapshot() for Combinators & Actor-Keyed Combinator Inputs in SignalStore', () => {
    it('unwraps actor-keyed combinator inputs in SignalStore, exposes store.actors for combinator children, and recursively restores combinator child snapshots', () => {
      const baristaFeature = createMachineFeature<{
        inputs: { readonly drink: string };
        outputs: { COFFEE_READY: { readonly cup: string } };
        events: { GRIND_DONE: void; BREW_DONE: void };
      }>()({
        id: 'barista',
        initial: 'grinding',
        transitions: [
          ['grinding', 'GRIND_DONE', 'brewing', { call: (m) => m._onGround }],
          [
            'brewing',
            'BREW_DONE',
            finalState(),
            { output: ['COFFEE_READY', (ctx) => ({ cup: `Hot ${ctx.drink}` })] },
          ],
        ],
        state: {
          ground: false,
        },
        methods: (store) => ({
          _onGround: () => patchState(store, { ground: true }),
        }),
      });

      const bakeryFeature = createMachineFeature<{
        inputs: { readonly pastry: string };
        outputs: { BAKERY_READY: { readonly item: string } };
        events: { BAKE_DONE: void };
      }>()({
        id: 'bakery',
        initial: 'baking',
        transitions: [
          [
            'baking',
            'BAKE_DONE',
            finalState(),
            { output: ['BAKERY_READY', (ctx) => ({ item: `Warm ${ctx.pastry}` })] },
          ],
        ],
        state: {},
      });

      const orderFeature = createMachineFeature<{
        events: {
          START: void;
          GRIND_DONE: void;
          BREW_DONE: void;
          BAKE_DONE: void;
        };
      }>()({
        id: 'orderCombinatorFeature',
        initial: 'idle',
        transitions: [
          [
            'idle',
            'START',
            all(baristaFeature, bakeryFeature),
            {
              input: () => ({
                barista: { drink: 'Flat White' },
                bakery: { pastry: 'Pain au Chocolat' },
              }),
            },
          ],
          [
            all(baristaFeature, bakeryFeature),
            'ALL_DONE',
            'completed',
            { call: (m) => m._onAllDone },
          ],
        ],
        state: {
          summary: null as {
            readonly barista: { readonly cup: string };
            readonly bakery: { readonly item: string };
          } | null,
        },
        methods: (store) => ({
          _onAllDone: (res: {
            readonly barista: { readonly cup: string };
            readonly bakery: { readonly item: string };
          }) => patchState(store, { summary: res }),
        }),
      });

      const OrderStore = signalStore(withStateMachine(orderFeature));
      const store1 = new OrderStore();

      store1.send('START');
      expect(store1.state()).toBe('all:barista,bakery');
      expect(store1.actors.barista()?.drink).toBe('Flat White');
      expect(store1.actors.bakery()?.pastry).toBe('Pain au Chocolat');

      // Advance barista to 'brewing'
      store1.send('GRIND_DONE');
      expect(store1.actors.barista()?.ground).toBe(true);

      const snap = store1.getSnapshot();
      expect(snap.children?.['barista']?.state).toBe('brewing');
      expect(snap.children?.['bakery']?.state).toBe('baking');

      // Restore into a brand new store2
      const store2 = new OrderStore();
      store2.restoreSnapshot(snap);

      expect(store2.state()).toBe('all:barista,bakery');
      expect(store2.actors.barista()?.drink).toBe('Flat White');
      expect(store2.actors.barista()?.ground).toBe(true);
      expect(store2.getSnapshot().children?.['barista']?.state).toBe('brewing');

      // Complete both children on store2
      store2.send('BREW_DONE');
      store2.send('BAKE_DONE');

      expect(store2.state()).toBe('completed');
      expect(store2.summary()).toEqual({
        barista: { cup: 'Hot Flat White' },
        bakery: { item: 'Warm Pain au Chocolat' },
      });
    });
  });

  describe('Cycle 36 (Masterplan Cycle 6): Zoneless-Reactive store.can(event, payload?), tester.can() & Synchronous Sub-Actor store.actors Live Sync', () => {
    it('reactively tracks store state and context signals inside computed(() => store.can(...)), supports tester.can(), and immediately reflects synchronous sub-actor stay() call mutations in store.actors', () => {
      const baristaActor = createMachineFeature<{
        inputs: { readonly drink: string };
        events: { ADD_SHOT: void; FINISH: void };
        outputs: { COFFEE_READY: { readonly shots: number } };
      }>()({
        id: 'barista',
        initial: 'brewing',
        transitions: [
          ['brewing', 'ADD_SHOT', stay(), { call: (m) => m._addShot }],
          [
            'brewing',
            'FINISH',
            finalState(),
            {
              guard: (ctx) => ctx.shots >= 1,
              output: ['COFFEE_READY', (ctx) => ({ shots: ctx.shots })],
            },
          ],
        ],
        state: {
          shots: 1,
        },
        methods: (store) => ({
          _addShot: () => patchState(store, { shots: store.shots() + 1 }),
        }),
      });

      const shopFeature = createMachineFeature<{
        events: {
          PAY: void;
          ADD_SHOT: void;
          FINISH: void;
        };
      }>()({
        id: 'reactiveCanShop',
        initial: 'browsing',
        transitions: [
          [
            'browsing',
            'PAY',
            baristaActor,
            {
              guard: (ctx) => ctx.balance >= 10,
              input: () => ({ drink: 'Espresso' }),
            },
          ],
          [baristaActor, 'COFFEE_READY', 'done'],
        ],
        state: {
          balance: 5,
        },
      });

      const ShopStore = signalStore(withStateMachine(shopFeature));
      const store = new ShopStore();

      // Zoneless computed() signal tracking store.can('PAY'):
      const canPay = computed(() => store.can('PAY'));
      expect(canPay()).toBe(false);

      // Mutate store balance without changing fsmState -> canPay() recomputes reactively!
      store.patchContext({ balance: 15 });
      expect(canPay()).toBe(true);

      // Transition into baristaActor and verify synchronous stay() call mutation in store.actors.barista()
      store.send('PAY');
      expect(store.state()).toBe('barista');
      expect(store.can('PAY')).toBe(false);
      expect(store.can('ADD_SHOT')).toBe(true);
      expect(store.actors.barista()?.shots).toBe(1);

      store.send('ADD_SHOT');
      expect(store.actors.barista()?.shots).toBe(2);

      // Verify tester.can() on createFeatureTester
      const tester = createFeatureTester(shopFeature);
      expect(tester.can('PAY')).toBe(false);
      tester.patchContext({ balance: 20 });
      expect(tester.can('PAY')).toBe(true);
    });
  });

  describe('Cycle 51: Fix store.can() Returning true on Pure No-Op stay() Fallbacks', () => {
    it('returns false on store.can() and tester.can() when falling through to an unguarded pure no-op stay() fallback row, and true when stay() has a call or output', () => {
      const cascadeFeature = createMachineFeature<{
        events: {
          SELECT_COUNTRY: string;
          SELECT_CITY: string;
          SELECT_PLACE: string;
        };
        states: 'idle' | 'loadingPlaces' | 'ready';
      }>()({
        id: 'cascadeDropdown',
        initial: 'idle',
        transitions: [
          ['idle', 'SELECT_COUNTRY', stay(), { call: (m) => m._setCountry }],
          [
            'idle',
            'SELECT_CITY',
            awaiting('loadingPlaces'),
            {
              guard: (ctx) => ctx.country !== null,
              call: (m) => m._loadPlaces,
            },
          ],
          ['idle', 'SELECT_CITY', stay()], // Pure No-Op fallback for ESLint
          ['idle', 'SELECT_PLACE', stay(), { call: (m) => m._setPlace }],
          ['loadingPlaces', 'DONE', 'ready'],
          ['loadingPlaces', 'ERROR', 'idle'],
        ],
        state: {
          country: null as string | null,
          place: null as string | null,
        },
        methods: (store) => ({
          _setCountry: (country: string) => patchState(store, { country }),
          _setPlace: (place: string) => patchState(store, { place }),
          _loadPlaces: async () => Promise.resolve(),
        }),
      });

      const CascadeStore = signalStore(withStateMachine(cascadeFeature));
      const store = new CascadeStore();

      const canSelectCity = computed(() => store.can('SELECT_CITY', 'Munich'));
      expect(canSelectCity()).toBe(false);
      expect(store.can('SELECT_PLACE', 'Marienplatz')).toBe(true);

      store.send('SELECT_COUNTRY', 'DE');
      expect(canSelectCity()).toBe(true);
    });
  });

  describe('Cycle 53: every(ms) Recurring Intervals in Angular SignalStore', () => {
    it('executes recurring every((c) => c.ms) intervals in SignalStore, dynamically adapts interval speed on stay() mutations, and stops on state exit', () => {
      vi.useFakeTimers();
      try {
        const tickerFeature = createMachineFeature<{
          events: {
            START: void;
            SET_SPEED: number;
            PAUSE: void;
          };
          states: 'stopped' | 'ticking';
        }>()({
          id: 'angularTicker',
          initial: 'stopped',
          transitions: [
            ['stopped', 'START', 'ticking'],
            ['ticking', every((c) => c.ms), stay(), { call: (m) => m._tick }],
            ['ticking', 'SET_SPEED', stay(), { call: (m) => m._setSpeed }],
            ['ticking', 'PAUSE', 'stopped'],
          ],
          state: {
            ms: 1000,
            ticks: 0,
          },
          methods: (store) => ({
            _tick: () => patchState(store, { ticks: store.ticks() + 1 }),
            _setSpeed: (ms: number) => patchState(store, { ms }),
          }),
        });

        const TickerStore = signalStore(withStateMachine(tickerFeature));
        const store = new TickerStore();

        store.send('START');
        expect(store.state()).toBe('ticking');

        vi.advanceTimersByTime(3000);
        expect(store.ticks()).toBe(3);

        store.send('SET_SPEED', 200);
        vi.advanceTimersByTime(1000);
        expect(store.ticks()).toBe(8);

        store.send('PAUSE');
        expect(store.state()).toBe('stopped');
        vi.advanceTimersByTime(2000);
        expect(store.ticks()).toBe(8);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Cycle 54: Remove whenSignal and on: Configuration Overhead', () => {
    it('does not export whenSignal from @matrix-fsm/angular and relies on explicit store.send() and syncContext', () => {
      expect('whenSignal' in AngularPkg).toBe(false);
    });
  });

  describe('Cycle 55: Unify tasks and methods — awaiting("state") Invokes { call: (m) => m._method }', () => {
    it('executes createMachineFeature without a tasks block, passing (payload, signal, ctx) to { call } on awaiting() and delivering the resolved value as the typed DONE payload', async () => {
      expect('withMachineTasks' in AngularPkg).toBe(false);

      let capturedCountry: string | null = null;
      let capturedSignal: AbortSignal | null = null;

      const citiesFeature = createMachineFeature<{
        events: {
          LOAD: string;
          CANCEL: void;
        };
        states: 'idle' | 'loading' | 'ready' | 'error';
      }>()({
        id: 'citiesFeature',
        initial: 'idle',
        transitions: [
          ['idle', 'LOAD', awaiting('loading'), { call: (m) => m._fetchCities }],
          ['loading', 'CANCEL', 'idle'],
          ['loading', 'DONE', 'ready', { call: (m) => m._setCities }],
          ['loading', 'ERROR', 'error', { call: (m) => m._setError }],
        ],
        state: {
          cities: [] as string[],
          error: null as string | null,
        },
        methods: (store) => ({
          _fetchCities: async (countryId: string, signal: AbortSignal) => {
            capturedCountry = countryId;
            capturedSignal = signal;
            return [`${countryId}-Capital`, `${countryId}-Port`];
          },
          _setCities: (cities: string[]) => patchState(store, { cities }),
          _setError: (err: unknown) => patchState(store, { error: String(err) }),
        }),
      });

      const CitiesStore = signalStore(withStateMachine(citiesFeature));
      const store = new CitiesStore();

      store.send('LOAD', 'DE');
      expect(store.state()).toBe('loading');
      expect(capturedCountry).toBe('DE');
      expect(capturedSignal).toBeInstanceOf(AbortSignal);

      await new Promise((r) => setTimeout(r, 0));
      expect(store.state()).toBe('ready');
      expect(store.cities()).toEqual(['DE-Capital', 'DE-Port']);
    });
  });

  describe('Cycle 56: Named Domain Outcomes via outcome(eventName, payload?) in Angular SignalStore', () => {
    it('supports outcome(eventName, payload?) returned from an awaiting() method in createMachineFeature', async () => {
      const outcomeFn = (AngularPkg as any).outcome as <
        const E extends string,
        P = void,
      >(
        event: E,
        payload?: P,
      ) => any;
      expect(typeof outcomeFn).toBe('function');

      const paymentFeature = createMachineFeature<{
        events: { PAY: number };
        states: 'checkout' | 'verifying' | 'paid' | 'challenge3ds' | 'paymentFailed';
      }>()({
        id: 'angularPaymentOutcome',
        initial: 'checkout',
        transitions: [
          ['checkout', 'PAY', awaiting('verifying'), { call: (m) => m._verifyPayment }],
          ['verifying', 'APPROVED', 'paid', { call: (m) => m._onApproved }],
          ['verifying', 'REQUIRES_3DS', 'challenge3ds', { call: (m) => m._on3ds }],
          ['verifying', 'ERROR', 'paymentFailed'],
        ],
        state: {
          challengeUrl: null as string | null,
          receiptId: null as string | null,
        },
        methods: (store) => ({
          _verifyPayment: async (amount: number) => {
            if (amount > 100) {
              return outcomeFn('REQUIRES_3DS', {
                challengeUrl: 'https://bank.test/3ds',
              });
            }
            return outcomeFn('APPROVED', { receiptId: 'OK-1' });
          },
          _onApproved: ({ receiptId }: { receiptId: string }) =>
            patchState(store, { receiptId }),
          _on3ds: ({ challengeUrl }: { challengeUrl: string }) =>
            patchState(store, { challengeUrl }),
        }),
      });

      const PaymentStore = signalStore(withStateMachine(paymentFeature));
      const store = new PaymentStore();

      store.send('PAY', 250);
      await new Promise((r) => setTimeout(r, 0));
      expect(store.state()).toBe('challenge3ds');
      expect(store.challengeUrl()).toBe('https://bank.test/3ds');
    });
  });

  describe('Cycle 57: Native Support for Observable<T> and Angular ResourceRef<T> in createMachineFeature', () => {
    it('resolves on the first emission of an Observable<T> (take(1) semantics) and immediately unsubscribes on state exit', () => {
      let unsubscribeCount = 0;
      let emitNext: ((cities: string[]) => void) | null = null;

      const citiesObservableFeature = createMachineFeature<{
        events: {
          SELECT_COUNTRY: string;
          CANCEL: void;
        };
        states: 'idle' | 'loadingCities' | 'ready' | 'error';
      }>()({
        id: 'citiesObservable',
        initial: 'idle',
        transitions: [
          ['idle', 'SELECT_COUNTRY', awaiting('loadingCities'), { call: (m) => m._loadCities }],
          ['loadingCities', 'SELECT_COUNTRY', awaiting('loadingCities'), { call: (m) => m._loadCities }],
          ['loadingCities', 'CANCEL', 'idle'],
          ['loadingCities', 'DONE', 'ready', { call: (m) => m._setCities }],
          ['loadingCities', 'ERROR', 'error'],
        ],
        state: {
          cities: [] as string[],
        },
        methods: (store) => ({
          _loadCities: (_country: string): Subscribable<string[]> => ({
            subscribe(observer) {
              emitNext = (val) => observer?.next?.(val);
              return {
                unsubscribe() {
                  unsubscribeCount++;
                },
              };
            },
          }),
          _setCities: (cities: string[]) => patchState(store, { cities }),
        }),
      });

      const Store = signalStore(withStateMachine(citiesObservableFeature));
      const store = new Store();

      store.send('SELECT_COUNTRY', 'AT');
      expect(store.state()).toBe('loadingCities');
      expect(unsubscribeCount).toBe(0);

      // Re-entering loadingCities with a new country must immediately unsubscribe the previous Observable!
      store.send('SELECT_COUNTRY', 'CH');
      expect(unsubscribeCount).toBe(1);

      // Emitting a single value (without calling complete!) resolves via take(1) semantics and unsubscribes!
      emitNext!(['Zurich', 'Geneva']);
      expect(store.state()).toBe('ready');
      expect(store.cities()).toEqual(['Zurich', 'Geneva']);
      expect(unsubscribeCount).toBe(2);
    });

    it('natively supports Angular ResourceRef<T> in awaiting() and dispatches DONE on resolved and ERROR on error', async () => {
      const resourceStatus = signal<'idle' | 'loading' | 'resolved' | 'error'>('idle');
      const resourceValue = signal<string[]>(['Berlin', 'Munich']);
      const resourceError = signal<unknown>(undefined);
      let reloadCalls = 0;

      const mockResourceRef = {
        status: resourceStatus.asReadonly(),
        value: resourceValue.asReadonly(),
        error: resourceError.asReadonly(),
        reload: () => {
          reloadCalls++;
          resourceStatus.set('loading');
          return true;
        },
      };

      const resourceFeature = createMachineFeature<{
        events: { LOAD: void };
        states: 'idle' | 'loading' | 'ready' | 'failed';
      }>()({
        id: 'resourceFeature',
        initial: 'idle',
        transitions: [
          ['idle', 'LOAD', awaiting('loading'), { call: (m) => m._loadResource }],
          ['loading', 'DONE', 'ready', { call: (m) => m._saveCities }],
          ['loading', 'ERROR', 'failed', { call: (m) => m._saveError }],
        ],
        state: {
          cities: [] as string[],
          errorMessage: null as string | null,
        },
        methods: (store) => ({
          _loadResource: () => mockResourceRef,
          _saveCities: (cities: string[]) => patchState(store, { cities }),
          _saveError: (err: unknown) => patchState(store, { errorMessage: String(err) }),
        }),
      });

      const Store = signalStore(withStateMachine(resourceFeature));
      const store = new Store();

      store.send('LOAD');
      expect(store.state()).toBe('loading');
      expect(reloadCalls).toBe(1);

      resourceStatus.set('resolved');
      await new Promise((r) => setTimeout(r, 0));
      expect(store.state()).toBe('ready');
      expect(store.cities()).toEqual(['Berlin', 'Munich']);

      // Test error status
      store.reset();
      store.send('LOAD');
      expect(store.state()).toBe('loading');
      resourceError.set(new Error('HTTP 503'));
      resourceStatus.set('error');
      await new Promise((r) => setTimeout(r, 0));
      expect(store.state()).toBe('failed');
      expect(store.errorMessage()).toContain('HTTP 503');
    });
  });

  describe('Cycle 58: Clean Separation of createMachineFeature and createEffectMachineFeature', () => {
    it('executes Effect.Effect<A, E> in createEffectMachineFeature via Effect.runFork and interrupts the fiber on state exit', async () => {
      const createEffectMachineFeature = (EffectPkg as any).createEffectMachineFeature;
      expect(typeof createEffectMachineFeature).toBe('function');
      expect('registerTaskAdapter' in AngularPkg).toBe(false);
      expect('effectTaskAdapter' in EffectPkg).toBe(false);

      let fiberInterrupted = false;

      class LoyaltyError extends Data.TaggedError('LoyaltyError')<{
        readonly reason: string;
      }> {}

      const loyaltyFeature = createEffectMachineFeature<{
        events: {
          CHECK: string;
          CANCEL: void;
        };
        states: 'idle' | 'checking' | 'verified' | 'failed';
      }>()({
        id: 'loyaltyEffect',
        initial: 'idle',
        transitions: [
          ['idle', 'CHECK', awaiting('checking'), { call: (m) => m._checkLoyalty }],
          ['checking', 'CANCEL', 'idle'],
          ['checking', 'DONE', 'verified', { call: (m) => m._savePoints }],
          ['checking', 'ERROR', 'failed', { call: (m) => m._saveError }],
        ],
        state: {
          points: 0,
          errorReason: null as string | null,
        },
        methods: (store) => ({
          _checkLoyalty: (memberId: string) =>
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  if (memberId === 'SLOW') {
                    fiberInterrupted = true;
                  }
                }),
              );
              if (memberId === 'SLOW') {
                yield* Effect.sleep('500 millis');
                return { points: 999 };
              }
              if (memberId === 'BAD') {
                return yield* Effect.fail(new LoyaltyError({ reason: 'Card expired' }));
              }
              return { points: 420 };
            }).pipe(Effect.scoped),
          _savePoints: (res: { points: number }) =>
            patchState(store, { points: res.points }),
          _saveError: (err: LoyaltyError) =>
            patchState(store, { errorReason: err.reason }),
        }),
      });

      const Store = signalStore(withStateMachine(loyaltyFeature));
      const store = new Store();

      // 1. Test interruption on state exit
      store.send('CHECK', 'SLOW');
      expect(store.state()).toBe('checking');
      store.send('CANCEL');
      expect(store.state()).toBe('idle');
      await new Promise((r) => setTimeout(r, 10));
      expect(fiberInterrupted).toBe(true);

      // 2. Test typed success (A -> DONE)
      store.send('CHECK', 'VIP');
      await new Promise((r) => setTimeout(r, 10));
      expect(store.state()).toBe('verified');
      expect(store.points()).toBe(420);

      // 3. Test typed failure (E -> ERROR)
      store.reset();
      store.send('CHECK', 'BAD');
      await new Promise((r) => setTimeout(r, 10));
      expect(store.state()).toBe('failed');
      expect(store.errorReason()).toBe('Card expired');
    });
  });
});
