/**
 * Layer 3 (Feature): SignalStore + DI + Effect-TS Integration (auth.store.ts)
 */

import { inject, Injectable } from '@angular/core';
import { signalStore } from '@ngrx/signals';
import { Effect, Schedule } from 'effect';
import { withStateMachine } from '@matrix-fsm/angular';
import { AuthApiService, GlobalAuthStore } from '../../core';
import { authFSM } from './auth.machine';

@Injectable()
export class AuthFeatureStore extends signalStore(
  withStateMachine(authFSM, {
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
