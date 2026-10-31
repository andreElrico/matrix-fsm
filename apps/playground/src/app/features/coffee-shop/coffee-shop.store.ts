/**
 * Layer 3 (Feature): Coffee Shop SignalStore (`signalStore(withStateMachine(coffeeShopFSM))`)
 * Zero Barista Leakage & Zero Store Boilerplate — powered directly by `createMachineFeature`!
 */

import { Injectable } from '@angular/core';
import { signalStore } from '@ngrx/signals';
import { withStateMachine } from '@matrix-fsm/angular';
import { coffeeShopFSM } from './coffee-shop.machine';

@Injectable()
export class CoffeeShopStore extends signalStore(
  withStateMachine(coffeeShopFSM),
) {}
