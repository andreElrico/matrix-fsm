/**
 * Layer 3 (Feature): Cohesive Authentication Feature (auth.feature.ts)
 * Uses `createEffectMachineFeature` (Sandwich Pattern for Effect-TS):
 * 1. Public Contract (Events, States)
 * 2. Pure Transition Matrix (0% DI inside transitions)
 * 3. Encapsulated State, Reactive Context Mirroring (`syncContext`), and Effect-TS Methods
 */

import { inject } from '@angular/core';
import { patchState } from '@ngrx/signals';
import { Effect, Schedule } from 'effect';
import { awaiting, stay } from '@matrix-fsm/angular';
import { createEffectMachineFeature } from '@matrix-fsm/angular/effect';
import {
  AuthApiService,
  GlobalAuthStore,
  type Credentials,
  type NetworkTimeoutError,
  type User,
  type UserEntitlements,
} from '../../core';

export interface AuthContext {
  credentials: Credentials;
  user: User | null;
  policy: UserEntitlements;
  error: string | null;
}

export const initialAuthContext: AuthContext = {
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

export type AuthStates =
  | 'loginView'
  | 'authenticating'
  | 'proUpsellPromo'
  | 'offlineRetryView'
  | 'loggedIn';

export type AuthEvents = {
  UPDATE_CREDENTIALS: Partial<Credentials>;
  LOGIN: void;
  DISMISS_PROMO: void;
  CANCEL: void;
  RETRY: void;
  LOGOUT: void;
  NetworkTimeoutError: { message: string };
};

export type AuthMethods = {
  _updateCredentials(payload: Partial<Credentials>): void;
  _authenticate(
    payload: void,
    signal: AbortSignal,
    ctx: Readonly<AuthContext>,
  ): Effect.Effect<User, Error | NetworkTimeoutError>;
  _saveUser(user: User): void;
  _setInvalidEmail(): void;
  _setErrorMessage(err: Error): void;
  _logout(): void;
};

// Pure guards (0% DI, reads only ctx):
const hasValidInput = (ctx: AuthContext) => ctx.credentials.email.includes('@');
const shouldShowPromo = (ctx: AuthContext) => ctx.policy.showUpsellAds;

export const authFSM = createEffectMachineFeature<{
  events: AuthEvents;
  states: AuthStates;
  methods: AuthMethods;
}>()({
  id: 'auth',
  initial: 'loginView',
  // prettier-ignore
  transitions: [
    /* FROM               VIA                     TO                           OPTIONS */
    ['loginView',         'UPDATE_CREDENTIALS',   stay(),                      { call: (m) => m._updateCredentials }],
    ['loginView',         'LOGIN',                awaiting('authenticating'),  { guard: hasValidInput, call: (m) => m._authenticate }],
    ['loginView',         'LOGIN',                stay(),                      { call: (m) => m._setInvalidEmail }],

    // User cancels in-flight request -> Engine automatically interrupts Effect fiber:
    ['authenticating',    'CANCEL',               'loginView'],

    // Effect succeeded ('DONE'):
    ['authenticating',    'DONE',                 'proUpsellPromo',            { guard: shouldShowPromo, call: (m) => m._saveUser }],
    ['authenticating',    'DONE',                 'loggedIn',                  { call: (m) => m._saveUser }],

    // Effect failed ('ERROR' or Effect TaggedError _tag):
    ['authenticating',    'NetworkTimeoutError',  'offlineRetryView'],
    ['authenticating',    'ERROR',                'loginView',                 { call: (m) => m._setErrorMessage }],

    ['offlineRetryView',  'RETRY',                awaiting('authenticating'),  { call: (m) => m._authenticate }],
    ['offlineRetryView',  'CANCEL',               'loginView'],

    ['proUpsellPromo',    'DISMISS_PROMO',        'loggedIn'],
    ['loggedIn',          'LOGOUT',               'loginView',                 { call: (m) => m._logout }],
  ],
  state: initialAuthContext,

  // 1. Reactive Context Mirroring (syncs Layer 1 signals into FSM context without coupling):
  syncContext: (globalAuth = inject(GlobalAuthStore)) => ({
    policy: globalAuth.policy,
  }),

  // 2. Encapsulated Store & Async Effect-TS Methods:
  methods: (store, authApi = inject(AuthApiService)): AuthMethods => ({
    _updateCredentials: (payload) =>
      patchState(store, {
        credentials: { ...store.credentials(), ...payload },
        error: null,
      }),
    _authenticate: (_payload, _signal, ctx) =>
      authApi.loginEffect(ctx.credentials).pipe(
        Effect.retry({
          times: 2,
          schedule: Schedule.exponential('10 millis'),
        }),
      ),
    _saveUser: (user) =>
      patchState(store, {
        user,
        error: null,
      }),
    _setInvalidEmail: () =>
      patchState(store, {
        error: 'Invalid email',
      }),
    _setErrorMessage: (err) =>
      patchState(store, {
        error: err.message,
      }),
    _logout: () =>
      patchState(store, {
        user: null,
        error: null,
      }),
  }),
});
