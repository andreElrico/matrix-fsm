/**
 * Layer 3 (Feature): SignalStore + DI + Optional Effect-TS Adapter (auth.store.ts)
 */

import { inject, Injectable } from '@angular/core';
import {
  patchState,
  signalStore,
  withMethods,
  withState,
} from '@ngrx/signals';
import { Effect, Schedule } from 'effect';
import { withStateMachine } from '@matrix-fsm/angular';
import { effectTaskAdapter } from '@matrix-fsm/angular/effect';
import { AuthApiService, GlobalAuthStore } from '../../core';
import {
  authFSM,
  type AuthContext,
  type AuthMethods,
  initialAuthContext,
} from './auth.machine';

@Injectable()
export class AuthFeatureStore extends signalStore(
  withState<AuthContext>(initialAuthContext),
  withMethods(
    (store): AuthMethods => ({
      _updateCredentials: (payload) =>
        patchState(store, {
          credentials: { ...store.credentials(), ...payload },
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
  ),
  withStateMachine(authFSM, {
    taskAdapter: effectTaskAdapter,

    // 1. Reactive Context Mirroring (syncs Layer 1 signals into FSM context without coupling):
    syncContext: (globalAuth = inject(GlobalAuthStore)) => ({
      policy: globalAuth.policy,
    }),

    // 2. Compile-time enforced Tasks for every awaiting('...') state in authFSM:
    tasks: (authApi = inject(AuthApiService)) => ({
      authenticating: (ctx) =>
        authApi.loginEffect(ctx.credentials).pipe(
          Effect.retry({
            times: 2,
            schedule: Schedule.exponential('10 millis'),
          }),
          Effect.map((user) => ({ user, error: null })),
        ),
    }),
  }),
) {}
