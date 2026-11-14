/**
 * @matrix-fsm/core - Pure FSM Definition & First-Match-Wins Evaluator
 */

import {
  isAfterNode,
  isAlwaysNode,
  isAnyStateNode,
  isAwaitingNode,
  isCombinatorNode,
  isEachNode,
  isEveryNode,
  isFinalNode,
  isFSMDefinition,
  isStayNode,
  isSubMachineRef,
} from './primitives.js';
import type {
  AnyFSMDefinition,
  AnyTransitionRow,
  CombinatorNode,
  ContractContext,
  ContractEvents,
  ContractInput,
  ContractMethods,
  ContractOutput,
  ContractStates,
  EachNode,
  EmptyObject,
  ExtractStatesFromConfig,
  FSMConfig,
  FSMContract,
  FSMDefinition,
  ResolveContext,
  SubMachineRef,
  TransitionEvaluation,
  TransitionOptions,
  TransitionRow,
  ValidateTransitionRows,
} from './types.js';

export function toSubMachineRef(
  value: unknown,
): SubMachineRef<AnyFSMDefinition, string> | null {
  if (isSubMachineRef(value)) {
    return value;
  }
  if (isFSMDefinition(value)) {
    return Object.freeze({
      __type: 'subMachine' as const,
      id: value.id,
      machine: value,
    });
  }
  return null;
}

export function resolveSourceId(source: unknown): string {
  if (typeof source === 'string') {
    return source;
  }
  if (isAnyStateNode(source)) {
    return '*';
  }
  if (isAwaitingNode(source)) {
    return source.state;
  }
  if (isSubMachineRef(source) || isFSMDefinition(source)) {
    return source.id;
  }
  if (isEachNode(source) || isCombinatorNode(source)) {
    return source.id;
  }
  return String(source);
}

export function resolveSourceIds(source: unknown): string[] {
  if (Array.isArray(source)) {
    return source.flatMap((el) => resolveSourceIds(el));
  }
  return [resolveSourceId(source)];
}

export function resolveViaId(via: unknown): string {
  if (isAfterNode(via) || isEveryNode(via) || isAlwaysNode(via)) {
    return via.id;
  }
  return String(via);
}

export function resolveViaMatches(via: unknown, event: string): boolean {
  if (Array.isArray(via)) {
    return via.some((v) => resolveViaId(v) === event);
  }
  return resolveViaId(via) === event;
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
  combinatorNode: CombinatorNode<any, any> | null;
} {
  if (isStayNode(target)) {
    return {
      stateName: currentState,
      stayed: true,
      isAwaiting: false,
      finalOutcome: null,
      subMachine: null,
      eachNode: null,
      combinatorNode: null,
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
      combinatorNode: null,
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
      combinatorNode: null,
    };
  }
  const subRef = toSubMachineRef(target);
  if (subRef) {
    return {
      stateName: subRef.id,
      stayed: false,
      isAwaiting: false,
      finalOutcome: null,
      subMachine: subRef,
      eachNode: null,
      combinatorNode: null,
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
      combinatorNode: null,
    };
  }
  if (isCombinatorNode(target)) {
    return {
      stateName: target.id,
      stayed: false,
      isAwaiting: false,
      finalOutcome: null,
      subMachine: null,
      eachNode: null,
      combinatorNode: target,
    };
  }
  return {
    stateName: String(target),
    stayed: false,
    isAwaiting: false,
    finalOutcome: null,
    subMachine: null,
    eachNode: null,
    combinatorNode: null,
  };
}

function buildFSM<
  const TId extends string,
  const TInitial extends string,
  TContext extends object,
  TEvents extends Record<string, any>,
  const TTransitions extends readonly AnyTransitionRow<TContext, any>[],
  TMethods = EmptyObject,
>(
  config: FSMConfig<
    TId,
    TInitial,
    TContext,
    TEvents,
    TTransitions,
    string,
    TMethods
  >,
): FSMDefinition<
  TId,
  TInitial,
  ResolveContext<TContext, TTransitions>,
  TEvents,
  TTransitions,
  TMethods
