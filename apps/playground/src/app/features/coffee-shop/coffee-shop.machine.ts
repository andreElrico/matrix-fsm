/**
 * Layer 3 (Feature): Pure Coffee Shop & Barista Sub-FSM (coffee-shop.machine.ts)
 * 0% Angular DI, 100% static analyzability (Mermaid exportable), Strict Matrix Alignment
 */

import {
  awaiting,
  createFSM,
  finalState,
  stay,
  subMachine,
} from '@matrix-fsm/core';
import {
  type BrewResult,
  calculateNextStamps,
  type CoffeeDrink,
  type CustomerCard,
} from './coffee-shop.domain';

export interface CoffeeShopContext {
  customerCard: CustomerCard;
  selectedDrink: CoffeeDrink | null;
  isFreeDrink: boolean;
  finalPrice: number;
  isPaid: boolean;
  baristaResult: BrewResult | null;
  error: string | null;
}

// Pure guards (0% DI, strictly reads ctx):
const hasSelectedDrink = (ctx: CoffeeShopContext) => ctx.selectedDrink !== null;
const isFreeDrink = (ctx: CoffeeShopContext) => ctx.isFreeDrink === true;

/**
 * Hierarchical Sub-FSM for the Barista Station.
 * Encapsulates ticket queueing, espresso extraction, and machine maintenance,
 * and can later be scaled to multiple parallel baristas via `each('baristas', baristaFSM)`.
 */
export const baristaFSM = subMachine({
  id: 'barista',
  initial: 'ticketQueued',
  events: {} as {
    START_BREWING: void;
    RETRY_BREW: void;
  },
  context: {} as CoffeeShopContext,
  // prettier-ignore
  transitions: [
    /* FROM                 VIA               TO */
    ['ticketQueued',        'START_BREWING',  awaiting('brewingCoffee')],
    ['brewingCoffee',       'DONE',           finalState('COFFEE_READY')],
    ['brewingCoffee',       'ERROR',          'machineMaintenance',
      { patch: (_ctx, err: Error) => ({ error: err.message }) }
    ],
    ['machineMaintenance',  'RETRY_BREW',     awaiting('brewingCoffee')],
  ],
});

export const coffeeShopFSM = createFSM({
  id: 'coffeeShop',
  initial: 'customerBrowsing',
  events: {} as {
    SELECT_DRINK: { drink: CoffeeDrink };
    SET_STAMPS: { stamps: number };
    PLACE_ORDER: void;
    CANCEL: void;
    RETRY: void;
    BYPASS_CARD: void;
    PAY: void;
    START_BREWING: void;
    RETRY_BREW: void;
    TAKE_COFFEE: void;
    FINISH_COFFEE: void;
    LoyaltyApiTimeoutError: { message: string };
  },
  context: {
    customerCard: {
      cardId: 'CARD-8842',
      customerName: 'Sam CoffeeLover',
      currentStamps: 3,
    },
    selectedDrink: null,
    isFreeDrink: false,
    finalPrice: 0,
    isPaid: false,
    baristaResult: null,
    error: null,
  } satisfies CoffeeShopContext as CoffeeShopContext,
  // prettier-ignore
  transitions: [
    /* FROM                 VIA                         TO */
    ['customerBrowsing',    'SELECT_DRINK',             stay(),
      {
        patch: (_ctx, payload: { drink: CoffeeDrink }) => ({
          selectedDrink: payload.drink,
          finalPrice: payload.drink.price,
          error: null,
        }),
      }],
    ['customerBrowsing',    'SET_STAMPS',               stay(),
      {
        patch: (ctx, payload: { stamps: number }) => ({ 
          customerCard: { ...ctx.customerCard, currentStamps: payload.stamps },
        }),
      }],
    ['customerBrowsing',    'PLACE_ORDER',              awaiting('checkingLoyalty'),  { guard: hasSelectedDrink }],
    ['customerBrowsing',    'PLACE_ORDER',              stay(),
      { patch: () => ({ error: 'Please select a coffee first!' }) }],

    // Cashier checks loyalty card via API call:
    ['checkingLoyalty',     'CANCEL',                   'customerBrowsing'],
    ['checkingLoyalty',     'LoyaltyApiTimeoutError',   'loyaltyErrorView'],
    ['checkingLoyalty',     'ERROR',                    'customerBrowsing',
      { patch: (_ctx, err: Error) => ({ error: err.message }) }],
    // 10th drink is FREE -> bypass payment and route directly into Barista Sub-FSM!
    ['checkingLoyalty',     'DONE',                     baristaFSM,                   { guard: isFreeDrink }],
    ['checkingLoyalty',     'DONE',                     'awaitingPayment'],

    // Loyalty error recovery options:
    ['loyaltyErrorView',    'RETRY',                    awaiting('checkingLoyalty')],
    ['loyaltyErrorView',    'BYPASS_CARD',              'awaitingPayment'],
    ['loyaltyErrorView',    'CANCEL',                   'customerBrowsing'],

    // Customer payment at register -> enters Barista Sub-FSM:
    ['awaitingPayment',     'PAY',                      baristaFSM,
      { patch: () => ({ isPaid: true }) }],
    ['awaitingPayment',     'CANCEL',                   'customerBrowsing'],

    // Barista Sub-FSM outcomes & group-interrupt:
    [baristaFSM,            'CANCEL',                   'customerBrowsing'],
    [baristaFSM,            'COFFEE_READY',             'coffeeReady'],
    [baristaFSM,            'DONE',                     'coffeeReady'],

    // Customer picks up coffee from counter and drinks it:
    ['coffeeReady',         'TAKE_COFFEE',              'drinkingCoffee'],
    ['drinkingCoffee',      'FINISH_COFFEE',            'customerBrowsing',
      {
        patch: (ctx) => ({
          customerCard: {
            ...ctx.customerCard,
            currentStamps: calculateNextStamps(
              ctx.customerCard.currentStamps,
              ctx.isFreeDrink,
            ),
          },
          selectedDrink: null,
          isPaid: false,
          isFreeDrink: false,
          baristaResult: null,
          error: null,
        }),
      }],
  ],
});
