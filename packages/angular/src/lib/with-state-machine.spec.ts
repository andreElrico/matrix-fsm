import { inject, InjectionToken, signal } from '@angular/core';
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
  finalState,
  getShortestPaths,
  MatrixFsmInfiniteLoopError,
  provideStateMachine,
  race,
  stay,
  whenSignal,
  withMachineTasks,
  withStateMachine,
  type Subscribable,
} from '../index.js';
import { effectTaskAdapter } from '../effect/index.js';

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
const shouldShowPromo = (ctx: AuthContext) =>
  ctx.user !== null && ctx.policy.showUpsellAds;

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
    ['loginView',         'LOGIN',                awaiting('authenticating'),  { guard: hasValidInput }],
    ['loginView',         'LOGIN',                stay(),                      { call: (m) => m._setInvalidEmail }],
    ['authenticating',    'CANCEL',               'loginView'],
    ['authenticating',    'DONE',                 'proUpsellPromo',            { guard: shouldShowPromo }],
    ['authenticating',    'DONE',                 'loggedIn'],
    ['authenticating',    'NetworkTimeoutError',  'offlineRetryView'],
    ['authenticating',    'ERROR',                'loginView',                 { call: (m) => m._setError }],
    ['proUpsellPromo',    'DISMISS_PROMO',        'loggedIn'],
  ],
});

