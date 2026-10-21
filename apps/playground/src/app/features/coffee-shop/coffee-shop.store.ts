/**
 * Layer 3 (Feature): Coffee Shop SignalStore (`withBarista` + `withState` + `withMethods` + `withStateMachine`)
 * Zero Effect-TS dependency — uses native Promises, AbortSignal, and SignalStore `patchState`.
 */

import { inject, Injectable } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { withStateMachine } from '@matrix-fsm/angular';
import { createBaristaTasks, withBarista } from './barista.store';
import { CoffeeShopApiService } from './coffee-shop-api.service';
import {
  calculateNextStamps,
  initialCoffeeShopContext,
  type CoffeeShopContext,
  type CoffeeShopMethods,
} from './coffee-shop.domain';
import { coffeeShopFSM } from './coffee-shop.machine';

@Injectable()
export class CoffeeShopStore extends signalStore(
  withBarista(),
  withState<CoffeeShopContext>(initialCoffeeShopContext),
  withMethods(
    (store): CoffeeShopMethods => ({
      _selectDrink: ({ drink }) =>
        patchState(store, {
          selectedDrink: drink,
          finalPrice: drink.price,
          error: null,
        }),
      _setStamps: ({ stamps }) =>
        patchState(store, {
          customerCard: {
            ...store.customerCard(),
            currentStamps: stamps,
          },
        }),
      _setMissingDrinkError: () =>
        patchState(store, {
          error: 'Please select a coffee first!',
        }),
      _markPaid: () =>
        patchState(store, {
          isPaid: true,
        }),
      _finishCoffee: () =>
        patchState(store, {
          customerCard: {
            ...store.customerCard(),
            currentStamps: calculateNextStamps(
              store.customerCard().currentStamps,
              store.isFreeDrink(),
            ),
          },
          selectedDrink: null,
          isPaid: false,
          isFreeDrink: false,
          baristaResult: null,
          error: null,
        }),
    }),
  ),
  withStateMachine(coffeeShopFSM, {
    tasks: (api = inject(CoffeeShopApiService)) => ({
      ...createBaristaTasks(api),
      checkingLoyalty: async (ctx, signal) => {
        const res = await api.checkLoyalty(
          ctx.customerCard.cardId,
          ctx.customerCard.customerName,
          ctx.customerCard.currentStamps,
          signal,
        );
        return {
          isFreeDrink: res.isFreeDrink,
          customerCard: res.card,
          finalPrice: res.isFreeDrink ? 0 : (ctx.selectedDrink?.price ?? 0),
          error: null,
        };
      },
    }),
  }),
) {}
