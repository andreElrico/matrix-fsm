/**
 * @matrix-fsm/router - Route-bound State Machines for Angular SignalStore
 */

import { computed, type Signal } from '@angular/core';
import {
  signalStoreFeature,
  type,
  withProps,
  type EmptyFeatureResult,
  type SignalStoreFeature,
} from '@ngrx/signals';
import type {
  AnyFSMDefinition,
  ExtractContext,
  ExtractEvents,
  ExtractStates,
} from '@matrix-fsm/core';
import type { StateMachineStoreMembers } from '@matrix-fsm/angular';

export interface RouteStateMapping<TFSM extends AnyFSMDefinition> {
  /**
   * Maps FSM states to route URL paths (static string or function of context).
   */
  readonly stateToRoute: Partial<
    Record<
      ExtractStates<TFSM>,
      string | ((ctx: Readonly<ExtractContext<TFSM>>) => string)
    >
  >;
  /**
   * Maps incoming URL path patterns to FSM events.
   */
  readonly routeToEvent?: Readonly<
    Record<string, ExtractEvents<TFSM>>
  >;
  /**
   * Optional navigation callback invoked whenever `fsmUrl()` changes.
   */
  readonly onNavigate?: (url: string) => void;
}

export interface RouteBoundStoreMembers {
  readonly fsmUrl: Signal<string | null>;
  readonly syncFromUrl: (url: string, params?: Record<string, unknown>) => boolean;
}

/**
 * Binds an `@matrix-fsm/angular` SignalStore state machine to URL routes.
 */
export function withRouteMachine<TFSM extends AnyFSMDefinition>(
  _fsm: TFSM,
  mapping: RouteStateMapping<TFSM>,
): SignalStoreFeature<
  {
    state: EmptyFeatureResult['state'];
    props: StateMachineStoreMembers<TFSM>;
    methods: EmptyFeatureResult['methods'];
  },
  {
    state: EmptyFeatureResult['state'];
    props: RouteBoundStoreMembers;
    methods: EmptyFeatureResult['methods'];
  }
> {
  return signalStoreFeature(
    type<{
      state: EmptyFeatureResult['state'];
      props: StateMachineStoreMembers<TFSM>;
      methods: EmptyFeatureResult['methods'];
    }>(),
    withProps((store): RouteBoundStoreMembers => {
      const fsmUrl = computed<string | null>(() => {
        const currentState = store.fsmState();
        const routeResolver = mapping.stateToRoute[currentState];
        if (!routeResolver) {
          return null;
        }
        return typeof routeResolver === 'function'
          ? routeResolver(store.fsmContext())
          : routeResolver;
      });

      const syncFromUrl = (
        url: string,
        params?: Record<string, unknown>,
      ): boolean => {
        const event = mapping.routeToEvent?.[url];
        if (!event) {
          return false;
        }
        (store.send as (e: string, p?: unknown) => void)(event, params);
        const nextUrl = fsmUrl();
        if (nextUrl && mapping.onNavigate) {
          mapping.onNavigate(nextUrl);
        }
        return true;
      };

      return {
        fsmUrl,
        syncFromUrl,
      };
    }),
  );
}
