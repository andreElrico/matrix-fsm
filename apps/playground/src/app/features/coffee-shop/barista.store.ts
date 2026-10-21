/**
 * Layer 3 (Feature): Self-Contained Barista Store & Feature (barista.store.ts)
 * Encapsulates Barista state (`BaristaContext`), methods (`BaristaMethods`), and tasks (`brewingCoffee`).
 * Can be injected standalone (`BaristaStore`), provided via `provideStateMachine(baristaFSM, BaristaStore)`,
 * or auto-discovered when `baristaFSM` transitions are entered!
 */

import { inject, Injectable } from '@angular/core';
import {
  patchState,
  signalStore,
  signalStoreFeature,
  withMethods,
  withState,
} from '@ngrx/signals';
import { withMachineTasks, withStateMachine } from '@matrix-fsm/angular';
import { CoffeeShopApiService } from './coffee-shop-api.service';
import {
  COFFEE_MENU,
  initialBaristaContext,
  type BaristaContext,
  type BaristaMethods,
} from './barista.domain';
import { baristaFSM } from './barista.machine';

@Injectable({ providedIn: 'root' })
export class BaristaStore extends signalStore(
  withStateMachine(baristaFSM, {
    state: initialBaristaContext,
    methods: (store): BaristaMethods => ({
      _setBrewError: (err) =>
        patchState(store, {
          error: err.message,
        }),
    }),
    tasks: (api = inject(CoffeeShopApiService)) => ({
      brewingCoffee: async (ctx, signal) => {
        const drink = ctx.selectedDrink ?? COFFEE_MENU[0];
        const baristaResult = await api.brewCoffee(drink, signal);
        return {
          baristaResult,
          error: null,
        };
      },
    }),
  }),
) {}

/**
 * Optional composable SignalStore feature for teams that prefer explicit feature composition.
 */
export function withBarista() {
  return signalStoreFeature(
    withState<BaristaContext>(initialBaristaContext),
    withMethods(
      (store): BaristaMethods => ({
        _setBrewError: (err) =>
          patchState(store, {
            error: err.message,
          }),
      }),
    ),
    withMachineTasks(baristaFSM, (api = inject(CoffeeShopApiService)) => ({
      brewingCoffee: async (ctx, signal) => {
        const drink = ctx.selectedDrink ?? COFFEE_MENU[0];
        const baristaResult = await api.brewCoffee(drink, signal);
        return {
          baristaResult,
          error: null,
        };
      },
    })),
  );
}
