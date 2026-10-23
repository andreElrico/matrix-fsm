/**
 * Cohesive Sub-Machine Actor: Barista Station (barista.feature.ts)
 * Combines Public Contract (Inputs, Events, Outputs, States), Transition Matrix,
 * and isolated Actor Runtime (state, methods, tasks) in a single cohesive file.
 */

import { inject } from '@angular/core';
import { patchState } from '@ngrx/signals';
import {
  awaiting,
  createMachineFeature,
  finalState,
} from '@matrix-fsm/angular';
import { CoffeeShopApiService } from './coffee-shop-api.service';
import type { BrewResult, CoffeeDrink } from './coffee-shop.domain';

// ============================================================================
// 1. PUBLIC CONTRACT (Inputs, Events, Outputs)
// ============================================================================
export interface BaristaInputs {
  readonly selectedDrink: CoffeeDrink;
  readonly simulateBrewError?: boolean;
}

export type BaristaEvents = {
  START_BREWING: void;
  RETRY_BREW: void;
};

export type BaristaOutputs = {
  COFFEE_READY: {
    readonly drinkName: string;
    readonly result: BrewResult;
  };
};

// ============================================================================
// 2. COHESIVE MACHINE FEATURE (Matrix + Internal State + Tasks)
// ============================================================================
export const baristaFSM = createMachineFeature<{
  inputs: BaristaInputs;
  events: BaristaEvents;
  outputs: BaristaOutputs;
  states: 'ticketQueued' | 'brewingCoffee' | 'maintenance';
}>()({
  id: 'barista',
  initial: 'ticketQueued',

  // --------------------------------------------------------------------------
  // A) THE MATRIX (Immediately visible at the top of the configuration!)
  // --------------------------------------------------------------------------
  // prettier-ignore
  transitions: [
    /* FROM            VIA               TO                         OPTIONS */
    ['ticketQueued',   'START_BREWING',  awaiting('brewingCoffee')],
    ['brewingCoffee',  'DONE',           finalState(),              { output: ['COFFEE_READY', (ctx) => ({ drinkName: ctx.selectedDrink.name, result: ctx.baristaResult! })] }],
    ['brewingCoffee',  'ERROR',          'maintenance',             { call: (m) => m._setBrewError }],
    ['maintenance',    'RETRY_BREW',     awaiting('brewingCoffee')],
  ],

  // --------------------------------------------------------------------------
  // B) INTERNAL STATE (Private to the Barista actor — zero parent leakage!)
  // --------------------------------------------------------------------------
  state: {
    baristaResult: null as BrewResult | null,
    brewError: null as string | null,
  },

  // --------------------------------------------------------------------------
  // C) IMPLEMENTATION (Methods & Async Tasks)
  // --------------------------------------------------------------------------
  methods: (store) => ({
    _setBrewError: (err: Error) => patchState(store, { brewError: err.message }),
  }),

  tasks: (api = inject(CoffeeShopApiService)) => ({
    brewingCoffee: async (ctx, signal) => {
      const baristaResult = await api.brewCoffee(
        ctx.selectedDrink,
        signal,
        ctx.simulateBrewError,
      );
      return {
        baristaResult,
        brewError: null,
      };
    },
  }),
});