> {
  type EffectiveContext = ResolveContext<TContext, TTransitions>;
  const states = new Set<string>([config.initial]);
  const awaitingStates = new Set<string>();
  const explicitAwaitingStates = new Set<string>();
  const plainTargetStates = new Set<string>();
  const doneOrErrorSourceStates = new Set<string>();
  const awaitingCallSelectors = new Map<string, any>();
  const subMachines = new Map<string, SubMachineRef<any, any>>();
  const eachNodes = new Map<string, EachNode<any, any>>();
  const combinatorNodes = new Map<string, CombinatorNode<any, any>>();

  for (const row of config.transitions) {
    const [from, via, to, options] = row as unknown as readonly [
      unknown,
      unknown,
      unknown,
      TransitionOptions<EffectiveContext, any, TMethods> | undefined,
    ];

    const fromItems = Array.isArray(from) ? from : [from];
    for (const fromItem of fromItems) {
      const fromSub = toSubMachineRef(fromItem);
      if (isAnyStateNode(fromItem)) {
        // Wildcard source in Column 1; do not add to concrete states set
      } else if (isAwaitingNode(fromItem)) {
        states.add(fromItem.state);
        explicitAwaitingStates.add(fromItem.state);
      } else if (fromSub) {
        states.add(fromSub.id);
        subMachines.set(fromSub.id, fromSub);
      } else if (isEachNode(fromItem)) {
        states.add(fromItem.id);
        eachNodes.set(fromItem.id, fromItem);
      } else if (isCombinatorNode(fromItem)) {
        states.add(fromItem.id);
        combinatorNodes.set(fromItem.id, fromItem);
      } else if (typeof fromItem === 'string') {
        states.add(fromItem);
        if (via === 'DONE' || via === 'ERROR') {
          doneOrErrorSourceStates.add(fromItem);
        }
      }
    }

    const toSub = toSubMachineRef(to);
    if (isAwaitingNode(to)) {
      states.add(to.state);
      explicitAwaitingStates.add(to.state);
      if (options?.call && !awaitingCallSelectors.has(to.state)) {
        awaitingCallSelectors.set(to.state, options.call);
      }
    } else if (isFinalNode(to)) {
      // FinalNode is a terminal outcome marker, not a resting state in `states`
    } else if (toSub) {
      states.add(toSub.id);
      subMachines.set(toSub.id, toSub);
    } else if (isEachNode(to)) {
      states.add(to.id);
      eachNodes.set(to.id, to);
    } else if (isCombinatorNode(to)) {
      states.add(to.id);
      combinatorNodes.set(to.id, to);
    } else if (!isStayNode(to) && typeof to === 'string') {
      states.add(to);
      plainTargetStates.add(to);
    }
  }

  for (const s of explicitAwaitingStates) {
    awaitingStates.add(s);
  }
  for (const s of doneOrErrorSourceStates) {
    if (!plainTargetStates.has(s)) {
      awaitingStates.add(s);
    }
  }

  type StateUnion = ExtractStatesFromConfig<TInitial, TTransitions>;

  const hasTransitionFor = (state: string, event: string): boolean => {
    for (const row of config.transitions) {
      const [from, via] = row as unknown as readonly [unknown, unknown];
      if (
        resolveSourceIds(from).includes(state) &&
        resolveViaMatches(via, event)
      ) {
        return true;
      }
    }
    return false;
  };

  const evaluateRowList = (
    rowsToCheck: readonly AnyTransitionRow<TContext, any>[],
    currentState: string,
    event: string,
    payload: unknown,
    currentContext: Readonly<EffectiveContext>,
    matchWildcard: boolean,
  ): TransitionEvaluation<StateUnion, EffectiveContext, TMethods> | null => {
    for (const row of rowsToCheck) {
      const [from, via, to, options] = row as unknown as readonly [
        unknown,
        unknown,
        unknown,
        TransitionOptions<EffectiveContext, any, TMethods> | undefined,
      ];

      const fromIds = resolveSourceIds(from);
      const isWildcard = fromIds.includes('*');
      if (matchWildcard ? !isWildcard : isWildcard) {
        continue;
      }

      if (
        (!matchWildcard && !fromIds.includes(currentState)) ||
        !resolveViaMatches(via, event)
      ) {
        continue;
      }

      if (options?.guard && !options.guard(currentContext, payload)) {
        continue;
      }

      // First matching row wins!
      const nextContext = { ...currentContext } as EffectiveContext;

      const inputSelector =
        typeof options?.input === 'function'
          ? (options.input as (
              ctx: Readonly<EffectiveContext>,
              eventPayload: any,
            ) => Record<string, unknown>)
          : null;
      const inputMapped = null;

      let outputType: string | null = null;
      let outputSelector:
        | ((ctx: Readonly<EffectiveContext>, eventPayload: any) => unknown)
        | null = null;
      let emittedOutput: {
        readonly type: string;
        readonly payload: unknown;
      } | null = null;

      if (options?.output) {
        if (typeof options.output === 'string') {
          outputType = options.output;
          emittedOutput = { type: outputType, payload: undefined };
        } else if (Array.isArray(options.output)) {
          const [type, selector] = options.output as readonly [
            string,
            ((ctx: Readonly<EffectiveContext>, eventPayload: any) => unknown)?,
          ];
          outputType = String(type);
          outputSelector = typeof selector === 'function' ? selector : null;
          emittedOutput = {
            type: outputType,
            payload: undefined,
          };
        }
      }

      const resolved = resolveTargetId(to, currentState);
      const isFinal = resolved.finalOutcome !== null;
      const effectiveFinalOutcome = isFinal
        ? (outputType ?? resolved.finalOutcome)
        : null;
      const effectiveNextState = (
        isFinal && effectiveFinalOutcome
          ? effectiveFinalOutcome
          : resolved.stateName
      ) as StateUnion;
      const hasFinalPayloadSelector =
        isFinal &&
        (outputSelector !== null ||
          options?.output !== undefined ||
          Boolean(isFinalNode(to) && (to.isBare || !options?.call)));
      const finalPayload = undefined;
      const isTargetAwaiting =
        resolved.isAwaiting || awaitingStates.has(effectiveNextState);

      const exitedSub =
        !resolved.stayed && subMachines.has(currentState)
          ? (subMachines.get(currentState) ?? null)
          : null;
      const isNoOpStay =
        resolved.stayed && !options?.call && !options?.output;

      return {
        matched: true,
        from: currentState,
        via: event,
        nextState: effectiveNextState,
        nextContext,
        callSelector: options?.call ?? null,
        inputSelector,
        inputMapped,
        stayed: resolved.stayed,
        isNoOpStay,
        isAwaiting: resolved.stayed
          ? awaitingStates.has(currentState)
          : isTargetAwaiting,
        finalOutcome: effectiveFinalOutcome,
        finalPayload,
        hasFinalPayloadSelector,
        emittedOutput,
        outputSelector,
        enteredSubMachine: resolved.subMachine,
        exitedSubMachine: exitedSub,
        enteredEach: resolved.eachNode,
        enteredCombinator: resolved.combinatorNode,
      };
    }
    return null;
  };

  const evaluate = (
    currentState: string,
    event: string,
    payload: unknown,
    currentContext: Readonly<EffectiveContext>,
  ): TransitionEvaluation<StateUnion, EffectiveContext, TMethods> => {
    // Pass 1: State-specific rows `[currentState, event, ...]` (First-Match-Wins)
    const specificMatch = evaluateRowList(
      config.transitions,
      currentState,
      event,
      payload,
      currentContext,
      false,
    );
    if (specificMatch) {
      return specificMatch;
    }

    // Pass 2: Fallback global wildcard rows `[anyState(), event, ...]` (First-Match-Wins)
    const wildcardMatch = evaluateRowList(
      config.transitions,
      currentState,
      event,
      payload,
      currentContext,
      true,
    );
    if (wildcardMatch) {
      return wildcardMatch;
    }

    return {
      matched: false,
      from: currentState,
      via: event,
      nextState: currentState as StateUnion,
      nextContext: { ...currentContext } as EffectiveContext,
      callSelector: null,
      inputSelector: null,
      inputMapped: null,
      stayed: false,
      isAwaiting: awaitingStates.has(currentState),
      finalOutcome: null,
      finalPayload: undefined,
      hasFinalPayloadSelector: false,
      emittedOutput: null,
      outputSelector: null,
      enteredSubMachine: null,
      exitedSubMachine: null,
      enteredEach: null,
      enteredCombinator: null,
    };
  };

  return Object.freeze({
    id: config.id,
    initial: config.initial,
    context: (config.context ?? {}) as unknown as EffectiveContext,
    events: (config.events ?? {}) as TEvents,
    transitions: config.transitions,
    states,
    awaitingStates,
    awaitingCallSelectors,
    subMachines,
    eachNodes,
    combinatorNodes,
    evaluate,
    hasTransitionFor,
  });
}

