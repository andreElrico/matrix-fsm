/**
 * Layer 3 (Feature): Composable Barista SignalStore Feature (barista.store.ts)
 * Encapsulates Barista state (`BaristaContext`), methods (`BaristaMethods`), and tasks (`brewingCoffee`).
 */

import { inject } from '@angular/core';
import {
  patchState,
  signalStoreFeature,
  withMethods,
  withState,
  type WritableStateSource,
} from '@ngrx/signals';
import type { TasksMapFor } from '@matrix-fsm/angular';
import { CoffeeShopApiService } from './coffee-shop-api.service';
import {
  COFFEE_MENU,
  initialBaristaContext,
  type BaristaContext,
  type BaristaMethods,
  type BrewResult,
} from './barista.domain';
import type { baristaFSM } from './barista.machine';

export function withBarista() {
  return signalStoreFeature(
    withState<{ baristaResult: BrewResult | null }>({
      baristaResult: initialBaristaContext.baristaResult,
    }),
    withMethods(
      (store): BaristaMethods => ({
        _setBrewError: (err) =>
          patchState(
            store as unknown as WritableStateSource<Pick<BaristaContext, 'error'>>,
            {
              error: err.message,
            },
          ),
      }),
    ),
  );
}

export function createBaristaTasks(
  api = inject(CoffeeShopApiService),
): TasksMapFor<typeof baristaFSM> {
  return {
    brewingCoffee: async (ctx, signal) => {
      const drink = ctx.selectedDrink ?? COFFEE_MENU[0];
      const baristaResult = await api.brewCoffee(drink, signal);
      return {
        baristaResult,
        error: null,
      };
    },
  };
}
