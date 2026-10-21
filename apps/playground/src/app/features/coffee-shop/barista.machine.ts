/**
 * Layer 3 (Feature): Pure Barista Sub-FSM (barista.machine.ts)
 * 0% Angular DI, 0% Parent Imports, Named FSMContract, Strict Matrix Alignment
 */

import { awaiting, createFSM, finalState } from '@matrix-fsm/core';
import type {
  BaristaContext,
  BaristaEvents,
  BaristaMethods,
  BaristaStates,
} from './barista.domain';

export const baristaFSM = createFSM<{
  events: BaristaEvents;
  states: BaristaStates;
  context: BaristaContext;
  methods: BaristaMethods;
}>()({
  id: 'barista',
  initial: 'ticketQueued',
  // prettier-ignore
  transitions: [
    /* FROM                 VIA               TO                            OPTIONS */
    ['ticketQueued',        'START_BREWING',  awaiting('brewingCoffee')],
    ['brewingCoffee',       'DONE',           finalState('COFFEE_READY')],
    ['brewingCoffee',       'ERROR',          'machineMaintenance',         { call: (m) => m._setBrewError }],
    ['machineMaintenance',  'RETRY_BREW',     awaiting('brewingCoffee')],
  ],
});
