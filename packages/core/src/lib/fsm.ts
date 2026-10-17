/**
 * @matrix-fsm/core - Pure FSM Definition & First-Match-Wins Evaluator
 */

import {
  isAwaitingNode,
  isEachNode,
  isFinalNode,
  isStayNode,
  isSubMachineRef,
} from './primitives.js';
import type {
  AnyTransitionRow,
  EachNode,
  ExtractStatesFromConfig,
  FSMConfig,
  FSMDefinition,
  ResolveContext,
  SubMachineRef,
  TransitionEvaluation,
  TransitionOptions,
} from './types.js';

export function resolveSourceId(source: unknown): string {
  if (typeof source === 'string') {
    return source;
  }
  if (isSubMachineRef(source)) {
    return source.id;
  }
  if (isEachNode(source)) {
    return source.id;
  }
  return String(source);
}

export function resolveTargetId(
  target: unknown,
  currentState: string,
): {
  stateName: string;
  stayed: boolean;
  isAwaiting: boolean;
  finalOutcome: string | null;
  subMachine: SubMachineRef<any, any> | null;
  eachNode: EachNode<any, any> | null;
} {
  if (isStayNode(target)) {
    return {
      stateName: currentState,
      stayed: true,
      isAwaiting: false,
      finalOutcome: null,
      subMachine: null,
      eachNode: null,
    };
  }
  if (isAwaitingNode(target)) {
    return {
      stateName: target.state,
      stayed: false,
      isAwaiting: true,
      finalOutcome: null,
      subMachine: null,
      eachNode: null,
    };
  }
  if (isFinalNode(target)) {
    return {
      stateName: target.outcome,
      stayed: false,
      isAwaiting: false,
      finalOutcome: target.outcome,
      subMachine: null,
      eachNode: null,
    };
  }
  if (isSubMachineRef(target)) {
    return {
      stateName: target.id,
      stayed: false,
      isAwaiting: false,
      finalOutcome: null,
      subMachine: target,
      eachNode: null,
    };
  }
  if (isEachNode(target)) {
    return {
      stateName: target.id,
      stayed: false,
      isAwaiting: false,
      finalOutcome: null,
      subMachine: null,
      eachNode: target,
    };
  }
  return {
    stateName: String(target),
    stayed: false,
    isAwaiting: false,
    finalOutcome: null,
    subMachine: null,
    eachNode: null,
  };
}

/**
 * Creates a pure, statically analyzable flat tuple Finite State Machine definition.
 */
export function createFSM<
  const TId extends string,
  const TInitial extends string,
  TContext extends object,
  TEvents extends Record<string, any> = Record<string, any>,
  const TTransitions extends readonly AnyTransitionRow<TContext>[] =
    readonly AnyTransitionRow<TContext>[],
>(
  config: FSMConfig<TId, TInitial, TContext, TEvents, TTransitions>,
): FSMDefinition<
  TId,
  TInitial,
  ResolveContext<TContext, TTransitions>,
  TEvents,
  TTransitions
> {
  type EffectiveContext = ResolveContext<TContext, TTransitions>;
  const states = new Set<string>([config.initial]);
  const awaitingStates = new Set<string>();
  const subMachines = new Map<string, SubMachineRef<any, any>>();
  const eachNodes = new Map<string, EachNode<any, any>>();

  for (const row of config.transitions) {
    const [from, via, to] = row as unknown as readonly [unknown, unknown, unknown];

    if (isSubMachineRef(from)) {
      states.add(from.id);
      subMachines.set(from.id, from);
    } else if (isEachNode(from)) {
      states.add(from.id);
      eachNodes.set(from.id, from);
    } else if (typeof from === 'string') {
      states.add(from);
      if (via === 'DONE' || via === 'ERROR') {
        awaitingStates.add(from);
      }
    }

    if (isAwaitingNode(to)) {
      states.add(to.state);
      awaitingStates.add(to.state);
    } else if (isFinalNode(to)) {
      states.add(to.outcome);
    } else if (isSubMachineRef(to)) {
      states.add(to.id);
      subMachines.set(to.id, to);
    } else if (isEachNode(to)) {
      states.add(to.id);
      eachNodes.set(to.id, to);
    } else if (!isStayNode(to) && typeof to === 'string') {
      states.add(to);
    }
  }

  type StateUnion = ExtractStatesFromConfig<TInitial, TTransitions>;

  const hasTransitionFor = (state: string, event: string): boolean => {
    for (const row of config.transitions) {
      const [from, via] = row as unknown as readonly [unknown, unknown];
      if (resolveSourceId(from) === state && String(via) === event) {
        return true;
      }
    }
    return false;
  };

  const evaluate = (
    currentState: string,
    event: string,
    payload: unknown,
    currentContext: Readonly<EffectiveContext>,
  ): TransitionEvaluation<StateUnion, EffectiveContext> => {
    // Evaluate top-to-bottom (First-Match-Wins)
    for (const row of config.transitions) {
      const [from, via, to, options] = row as unknown as readonly [
        unknown,
        unknown,
        unknown,
        TransitionOptions<EffectiveContext, any> | undefined,
      ];

      const fromId = resolveSourceId(from);
      const viaId = String(via);

      if (fromId !== currentState || viaId !== event) {
        continue;
      }

      if (options?.guard && !options.guard(currentContext, payload)) {
        continue;
      }

      // First matching row wins!
      const patchApplied = options?.patch
        ? (options.patch(currentContext, payload) as Partial<EffectiveContext>)
        : null;
      const nextContext = patchApplied
        ? ({ ...currentContext, ...patchApplied } as EffectiveContext)
        : ({ ...currentContext } as EffectiveContext);

      const resolved = resolveTargetId(to, currentState);
      const isTargetAwaiting =
        resolved.isAwaiting || awaitingStates.has(resolved.stateName);

      const exitedSub =
        !resolved.stayed && subMachines.has(currentState)
          ? (subMachines.get(currentState) ?? null)
          : null;

      return {
        matched: true,
        from: currentState,
        via: event,
        nextState: resolved.stateName as StateUnion,
        nextContext,
        patchApplied,
        stayed: resolved.stayed,
        isAwaiting: resolved.stayed
          ? awaitingStates.has(currentState)
          : isTargetAwaiting,
        finalOutcome: resolved.finalOutcome,
        enteredSubMachine: resolved.subMachine,
        exitedSubMachine: exitedSub,
        enteredEach: resolved.eachNode,
      };
    }

    return {
      matched: false,
      from: currentState,
      via: event,
      nextState: currentState as StateUnion,
      nextContext: { ...currentContext } as EffectiveContext,
      patchApplied: null,
      stayed: false,
      isAwaiting: awaitingStates.has(currentState),
      finalOutcome: null,
      enteredSubMachine: null,
      exitedSubMachine: null,
      enteredEach: null,
    };
  };

  return Object.freeze({
    id: config.id,
    initial: config.initial,
    context: config.context as unknown as EffectiveContext,
    events: (config.events ?? {}) as TEvents,
    transitions: config.transitions,
    states,
    awaitingStates,
    subMachines,
    eachNodes,
    evaluate,
    hasTransitionFor,
  });
}
