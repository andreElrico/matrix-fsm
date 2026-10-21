/**
 * Layer 2 (Domain): Pure Barista Station Business Logic + Types
 * STRICT RULE: 0% Angular DI (`inject` forbidden!) and 0% imports from parent `coffee-shop.*`
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

export interface BaristaContext {
  selectedDrink: CoffeeDrink | null;
  baristaResult: BrewResult | null;
  error: string | null;
}

export const initialBaristaContext: BaristaContext = {
  selectedDrink: null,
  baristaResult: null,
  error: null,
};

export type BaristaStates =
  | 'ticketQueued'
  | 'brewingCoffee'
  | 'machineMaintenance';

export type BaristaEvents = {
  START_BREWING: void;
  RETRY_BREW: void;
};

export type BaristaMethods = {
  _setBrewError(err: Error): void;
};
