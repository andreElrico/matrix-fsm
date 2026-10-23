/**
 * Layer 3 (Feature): Coffee Shop SignalStore (`withState` + `withMethods` + `withStateMachine`)
 * Zero Barista Leakage — 100% focused on CoffeeShop domain logic!
 * Sub-machine (`baristaFSM`) is coupled ONLY in `coffee-shop.machine.ts`.
 */

import { inject, Injectable } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { withStateMachine } from '@matrix-fsm/angular';
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
      _onCoffeeReady: ({ result }) =>
        patchState(store, {
          preparedCup: result,
        }),
      _finishCoffee: () =>
        patchState(store, {
          ...initialCoffeeShopContext,
          customerCard: {
            ...store.customerCard(),
            currentStamps: calculateNextStamps(
              store.customerCard().currentStamps,
              store.isFreeDrink(),
            ),
          },
        }),
    }),
  ),
  withStateMachine(coffeeShopFSM, {
    tasks: (api = inject(CoffeeShopApiService)) => ({
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
