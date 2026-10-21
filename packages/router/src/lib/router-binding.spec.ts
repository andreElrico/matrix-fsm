import { signalStore, withState } from '@ngrx/signals';
import { describe, expect, it } from 'vitest';
import { createFSM } from '@matrix-fsm/core';
import { withStateMachine } from '@matrix-fsm/angular';
import { withRouteMachine } from '../index.js';

describe('@matrix-fsm/router - withRouteMachine', () => {
  it('projects FSM states to URLs and dispatches events from incoming routes', () => {
    const wizardFSM = createFSM<{
      events: {
        NEXT: void;
        BACK: void;
      };
      context: { orgSlug: string };
    }>()({
      id: 'onboardingWizard',
      initial: 'stepAccount',
      transitions: [
        ['stepAccount',   'NEXT', 'stepWorkspace'],
        ['stepWorkspace', 'BACK', 'stepAccount'],
        ['stepWorkspace', 'NEXT', 'completed'],
      ],
    });

    const WizardStore = signalStore(
      withState({ orgSlug: 'matrix' }),
      withStateMachine(wizardFSM),
      withRouteMachine(wizardFSM, {
        stateToRoute: {
          stepAccount: '/onboarding/account',
          stepWorkspace: (ctx) => `/onboarding/${ctx.orgSlug}/workspace`,
          completed: '/dashboard',
        },
        routeToEvent: {
          '/onboarding/workspace': 'NEXT',
        },
      }),
    );

    const store = new WizardStore();
    expect(store.fsmState()).toBe('stepAccount');
    expect(store.fsmUrl()).toBe('/onboarding/account');

    store.syncFromUrl('/onboarding/workspace');
    expect(store.fsmState()).toBe('stepWorkspace');
    expect(store.fsmUrl()).toBe('/onboarding/matrix/workspace');

    store.send('NEXT');
    expect(store.fsmState()).toBe('completed');
    expect(store.fsmUrl()).toBe('/dashboard');
  });
});
