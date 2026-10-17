import { signal } from '@angular/core';
import { signalStore } from '@ngrx/signals';
import { Data, Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  awaiting,
  createFSM,
  each,
  finalState,
  stay,
  transitions,
} from '@matrix-fsm/core';
import { withStateMachine } from '../index.js';

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

const hasValidInput = (ctx: AuthContext) => ctx.credentials.email.includes('@');
const shouldShowPromo = (ctx: AuthContext) =>
  ctx.user !== null && ctx.policy.showUpsellAds;

const handleLoginSubmit = transitions<AuthContext>([
  [
    'loginView',
    'LOGIN',
    awaiting('authenticating'),
    {
      guard: hasValidInput,
    },
  ],
  [
    'loginView',
    'LOGIN',
    stay(),
    {
      patch: () => ({ error: 'Invalid email' }),
    },
  ],
]);

const authFSM = createFSM({
  id: 'auth',
  initial: 'loginView',
  events: {} as {
    SET_EMAIL: { email: string };
    LOGIN: void;
    DISMISS_PROMO: void;
    CANCEL: void;
    NetworkTimeoutError: { message: string };
  },
  context: {
    credentials: { email: '', password: '' },
    user: null,
    policy: {
      showUpsellAds: true,
      canBypassApproval: false,
      discountPercent: 0,
      maxProjects: 3,
    },
    error: null,
  } satisfies AuthContext,
  transitions: [
    [
      'loginView',
      'SET_EMAIL',
      stay(),
      {
        patch: (ctx, payload: { email: string }) => ({
          credentials: { ...ctx.credentials, email: payload.email },
          error: null,
        }),
      },
    ],
    ...handleLoginSubmit,
    ['authenticating', 'CANCEL', 'loginView'],
    ['authenticating', 'DONE', 'proUpsellPromo', { guard: shouldShowPromo }],
    ['authenticating', 'DONE', 'loggedIn'],
    ['authenticating', 'NetworkTimeoutError', 'offlineRetryView'],
    [
      'authenticating',
      'ERROR',
      'loginView',
      {
        patch: (_ctx, err: Error) => ({ error: err.message }),
      },
    ],
    ['proUpsellPromo', 'DISMISS_PROMO', 'loggedIn'],
  ],
});

describe('@matrix-fsm/angular - withStateMachine', () => {
  it('syncs external signals into fsmContext, patches context BEFORE DONE guards, and runs Effect-TS tasks', async () => {
    const policySignal = signal<UserEntitlements>({
      showUpsellAds: true,
      canBypassApproval: false,
      discountPercent: 0,
      maxProjects: 3,
    });

    const AuthStore = signalStore(
      withStateMachine(authFSM, {
        syncContext: () => ({
          policy: policySignal,
        }),
        tasks: () => ({
          authenticating: (ctx) =>
            Effect.succeed({
              id: 'u1',
              email: ctx.credentials.email,
            }).pipe(Effect.map((user) => ({ user, error: null }))),
        }),
      }),
    );

    const store = new AuthStore();
    expect(store.fsmState()).toBe('loginView');
    expect(store.isPending()).toBe(false);

    // 1. Invalid email -> stay() and patch error
    store.send('LOGIN');
    expect(store.fsmState()).toBe('loginView');
    expect(store.fsmContext().error).toBe('Invalid email');

    // 2. Set valid email and login with showUpsellAds: true
    store.send('SET_EMAIL', { email: 'alice@matrix.dev' });
    store.send('LOGIN');

    await new Promise((r) => setTimeout(r, 15));

    // Notice shouldShowPromo checks `ctx.user !== null && ctx.policy.showUpsellAds`!
    // Because task output `{ user }` is patched into ctx BEFORE 'DONE' guards evaluate,
    // `shouldShowPromo` sees both `ctx.user` and synced `ctx.policy`!
    expect(store.fsmState()).toBe('proUpsellPromo');
    expect(store.fsmContext().user).toEqual({
      id: 'u1',
      email: 'alice@matrix.dev',
    });

    store.send('DISMISS_PROMO');
    expect(store.fsmState()).toBe('loggedIn');

    // 3. Reactive syncContext: switch user role policy to Pro (showUpsellAds: false)
    store.reset();
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

  it('routes Effect TaggedError via _tag to matching matrix row or falls back to ERROR', async () => {
    let failMode: 'tagged' | 'generic' = 'tagged';

    const AuthStore = signalStore(
      withStateMachine(authFSM, {
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
    expect(store.fsmContext().error).toBe('Invalid credentials');
  });

  it('aborts AbortSignal and interrupts Effect Fiber when leaving awaiting state on CANCEL', async () => {
    let wasInterrupted = false;
    let abortSignalTriggered = false;

    const AuthStore = signalStore(
      withStateMachine(authFSM, {
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
    expect(store.fsmContext().user).toBeNull();
  });

  it('orchestrates parallel child machines via each() and dispatches ALL_DONE when all finish', () => {
    const itemFSM = createFSM({
      id: 'uploadItem',
      initial: 'uploading',
      context: { done: false },
      transitions: [
        [
          'uploading',
          'COMPLETE',
          finalState('DONE'),
          { patch: () => ({ done: true }) },
        ],
      ],
    });

    const batchFSM = createFSM({
      id: 'batchUpload',
      initial: 'idle',
      context: { fileIds: ['file-1', 'file-2'] },
      transitions: [
        ['idle', 'START_BATCH', each('fileIds', itemFSM)],
        [each('fileIds', itemFSM), 'ALL_DONE', 'completed'],
      ],
    });

    const BatchStore = signalStore(withStateMachine(batchFSM));
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
    // Instances remain visible in childMachines for split-view UI inspection
    expect(store.childMachines()['fileIds']).toHaveLength(2);
    expect(store.childMachines()['fileIds'].every((c) => c.isDone)).toBe(true);
  });
});
