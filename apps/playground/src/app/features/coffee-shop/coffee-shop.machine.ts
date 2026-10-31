/**
 * Layer 3 (Feature): Cohesive Coffee Shop Root Feature (coffee-shop.machine.ts)
 * Uses `createMachineFeature` (Sandwich Pattern):
 * 1. Public Contract (Events, States)
 * 2. Pure Transition Matrix (0% DI inside transitions)
 * 3. Encapsulated State, Methods & Async Tasks
 */

import { inject } from '@angular/core';
import { patchState } from '@ngrx/signals';
import { awaiting, createMachineFeature, stay } from '@matrix-fsm/angular';
import { baristaFSM } from './barista.feature';
import { CoffeeShopApiService } from './coffee-shop-api.service';
import {
  calculateNextStamps,
  COFFEE_MENU,
  initialCoffeeShopContext,
  type CoffeeShopContext,
  type CoffeeShopEvents,
  type CoffeeShopMethods,
  type CoffeeShopStates,
} from './coffee-shop.domain';

// Pure guards (0% DI, strictly reads ctx):
const hasSelectedDrink = (ctx: CoffeeShopContext) => ctx.selectedDrink !== null;
const isFreeDrink = (ctx: CoffeeShopContext) => ctx.isFreeDrink === true;

export { baristaFSM };

export const coffeeShopFSM = createMachineFeature<{
  events: CoffeeShopEvents;
  states: CoffeeShopStates;
}>()({
  id: 'coffeeShop',
  initial: 'customerBrowsing',
  // prettier-ignore
  transitions: [
    /* FROM                 VIA                         TO                            OPTIONS */
    ['customerBrowsing',    'SELECT_DRINK',             stay(),                       { call: (m) => m._selectDrink }],
    ['customerBrowsing',    'SET_STAMPS',               stay(),                       { call: (m) => m._setStamps }],
    ['customerBrowsing',    'PLACE_ORDER',              awaiting('checkingLoyalty'),  { guard: hasSelectedDrink }],
    ['customerBrowsing',    'PLACE_ORDER',              stay(),                       { call: (m) => m._setMissingDrinkError }],

    // Cashier checks loyalty card via API call:
    ['checkingLoyalty',     'CANCEL',                   'customerBrowsing'],
    ['checkingLoyalty',     'LoyaltyApiTimeoutError',   'loyaltyErrorView'],
    ['checkingLoyalty',     'ERROR',                    'customerBrowsing'],
    // 10th drink is FREE -> bypass payment and route directly into Barista Sub-FSM with typed input!
    ['checkingLoyalty',     'DONE',                     baristaFSM,                   {
                                                                                        guard: isFreeDrink,
                                                                                        input: (ctx) => ({ selectedDrink: ctx.selectedDrink ?? COFFEE_MENU[0] }),
                                                                                      }],
    ['checkingLoyalty',     'DONE',                     'awaitingPayment'],

    // Loyalty error recovery options:
    ['loyaltyErrorView',    'RETRY',                    awaiting('checkingLoyalty')],
    ['loyaltyErrorView',    'BYPASS_CARD',              'awaitingPayment'],
    ['loyaltyErrorView',    'CANCEL',                   'customerBrowsing'],

    // Customer payment at register -> enters Barista Sub-FSM with typed input:
    ['awaitingPayment',     'PAY',                      baristaFSM,                   {
                                                                                        call: (m) => m._markPaid,
                                                                                        input: (ctx) => ({ selectedDrink: ctx.selectedDrink ?? COFFEE_MENU[0] }),
                                                                                      }],
    ['awaitingPayment',     'CANCEL',                   'customerBrowsing'],

    // Barista Sub-FSM outcomes & group-interrupt:
    [baristaFSM,            'CANCEL',                   'customerBrowsing'],
    [baristaFSM,            'COFFEE_READY',             'coffeeReady',                { call: (m) => m._onCoffeeReady }],

    // Customer picks up coffee from counter and drinks it:
    ['coffeeReady',         'TAKE_COFFEE',              'drinkingCoffee'],
    ['drinkingCoffee',      'FINISH_COFFEE',            'customerBrowsing',           { call: (m) => m._finishCoffee }],
  ],
  state: initialCoffeeShopContext,
  methods: (store): CoffeeShopMethods => ({
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
});
