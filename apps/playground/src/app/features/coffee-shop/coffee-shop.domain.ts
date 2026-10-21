/**
 * Layer 2 (Domain): Pure Coffee Shop & Loyalty Business Logic + Types
 * STRICT RULE: 0% Angular DI (`inject` forbidden!)
 */

import {
  COFFEE_MENU,
  type BrewResult,
  type CoffeeDrink,
} from './barista.domain';

export { COFFEE_MENU, type BrewResult, type CoffeeDrink };

export interface CustomerCard {
  readonly cardId: string;
  readonly customerName: string;
  readonly currentStamps: number;
}

export interface CoffeeShopContext {
  customerCard: CustomerCard;
  selectedDrink: CoffeeDrink | null;
  isFreeDrink: boolean;
  finalPrice: number;
  isPaid: boolean;
  preparedCup: BrewResult | null;
  baristaResult?: BrewResult | null;
  error: string | null;
}

export const initialCoffeeShopContext: CoffeeShopContext = {
  customerCard: {
    cardId: 'CARD-8842',
    customerName: 'Sam CoffeeLover',
    currentStamps: 3,
  },
  selectedDrink: null,
  isFreeDrink: false,
  finalPrice: 0,
  isPaid: false,
  preparedCup: null,
  baristaResult: null,
  error: null,
};

export type CoffeeShopStates =
  | 'customerBrowsing'
  | 'checkingLoyalty'
  | 'loyaltyErrorView'
  | 'awaitingPayment'
  | 'coffeeReady'
  | 'drinkingCoffee';

export type CoffeeShopEvents = {
  SELECT_DRINK: { drink: CoffeeDrink };
  SET_STAMPS: { stamps: number };
  PLACE_ORDER: void;
  CANCEL: void;
  RETRY: void;
  BYPASS_CARD: void;
  PAY: void;
  TAKE_COFFEE: void;
  FINISH_COFFEE: void;
  LoyaltyApiTimeoutError: { message: string };
};

export type CoffeeShopMethods = {
  _selectDrink(payload: { drink: CoffeeDrink }): void;
  _setStamps(payload: { stamps: number }): void;
  _setMissingDrinkError(): void;
  _markPaid(): void;
  _handleDrinkPrepared(payload: { baristaResult?: BrewResult | null }): void;
  _finishCoffee(): void;
};

/**
 * Pure calculation to determine if the next ordered drink is the 10th free drink
 */
export function isTenthDrinkEligible(currentStamps: number): boolean {
  return (currentStamps + 1) % 10 === 0;
}

/**
 * Calculates the next stamp count after completing an order:
 * If it was the 10th free drink, stamps reset to 0; otherwise increments by 1.
 */
export function calculateNextStamps(
  currentStamps: number,
  isFreeDrink: boolean,
): number {
  return isFreeDrink ? 0 : currentStamps + 1;
}

/**
 * Calculates final price to be charged at the register.
 */
export function calculateFinalPrice(
  drinkPrice: number,
  isFreeDrink: boolean,
): number {
  return isFreeDrink ? 0 : drinkPrice;
}
