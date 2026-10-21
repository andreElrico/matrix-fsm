import { signal } from '@angular/core';
import {
  patchState,
  signalStore,
  withMethods,
  withState,
} from '@ngrx/signals';
import { Data, Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  awaiting,
  createFSM,
  each,
  finalState,
  stay,
} from '@matrix-fsm/core';
import {
  provideStateMachine,
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

interface AuthMethods {
  _setEmail(payload: { email: string }): void;
  _setInvalidEmail(): void;
  _setError(err: Error): void;
}

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
          { patch: () => ({ done: true }) },
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
    interface SubMethods {
      _setBrewError(err: Error): void;
    }
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
    interface ShopMethods {
      _markPaid(): void;
      _onCupReady(output: SubCtx): void;
    }
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

    // 1. Omitting parent's OWN task (`checkingLoyalty`) or OWN method (`_markPaid`) triggers a compile error:
    signalStore(
      withState<ShopCtx>({ drinkOrder: 'Flat White', paid: false, cupReady: false }),
      withMethods((): ShopMethods => ({
        _markPaid: () => undefined,
        _onCupReady: () => undefined,
      })),
      // @ts-expect-error - Own awaiting state 'checkingLoyalty' is missing in tasks
      withStateMachine(shopFSM, {
        tasks: () => ({}),
      }),
    );

    signalStore(
      withState<ShopCtx>({ drinkOrder: 'Flat White', paid: false, cupReady: false }),
      // @ts-expect-error - Own method '_onCupReady' is missing in store methods
      withMethods(() => ({
        _markPaid: () => undefined,
      })),
      withStateMachine(shopFSM, {
        tasks: () => ({
          checkingLoyalty: async () => ({ paid: false }),
        }),
      }),
    );

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
});
