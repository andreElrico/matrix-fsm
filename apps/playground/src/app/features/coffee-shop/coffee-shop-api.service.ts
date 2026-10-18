/**
 * Layer 1 (Core/Services): Coffee Loyalty API & Barista Service with Effect-TS
 */

import { Injectable } from '@angular/core';
import { Data, Effect } from 'effect';
import {
  type BrewResult,
  type CoffeeDrink,
  type CustomerCard,
  isTenthDrinkEligible,
} from './coffee-shop.domain';

export class LoyaltyApiTimeoutError extends Data.TaggedError('LoyaltyApiTimeoutError')<{
  readonly message: string;
}> {}

export class BaristaMachineGlitchError extends Data.TaggedError('BaristaMachineGlitchError')<{
  readonly message: string;
}> {}

export type LoyaltySimulationMode =
  | 'normal'
  | 'tenth_free'
  | 'timeout'
  | 'slow_brewing';

export interface LoyaltyCheckResponse {
  readonly card: CustomerCard;
  readonly isFreeDrink: boolean;
  readonly message: string;
}

@Injectable({ providedIn: 'root' })
export class CoffeeShopApiService {
  private mode: LoyaltySimulationMode = 'normal';
  public loyaltyCallCount = 0;
  public brewCallCount = 0;

  getSimulationMode(): LoyaltySimulationMode {
    return this.mode;
  }

  setSimulationMode(mode: LoyaltySimulationMode): void {
    this.mode = mode;
  }

  /**
   * Cashier API call to check customer loyalty card status
   */
  checkLoyaltyEffect(
    cardId: string,
    customerName: string,
    currentStamps: number,
  ): Effect.Effect<LoyaltyCheckResponse, LoyaltyApiTimeoutError | Error> {
    return Effect.suspend(() => {
      this.loyaltyCallCount++;

      if (this.mode === 'timeout') {
        return Effect.fail(
          new LoyaltyApiTimeoutError({
            message: 'Loyalty API gateway timed out (504 Gateway Timeout)',
          }),
        );
      }

      // If mode is tenth_free, override current stamps to 9 so it's the 10th drink:
      const stamps = this.mode === 'tenth_free' ? 9 : currentStamps;
      const isFree = isTenthDrinkEligible(stamps);

      const response: LoyaltyCheckResponse = {
        card: {
          cardId,
          customerName,
          currentStamps: stamps,
        },
        isFreeDrink: isFree,
        message: isFree
          ? '🎉 Congratulations! This is your 10th drink — IT IS ON THE HOUSE!'
          : `Loyalty card confirmed: ${stamps}/10 stamps collected.`,
      };

      // Add a small 150ms latency to demonstrate the awaiting state in UI
      return Effect.sleep('150 millis').pipe(Effect.map(() => response));
    });
  }

  /**
   * Barista brewing task simulation with Fiber cancellation support
   */
  brewCoffeeEffect(
    drink: CoffeeDrink,
  ): Effect.Effect<BrewResult, BaristaMachineGlitchError | Error> {
    return Effect.suspend(() => {
      this.brewCallCount++;

      const brewDuration = this.mode === 'slow_brewing' ? '1200 millis' : '450 millis';

      const result: BrewResult = {
        baristaNote: `Freshly steamed ${drink.name} crafted with artisanal latte art!`,
        temperatureCelsius: 67,
      };

      return Effect.sleep(brewDuration).pipe(Effect.map(() => result));
    });
  }
}