/**
 * Curried FSM creator with Named `FSMContract` (Single Canonical API):
 * Zero dummy JSON objects (`events: {} as ...` or `context: { ... }` are not needed).
 * Any machine created with `createFSM` can be mounted as a root machine or used
 * directly as a hierarchical sub-machine in a parent matrix.
 */
export function createFSM<
  TContract extends FSMContract = EmptyObject,
>(): <
  const TId extends string,
  const TInitial extends ContractStates<TContract>,
  const TTransitions extends readonly TransitionRow<
    ContractContext<TContract>,
    Extract<keyof ContractEvents<TContract>, string>,
    ContractStates<TContract>,
    ContractMethods<TContract>,
    ContractOutput<TContract>
  >[],
>(
  config: FSMConfig<
    TId,
    TInitial,
    ContractContext<TContract>,
    ContractEvents<TContract>,
    TTransitions &
      ValidateTransitionRows<
        TTransitions,
        ContractContext<TContract>,
        Extract<keyof ContractEvents<TContract>, string>,
        ContractMethods<TContract>,
        ContractOutput<TContract>,
        ContractEvents<TContract>
      >,
    ContractStates<TContract>,
    ContractMethods<TContract>
  >,
) => FSMDefinition<
  TId,
  TInitial,
  ResolveContext<ContractContext<TContract>, TTransitions>,
  ContractEvents<TContract>,
  TTransitions,
  ContractMethods<TContract>,
  ContractInput<TContract>,
  ContractOutput<TContract>
> {
  return (curriedConfig: FSMConfig<any, any, any, any, any, any, any>) =>
    buildFSM(curriedConfig) as any;
}
