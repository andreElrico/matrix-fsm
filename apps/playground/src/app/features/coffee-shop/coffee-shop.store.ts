/**
 * Layer 3 (Feature): Coffee Shop SignalStore + DI + Effect-TS Integration
 */

import { inject, Injectable } from '@angular/core';
import { signalStore } from '@ngrx/signals';
import { Effect } from 'effect';
import { withStateMachine } from '@matrix-fsm/angular';
import { CoffeeShopApiService } from './coffee-shop-api.service';
import { coffeeShopFSM } from './coffee-shop.machine';

@Injectable()
export class CoffeeShopStore extends signalStore(
  withStateMachine(coffeeShopFSM, {
    tasks: (api = inject(CoffeeShopApiService)) => ({
      checkingLoyalty: (ctx) =>
        api
          .checkLoyaltyEffect(
            ctx.customerCard.cardId,
            ctx.customerCard.customerName,
            ctx.customerCard.currentStamps,
          )
          .pipe(
            Effect.map((res) => ({
              isFreeDrink: res.isFreeDrink,
              customerCard: res.card,
              finalPrice: res.isFreeDrink ? 0 : (ctx.selectedDrink?.price ?? 0),
              error: null,
            })),
          ),

      brewingCoffee: (ctx) => {
        const drink = ctx.selectedDrink ?? {
          id: 'espresso',
          name: 'House Blend Espresso',
          price: 3.5,
          emoji: '☕',
          description: 'Default roast',
        };

        return api.brewCoffeeEffect(drink).pipe(
          Effect.map((baristaResult) => ({
            baristaResult,
            error: null,
          })),
        );
      },
    }),
  }),
) {}
