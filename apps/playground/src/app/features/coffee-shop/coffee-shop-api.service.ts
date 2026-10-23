/**
 * Layer 1 (Core/Services): Coffee Loyalty API & Barista Service
 * Pure Promise + AbortSignal implementation (0% Effect-TS dependency)
 */

import { Injectable } from '@angular/core';
import {
  type BrewResult,
  type CoffeeDrink,
  type CustomerCard,
  isTenthDrinkEligible,
} from './coffee-shop.domain';

export class LoyaltyApiTimeoutError extends Error {
  readonly _tag = 'LoyaltyApiTimeoutError' as const;
  constructor(message: string) {
    super(message);
    this.name = 'LoyaltyApiTimeoutError';
  }
}

export class BaristaMachineGlitchError extends Error {
  readonly _tag = 'BaristaMachineGlitchError' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BaristaMachineGlitchError';
  }
}

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

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
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
   * Cashier API call to check customer loyalty card status via standard Promise + AbortSignal
   */
  async checkLoyalty(
    cardId: string,
    customerName: string,
    currentStamps: number,
    signal?: AbortSignal,
  ): Promise<LoyaltyCheckResponse> {
    this.loyaltyCallCount++;

    if (this.mode === 'timeout') {
      throw new LoyaltyApiTimeoutError(
        'Loyalty API gateway timed out (504 Gateway Timeout)',
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
    await abortableDelay(150, signal);
    return response;
  }

  /**
   * Barista brewing task simulation with AbortSignal cancellation support
   */
  async brewCoffee(
    drink: CoffeeDrink,
    signal?: AbortSignal,
    simulateBrewError?: boolean,
  ): Promise<BrewResult> {
    this.brewCallCount++;

    if (simulateBrewError) {
      throw new BaristaMachineGlitchError(
        'Steam wand pressure drop — please retry extraction',
      );
    }

    const brewDuration = this.mode === 'slow_brewing' ? 1200 : 450;

    await abortableDelay(brewDuration, signal);

    return {
      baristaNote: `Freshly steamed ${drink.name} crafted with artisanal latte art!`,
      temperatureCelsius: 67,
    };
  }
}
