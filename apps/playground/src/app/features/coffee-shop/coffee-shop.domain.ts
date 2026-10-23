/**
 * Layer 2 (Domain): Pure Coffee Shop & Loyalty Business Logic + Types
 * STRICT RULE: 0% Angular DI (`inject` forbidden!)
 */

export interface CoffeeDrink {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly emoji: string;
  readonly description: string;
}

export const COFFEE_MENU: readonly CoffeeDrink[] = [
  {
    id: 'espresso',
    name: 'Espresso Single Origin',
    price: 3.5,
    emoji: '☕',
    description: 'Rich, bold double shot extracted with 9 bars of pressure',
  },
  {
    id: 'cappuccino',
    name: 'Oat Milk Cappuccino',
    price: 4.8,
    emoji: '🥛',
    description: 'Espresso balanced with silky steamed oat foam and cocoa dust',
  },
  {
    id: 'flat-white',
    name: 'Velvet Flat White',
    price: 5.0,
    emoji: '🫗',
    description: 'Double ristretto with micro-textured velvety whole milk',
  },
  {
    id: 'caramel-macchiato',
    name: 'Artisan Caramel Macchiato',
    price: 5.5,
    emoji: '🍯',
    description:
      'Vanilla-infused milk stained with dark espresso and artisan caramel drizzle',
  },
] as const;

export interface BrewResult {
  readonly baristaNote: string;
  readonly temperatureCelsius: number;
}

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
  _onCoffeeReady(output: {
    readonly drinkName: string;
    readonly result: BrewResult;
  }): void;
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
