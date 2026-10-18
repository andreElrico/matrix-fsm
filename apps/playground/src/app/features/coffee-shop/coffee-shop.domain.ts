/**
 * Layer 2 (Domain): Pure Coffee Shop & Loyalty Business Logic
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
    description: 'Vanilla-infused milk stained with dark espresso and artisan caramel drizzle',
  },
] as const;

export interface CustomerCard {
  readonly cardId: string;
  readonly customerName: string;
  readonly currentStamps: number;
}

export interface BrewResult {
  readonly baristaNote: string;
  readonly temperatureCelsius: number;
}

/**
 * Pure calculation to determine if the next ordered drink is the 10th free drink
 */
export function isTenthDrinkEligible(currentStamps: number): boolean {
  // If customer currently has 9 stamps, the 10th drink is free!
  // Or every multiple of 10:
  return (currentStamps + 1) % 10 === 0;
}

/**
 * Calculates the next stamp count after completing an order:
 * If it was the 10th free drink, stamps reset to 0; otherwise increments by 1.
 */
export function calculateNextStamps(currentStamps: number, isFreeDrink: boolean): number {
  return isFreeDrink ? 0 : currentStamps + 1;
}

/**
 * Calculates final price to be charged at the register.
 */
export function calculateFinalPrice(drinkPrice: number, isFreeDrink: boolean): number {
  return isFreeDrink ? 0 : drinkPrice;
}
