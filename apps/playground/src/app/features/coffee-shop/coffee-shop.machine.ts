/**
 * Layer 3 (Feature): Pure Coffee Shop Root FSM (coffee-shop.machine.ts)
 * 0% Angular DI, Zero JSON Dummy Objects, Named FSMContract, Strict Matrix Alignment
 */

import { awaiting, createFSM, stay } from '@matrix-fsm/core';
import { baristaFSM } from './barista.machine';
import type {
  CoffeeShopContext,
  CoffeeShopEvents,
  CoffeeShopMethods,
  CoffeeShopStates,
} from './coffee-shop.domain';

// Pure guards (0% DI, strictly reads ctx):
const hasSelectedDrink = (ctx: CoffeeShopContext) => ctx.selectedDrink !== null;
const isFreeDrink = (ctx: CoffeeShopContext) => ctx.isFreeDrink === true;

export { baristaFSM };

export const coffeeShopFSM = createFSM<{
  events: CoffeeShopEvents;
  states: CoffeeShopStates;
  context: CoffeeShopContext;
  methods: CoffeeShopMethods;
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
    // 10th drink is FREE -> bypass payment and route directly into Barista Sub-FSM!
    ['checkingLoyalty',     'DONE',                     baristaFSM,                   { guard: isFreeDrink }],
    ['checkingLoyalty',     'DONE',                     'awaitingPayment'],

    // Loyalty error recovery options:
    ['loyaltyErrorView',    'RETRY',                    awaiting('checkingLoyalty')],
    ['loyaltyErrorView',    'BYPASS_CARD',              'awaitingPayment'],
    ['loyaltyErrorView',    'CANCEL',                   'customerBrowsing'],

    // Customer payment at register -> enters Barista Sub-FSM:
    ['awaitingPayment',     'PAY',                      baristaFSM,                   { call: (m) => m._markPaid }],
    ['awaitingPayment',     'CANCEL',                   'customerBrowsing'],

    // Barista Sub-FSM outcomes & group-interrupt:
    [baristaFSM,            'CANCEL',                   'customerBrowsing'],
    [baristaFSM,            'COFFEE_READY',             'coffeeReady',                { call: (m) => m._handleDrinkPrepared }],

    // Customer picks up coffee from counter and drinks it:
    ['coffeeReady',         'TAKE_COFFEE',              'drinkingCoffee'],
    ['drinkingCoffee',      'FINISH_COFFEE',            'customerBrowsing',           { call: (m) => m._finishCoffee }],
  ],
});
