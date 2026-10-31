/**
 * Layer 3 (Feature): Auth SignalStore (`signalStore(withStateMachine(authFSM))`)
 * Zero Store Boilerplate — powered directly by `createMachineFeature` (`auth.feature.ts`)!
 */

import { Injectable } from '@angular/core';
import { signalStore } from '@ngrx/signals';
import { withStateMachine } from '@matrix-fsm/angular';
import { authFSM } from './auth.feature';

@Injectable()
export class AuthFeatureStore extends signalStore(
  withStateMachine(authFSM),
) {}