describe('@matrix-fsm/angular - withStateMachine', () => {
  it('aligns with SignalStore withState & withMethods (call), syncContext, and patches state BEFORE DONE guards', async () => {
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
        tasks: () => ({
          authenticating: async (ctx) => ({
            user: {
              id: 'u1',
              email: ctx.credentials.email,
            },
            error: null,
          }),
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

    // Notice shouldShowPromo checks `ctx.user !== null && ctx.policy.showUpsellAds`!
    // Task output `{ user }` is patched into SignalStore state BEFORE 'DONE' guards evaluate!
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

  it('supports RxJS Observable / Subscribable tasks natively and unsubscribes on state exit', async () => {
    let unsubscribed = false;

    const createSlowObservable = (): Subscribable<Partial<AuthContext>> => ({
      subscribe(observer) {
        const timer = setTimeout(() => {
          observer?.next?.({
            user: { id: 'rx-1', email: 'rxjs@matrix.dev' },
            error: null,
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
          _setError: (err) => patchState(store, { error: err.message }),
        }),
      ),
      withStateMachine(authFSM, {
        tasks: () => ({
          authenticating: () => createSlowObservable(),
        }),
      }),
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

    const AuthStore = signalStore(
      withState<AuthContext>(initialAuthState),
      withMethods(
        (store): AuthMethods => ({
          _setEmail: ({ email }) =>
            patchState(store, {
              credentials: { ...store.credentials(), email },
              error: null,
            }),
          _setInvalidEmail: () => patchState(store, { error: 'Invalid email' }),
          _setError: (err) => patchState(store, { error: err.message }),
        }),
      ),
      withStateMachine(authFSM, {
        taskAdapter: effectTaskAdapter,
        tasks: () => ({
          authenticating: () =>
            failMode === 'tagged'
              ? Effect.fail(
                  new NetworkTimeoutError({ message: 'Gateway timeout' }),
                )
              : Effect.fail(new Error('Invalid credentials')),
        }),
      }),
    );

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

    const AuthStore = signalStore(
      withState<AuthContext>(initialAuthState),
      withMethods(
        (store): AuthMethods => ({
          _setEmail: ({ email }) =>
            patchState(store, {
              credentials: { ...store.credentials(), email },
              error: null,
            }),
          _setInvalidEmail: () => patchState(store, { error: 'Invalid email' }),
          _setError: (err) => patchState(store, { error: err.message }),
        }),
      ),
      withStateMachine(authFSM, {
        taskAdapter: effectTaskAdapter,
        tasks: () => ({
          authenticating: (_ctx, abortSignal) => {
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
        }),
      }),
    );

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

  it('supports zero-leakage sub-machine stores (BaristaStore), explicit input/output contracts, and composable withMachineTasks', async () => {
    interface SubCtx {
      selectedDrink: string | null;
      brewed: boolean;
      error: string | null;
    }
    type SubMethods = {
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
        ['ticketQueued',  'START_BREWING', awaiting('brewingCoffee')],
        ['brewingCoffee', 'DONE',          finalState('COFFEE_READY')],
        ['brewingCoffee', 'ERROR',         'maintenance',             { call: (m) => m._setBrewError }],
      ],
    });

    interface ShopCtx {
      drinkOrder: string;
      paid: boolean;
      cupReady: boolean;
    }
    type ShopMethods = {
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
        ['browsing',        'ORDER',        awaiting('checkingLoyalty')],
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
          _setBrewError: (err) => patchState(store, { error: err.message }),
        }),
        tasks: () => ({
          brewingCoffee: async (ctx) => ({
            brewed: ctx.selectedDrink === 'Flat White',
          }),
        }),
      }),
    );
    expect(BaristaStore).toBeDefined();

    // 1. Omitting parent's OWN task (`checkingLoyalty`), OWN method (`_markPaid`), or child's OWN method (`_setBrewError`) triggers a compile error:
    if (false as boolean) {
      signalStore(
        withState<ShopCtx>({ drinkOrder: 'Flat White', paid: false, cupReady: false }),
        withMethods((): ShopMethods => ({
          _markPaid: () => undefined,
          _onCupReady: () => undefined,
        })),
        withStateMachine(shopFSM, {
          // @ts-expect-error - Own awaiting state 'checkingLoyalty' is missing in tasks
          tasks: () => ({}),
        }),
      );

      // @ts-expect-error - Own method '_onCupReady' is missing in store methods
      signalStore(
        withState<ShopCtx>({ drinkOrder: 'Flat White', paid: false, cupReady: false }),
        withMethods(() => ({
          _markPaid: () => undefined,
        })),
        withStateMachine(shopFSM, {
          tasks: () => ({
            checkingLoyalty: async () => ({ paid: false }),
          }),
        }),
      );

      // @ts-expect-error - '_setBrewError' is omitted from both withMethods and config.methods
      signalStore(
        withState<SubCtx>({
          selectedDrink: null,
          brewed: false,
          error: null,
        }),
        withStateMachine(subBarista, {
          tasks: () => ({
            brewingCoffee: async () => ({ brewed: true }),
          }),
        }),
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

      // @ts-expect-error - '_setBrewError' is missing when tasks are empty and config is omitted
      signalStore(
        withState({ error: null as string | null }),
        withStateMachine(syncOnlyWithMethodFSM),
      );
    }

    // 2. Zero-Leakage Parent Store: ZERO Barista state, ZERO Barista methods, ZERO Barista tasks!
    const ZeroLeakageShopStore = signalStore(
      withState<ShopCtx>({ drinkOrder: 'Flat White', paid: false, cupReady: false }),
      withMethods((store): ShopMethods => ({
        _markPaid: () => patchState(store, { paid: true }),
        _onCupReady: (output) => patchState(store, { cupReady: output.brewed }),
      })),
      withStateMachine(shopFSM, {
        tasks: {
          checkingLoyalty: () => undefined,
        },
      }),
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

    // 3. Also supports composable `withMachineTasks(subBarista)` on a combined store:
    const ComposedStore = signalStore(
      withState<ShopCtx & SubCtx>({
        drinkOrder: 'Espresso',
        paid: false,
        cupReady: false,
        selectedDrink: null,
        brewed: false,
        error: null,
      }),
      withMethods((store): ShopMethods & SubMethods => ({
        _markPaid: () => patchState(store, { paid: true }),
        _onCupReady: (output) => patchState(store, { cupReady: output.brewed }),
        _setBrewError: () => undefined,
      })),
      withMachineTasks(subBarista, {
        brewingCoffee: () => ({ brewed: true }),
      }),
      withStateMachine(shopFSM, {
        tasks: {
          checkingLoyalty: () => undefined,
        },
      }),
    );
    const composed = new ComposedStore();
    composed.send('ORDER');
    expect(composed.fsmState()).toBe('awaitingPayment');
    composed.send('PAY');
    expect(composed.fsmState()).toBe('barista');
    composed.send('START_BREWING');
    expect(composed.brewed()).toBe(true);
    expect(composed.fsmState()).toBe('ready');
  });

  it('executes async awaiting() tasks and nested sub-machines inside 1:N each() pools and aborts all on parent interrupt', async () => {
    let abortedCount = 0;

    const orderItemFSM = createFSM<{
      events: { BREW: void };
      states: 'queued' | 'brewingItem';
      context: { id: string; drink: string; done: boolean };
    }>()({
      id: 'orderItem',
      initial: 'queued',
      transitions: [
        ['queued',      'BREW',  awaiting('brewingItem')],
        ['brewingItem', 'DONE',  finalState('ORDER_READY')],
        ['brewingItem', 'ERROR', 'queued'],
      ],
    });

    provideStateMachine(orderItemFSM, {
      state: { id: '', drink: '', done: false },
      tasks: {
        brewingItem: (_ctx, signal) =>
          new Promise((resolve) => {
            const timer = setTimeout(() => resolve({ done: true }), 25);
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              abortedCount++;
            });
          }),
      },
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
    }>()({
      id: 'baristaInterruptTest',
      initial: 'ticketQueued',
      transitions: [
        ['ticketQueued',  'START_BREWING', awaiting('brewingCoffee')],
        ['brewingCoffee', 'DONE',          finalState('COFFEE_READY')],
        ['brewingCoffee', 'ERROR',         'ticketQueued'],
      ],
    });

    provideStateMachine(childBaristaFSM, {
      state: { brewed: false },
      tasks: {
        brewingCoffee: (_ctx, abortSignal) =>
          new Promise((resolve) => {
            const timer = setTimeout(() => resolve({ brewed: true }), 100);
            abortSignal.addEventListener('abort', () => {
              clearTimeout(timer);
              subAborted = true;
            });
          }),
      },
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
        ['ticketQueued',   'START_BREWING',      awaiting('brewingCoffee')],
        ['brewingCoffee',  'TICK_PROGRESS',      stay(),                    { call: (m) => m._setProgress, output: ['BREW_PROGRESS', (ctx) => ({ percent: ctx.progressPercent })] }],
        ['brewingCoffee',  'EMERGENCY_OVERHEAT', stay(),                    { output: 'OVERHEAT_ALERT' }],
        ['brewingCoffee',  'DONE',               finalState(),              { output: ['COFFEE_READY', (ctx) => ({ drinkName: ctx.selectedDrink.name, temperatureCelsius: ctx.temperatureCelsius! })] }],
        ['brewingCoffee',  'ERROR',              'maintenance',             { call: (m) => m._setBrewError }],
        ['maintenance',    'RETRY_BREW',         awaiting('brewingCoffee')],
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
      }),
      tasks: () => ({
        brewingCoffee: (ctx, signal) =>
          new Promise((resolve, reject) => {
            if (ctx.simulateBrewError) {
              reject(new Error('Boiler pressure low'));
              return;
            }
            const timer = setTimeout(
              () => resolve({ temperatureCelsius: 67, brewError: null }),
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
        ['ticketQueued',  'START_BREWING', awaiting('brewingCoffee')],
        ['brewingCoffee', 'DONE',          finalState(),              { output: ['COFFEE_READY', (ctx) => ({ drinkName: ctx.drink.name, result: ctx.baristaResult! })] }],
        ['brewingCoffee', 'ERROR',         'maintenance'],
      ],
      state: {
        baristaResult: null as {
          readonly drinkName: string;
          readonly brewedAt: number;
        } | null,
        error: null as string | null,
      },
      tasks: (
        api = (() => {
          throw new Error(
            'Angular DI inject() must not be called in createFeatureTester!',
          );
        })(),
      ) => ({
        brewingCoffee: async () => api,
      }),
    });

    const tester = createFeatureTester(baristaFSM, {
      inputs: { drink: { id: 'espresso', name: 'Espresso', price: 3 } },
      tasks: {
        brewingCoffee: async (ctx) => ({
          baristaResult: { drinkName: ctx.drink.name, brewedAt: 12345 },
          error: null,
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
        ['ticketQueued',  'START_BREWING', awaiting('brewingCoffee')],
        ['brewingCoffee', 'DONE',          finalState(),              { output: ['COFFEE_READY', (ctx) => ({ drinkId: ctx.drink.id, drinkName: ctx.drink.name })] }],
        ['brewingCoffee', 'ERROR',         'maintenance'],
      ],
      state: {
        brewed: false,
      },
      tasks: () => ({
        brewingCoffee: (ctx, abortSignal) =>
          new Promise((resolve) => {
            resolvers.set(ctx.drink.id, () => resolve({ brewed: true }));
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
          ['ready',   'BEGIN_WORK',   awaiting('working')],
          ['working', 'PING',         stay(),       { call: (m) => m._onChildPing }],
          ['working', 'DONE',         finalState()],
          ['working', 'ERROR',        'ready'],
          ['working', 'CHILD_FINISH', finalState()],
        ],
        methods: () => ({
          _onChildPing: () => eventsLog.push('childPing'),
        }),
        tasks: {
          working: (_ctx, sig) =>
            new Promise<void>((_resolve, reject) => {
              sig.addEventListener('abort', () => {
                childAborted = true;
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }),
        },
      });

      const parentFSM = createFSM<{
        events: {
          START_UPLOAD: void;
          ENTER_CHILD: void;
          PING: void;
          LOGOUT: void;
        };
        states: 'idle' | 'uploading' | 'done' | 'loggedOut';
        methods: {
          _onParentPing(): void;
          _onLogout(): void;
        };
      }>()({
        id: 'parentWithAnyState',
        initial: 'idle',
        transitions: [
          ['idle',      'START_UPLOAD', awaiting('uploading')],
          ['idle',      'ENTER_CHILD',  childActor],
          ['uploading', 'DONE',         'done'],
          ['uploading', 'ERROR',        'idle'],
          [childActor,  'DONE',         'done'],
          [anyState(),  'PING',         stay(),      { call: (m) => m._onParentPing }],
          [anyState(),  'LOGOUT',       'loggedOut', { call: (m) => m._onLogout }],
        ],
      });

      const Store = signalStore(
        withStateMachine(parentFSM, {
          methods: () => ({
            _onParentPing: () => eventsLog.push('parentPing'),
            _onLogout: () => eventsLog.push('logout'),
          }),
          tasks: () => ({
            uploading: (_ctx, sig) =>
              new Promise<void>((_resolve, reject) => {
                sig.addEventListener('abort', () => {
                  uploadAborted = true;
                  reject(new DOMException('Aborted', 'AbortError'));
                });
              }),
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
        states: 'bookingFlight';
      }>()({
        id: 'flightActor',
        initial: 'bookingFlight',
        transitions: [
          ['bookingFlight', 'DONE',  finalState(), { output: ['DONE', () => ({ flightId: 'FL-100' })] }],
          ['bookingFlight', 'ERROR', finalState(), { output: ['ERROR', () => ({ reason: 'no-flights' })] }],
        ],
        tasks: {
          bookingFlight: () =>
            new Promise<void>((resolve) => {
              resolveM1 = resolve;
            }),
        },
      });

      const m2 = createMachineFeature<{
        outputs: { DONE: { hotelId: string }; ERROR: { reason: string } };
        states: 'bookingHotel';
      }>()({
        id: 'hotelActor',
        initial: 'bookingHotel',
        transitions: [
          ['bookingHotel', 'DONE',  finalState(), { output: ['DONE', () => ({ hotelId: 'HT-200' })] }],
          ['bookingHotel', 'ERROR', finalState(), { output: ['ERROR', () => ({ reason: 'no-rooms' })] }],
        ],
        tasks: {
          bookingHotel: (_ctx, sig) =>
            new Promise<void>((resolve, reject) => {
              resolveM2 = resolve;
              sig.addEventListener('abort', () => {
                m2Aborted = true;
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }),
        },
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
        states: 'bookingFlight';
      }>()({
        id: 'flightActorFail',
        initial: 'bookingFlight',
        transitions: [
          ['bookingFlight', 'DONE',  finalState(), { output: ['ERROR', () => ({ reason: 'flight-rejected' })] }],
          ['bookingFlight', 'ERROR', finalState(), { output: ['ERROR', () => ({ reason: 'flight-rejected' })] }],
        ],
        tasks: {
          bookingFlight: async () => undefined,
        },
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
        states: 'searching';
      }>()({
        id: 'fastActor',
        initial: 'searching',
        transitions: [
          ['searching', 'DONE',  finalState(), { output: ['FOUND', () => 'cache-hit'] }],
          ['searching', 'ERROR', finalState(), { output: ['FOUND', () => 'fallback'] }],
        ],
        tasks: {
          searching: async () => undefined,
        },
      });

      const slowActor = createMachineFeature<{
        outputs: { TIMEOUT: void };
        states: 'waiting';
      }>()({
        id: 'slowActor',
        initial: 'waiting',
        transitions: [
          ['waiting', 'DONE',  finalState('TIMEOUT')],
          ['waiting', 'ERROR', finalState('TIMEOUT')],
        ],
        tasks: {
          waiting: (_ctx, sig) =>
            new Promise<void>((_resolve, reject) => {
              sig.addEventListener('abort', () => {
                slowAborted = true;
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }),
        },
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
        states: 'connecting';
      }>()({
        id: 'failingPrimary',
        initial: 'connecting',
        transitions: [
          ['connecting', 'DONE',  finalState(), { output: ['ERROR', () => 'primary-down'] }],
          ['connecting', 'ERROR', finalState(), { output: ['ERROR', () => 'primary-down'] }],
        ],
        tasks: {
          connecting: async () => undefined,
        },
      });

      const succeedingMirror = createMachineFeature<{
        outputs: { DONE: string; ERROR: string };
        states: 'connecting';
      }>()({
        id: 'succeedingMirror',
        initial: 'connecting',
        transitions: [
          ['connecting', 'DONE',  finalState(), { output: ['DONE', () => 'mirror-ok'] }],
          ['connecting', 'ERROR', finalState(), { output: ['ERROR', () => 'mirror-down'] }],
        ],
        tasks: {
          connecting: () => new Promise<void>((r) => setTimeout(r, 5)),
        },
      });

      const slowBackup = createMachineFeature<{
        outputs: { DONE: string; ERROR: string };
        states: 'connecting';
      }>()({
        id: 'slowBackup',
        initial: 'connecting',
        transitions: [
          ['connecting', 'DONE',  finalState(), { output: ['DONE', () => 'backup-ok'] }],
          ['connecting', 'ERROR', finalState(), { output: ['ERROR', () => 'backup-down'] }],
        ],
        tasks: {
          connecting: (_ctx, sig) =>
            new Promise<void>((_resolve, reject) => {
              sig.addEventListener('abort', () => {
                backupAborted = true;
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }),
        },
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
        states: 'connecting';
      }>()({
        id: 'failingMirror',
        initial: 'connecting',
        transitions: [
          ['connecting', 'DONE',  finalState(), { output: ['ERROR', () => 'mirror-down'] }],
          ['connecting', 'ERROR', finalState(), { output: ['ERROR', () => 'mirror-down'] }],
        ],
        tasks: {
          connecting: async () => undefined,
        },
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

    it('whenSignal(source, mapping): reactively bridges external Angular Signals into FSM events', () => {
      const networkStatus = signal<'online' | 'offline'>('online');
      const tokenExpired = signal(false);

      const sessionFSM = createFSM<{
        events: {
          NETWORK_LOST: 'offline';
          NETWORK_RESTORED: 'online';
          SESSION_EXPIRED: boolean;
        };
        states: 'active' | 'offlinePaused' | 'loggedOut';
        context: { lastStatus: string | null };
        methods: {
          _recordOffline(status: 'offline'): void;
        };
      }>()({
        id: 'sessionBridge',
        initial: 'active',
        context: { lastStatus: null },
        transitions: [
          ['active',        'NETWORK_LOST',     'offlinePaused', { call: (m) => m._recordOffline }],
          ['offlinePaused', 'NETWORK_RESTORED', 'active'],
          [anyState(),      'SESSION_EXPIRED',  'loggedOut'],
        ],
      });

      const SessionStore = signalStore(
        withState({ lastStatus: null as string | null }),
        withStateMachine(sessionFSM, {
          methods: (store) => ({
            _recordOffline: (status: 'offline') =>
              patchState(store, { lastStatus: status }),
          }),
          on: () => [
            whenSignal(networkStatus, {
              offline: 'NETWORK_LOST',
              online: 'NETWORK_RESTORED',
            }),
            whenSignal(tokenExpired, (expired) =>
              expired ? 'SESSION_EXPIRED' : null,
            ),
          ],
        }),
      );

      const store = new SessionStore();
      // Initial signal evaluation does not fire transitions
      expect(store.fsmState()).toBe('active');
      expect(store.lastStatus()).toBeNull();

      // Flip networkStatus -> 'offline': triggers NETWORK_LOST synchronously!
      networkStatus.set('offline');
      expect(store.fsmState()).toBe('offlinePaused');
      expect(store.lastStatus()).toBe('offline');

      // Flip networkStatus -> 'online': triggers NETWORK_RESTORED!
      networkStatus.set('online');
      expect(store.fsmState()).toBe('active');

      // Flip tokenExpired -> true: triggers SESSION_EXPIRED via [anyState(), 'SESSION_EXPIRED', 'loggedOut']!
      tokenExpired.set(true);
      expect(store.fsmState()).toBe('loggedOut');
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
          ['browsing',           'CHECKOUT',        awaiting('processingCheckout')],
          ['processingCheckout', 'DONE',            'completed'],
          ['processingCheckout', 'ERROR',           'browsing'],
        ],
        state: {
          selectedItem: null as string | null,
          promoActive: false,
          orderId: null as string | null,
        },
        on: () => [
          whenSignal(externalPromoSig, (active) =>
            active ? 'PROMO_ACTIVATED' : null,
          ),
        ],
        methods: (store) => ({
          _selectItem: ({ item }: { item: string }) =>
            patchState(store, { selectedItem: item }),
          _enablePromo: () => patchState(store, { promoActive: true }),
        }),
        tasks: () => ({
          processingCheckout: async (ctx) => ({
            orderId: `ORD-${ctx.selectedItem}`,
          }),
        }),
      });

      const RootFeatureStore = signalStore(withStateMachine(myRootFeature));
      const store = new RootFeatureStore();

      expect(store.fsmState()).toBe('browsing');
      expect(store.selectedItem()).toBeNull();
      expect(store.promoActive()).toBe(false);
      expect(store.orderId()).toBeNull();

      // 1. Feature `on` signal listener works automatically
      externalPromoSig.set(true);
      expect(store.promoActive()).toBe(true);

      // 2. Feature `methods` work automatically and update store state signals
      store.send('SELECT_ITEM', { item: 'Espresso' });
      expect(store.selectedItem()).toBe('Espresso');

      // 3. Feature `tasks` work automatically
      store.send('CHECKOUT');
      await new Promise((r) => setTimeout(r, 15));
      expect(store.fsmState()).toBe('completed');
      expect(store.orderId()).toBe('ORD-Espresso');
    });

    it('whenSignal(source, selector): does NOT fire on initial store creation (t = 0) and supports dynamic [EventName, Payload] tuple selectors', () => {
      // Initial value at t = 0 is already truthy ('app://initial'), must NOT fire at t = 0!
      const urlSignal = signal<string | null>('app://initial');
      const receivedLinks: string[] = [];

      const routerLinkFSM = createFSM<{
        events: {
          DEEP_LINK: { url: string };
        };
        states: 'home' | 'deepLinked';
        methods: {
          _onDeepLink(payload: { url: string }): void;
        };
      }>()({
        id: 'routerLinkBridge',
        initial: 'home',
        transitions: [
          ['home',       'DEEP_LINK', 'deepLinked', { call: (m) => m._onDeepLink }],
          ['deepLinked', 'DEEP_LINK', stay(),       { call: (m) => m._onDeepLink }],
        ],
      });

      const RouterLinkStore = signalStore(
        withStateMachine(routerLinkFSM, {
          methods: () => ({
            _onDeepLink: ({ url }: { url: string }) => receivedLinks.push(url),
          }),
          on: () => [
            whenSignal(urlSignal, (url) =>
              url ? (['DEEP_LINK', { url }] as const) : null,
            ),
          ],
        }),
      );

      const store = new RouterLinkStore();

      // 1. At t = 0 (initial store creation), no event was fired despite urlSignal starting at 'app://initial'
      expect(store.fsmState()).toBe('home');
      expect(receivedLinks).toEqual([]);

      // 2. When urlSignal changes to 'app://promo', machine receives 'DEEP_LINK' with payload { url: 'app://promo' }
      urlSignal.set('app://promo');
      expect(store.fsmState()).toBe('deepLinked');
      expect(receivedLinks).toEqual(['app://promo']);
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
        states: 'brewingCoffee';
      }>()({
        id: 'baristaZeroTick',
        initial: 'brewingCoffee',
        transitions: [
          [
            'brewingCoffee',
            'DONE',
            finalState(),
            {
              output: ['COFFEE_READY', (ctx) => ({ drink: ctx.selectedDrink })],
            },
          ],
        ],
        tasks: () => ({
          // Synchronous 0ms task completion!
          brewingCoffee: () => undefined,
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
          ['idle',      'TYPE_QUERY', awaiting('searching'), { call: (m) => m._setQuery }],
          ['searching', 'TYPE_QUERY', awaiting('searching'), { call: (m) => m._setQuery }],
          ['searching', 'PING',       stay(),                { call: (m) => m._incPings }],
          ['searching', 'DONE',       'resultsReady'],
          ['searching', 'ERROR',      'searchFailed'],
        ],
        state: {
          query: '',
          results: [] as string[],
          pings: 0,
        },
        methods: (store) => ({
          _setQuery: ({ query }: { query: string }) =>
            patchState(store, { query }),
          _incPings: () =>
            patchState(store, { pings: store.pings() + 1 }),
        }),
        tasks: () => ({
          searching: (ctx, signal) =>
            new Promise((resolve, reject) => {
              searchCalls.push({
                query: ctx.query,
                signal,
                resolve,
                reject,
              });
            }),
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
        states: 'brewingCoffee';
      }>()({
        id: 'barista',
        initial: 'brewingCoffee',
        transitions: [
          [
            awaiting('brewingCoffee'),
            'DONE',
            finalState(),
            {
              output: [
                'COFFEE_READY',
                (ctx) => ({ servedDrink: ctx.brewedDrink ?? ctx.selectedDrink }),
              ],
            },
          ],
        ],
        state: {
          brewedDrink: null as string | null,
        },
        // Production factory uses Angular inject() — would throw NG0203 outside DI!
        tasks: (api = inject(PROD_BARISTA_API)) => ({
          brewingCoffee: (ctx) => api.brew(ctx.selectedDrink),
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
          ['drinkSelected', 'CHECKOUT', awaiting('checkingLoyalty')],
          [
            'checkingLoyalty',
            'DONE',
            baristaChildFSM,
            { input: (ctx) => ({ selectedDrink: ctx.drinkName! }) },
          ],
          [
            baristaChildFSM,
            'COFFEE_READY',
            'orderReady',
            { call: (m) => m._onReady },
          ],
          [anyState(), 'DISCONNECT', 'idle'],
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
        on: (ext = inject(PROD_EXTERNAL_STORE)) => [
          whenSignal(ext.disconnectSig, (d) => (d ? 'DISCONNECT' : null)),
        ],
        methods: (store) => ({
          _select: ({ name }: { readonly name: string }) =>
            patchState(store, { drinkName: name }),
          _onReady: ({ servedDrink }: { readonly servedDrink: string }) =>
            patchState(store, { servedDrink }),
        }),
        tasks: (loyalty = inject(PROD_LOYALTY_API)) => ({
          checkingLoyalty: (ctx) => loyalty.check(ctx.loyaltyPoints),
        }),
      });

      // Pure Vitest execution — ZERO TestBed!
      const tester = createFeatureTester(coffeeShopParentFSM, {
        syncedContext: { policy: 'strict' },
        tasks: {
          checkingLoyalty: async () => ({ loyaltyPoints: 50 }),
        },
        actorTasks: {
          barista: {
            brewingCoffee: async (ctx) => ({
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
          ['browsing',        'PLACE_ORDER',  awaiting('checkingLoyalty')],
          ['checkingLoyalty', 'DONE',         'paid'],
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
          _markReady: () =>
            patchState(store, {
              readyBanner: `${store.selectedDrink()} is ready!`,
            }),
        }),
        tasks: () => ({
          checkingLoyalty: async (ctx) => ({
            stamps: ctx.stamps + 1,
            isFree: ctx.stamps + 1 >= 10,
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
});
