/**
 * @matrix-fsm/core - Pure TypeScript Machine Runner (0% Angular)
 */

import { resolveSourceId } from './fsm.js';
import {
  isAfterNode,
  MAX_SYNC_MICROSTEPS,
  MatrixFsmInfiniteLoopError,
} from './primitives.js';
import type {
  AnyFSMDefinition,
  CombinatorNode,
  ExtractContext,
  ExtractMethods,
  ExtractStates,
  SubMachineRef,
  TransitionCallSelector,
} from './types.js';

export interface MachineSnapshot<TFSM extends AnyFSMDefinition = AnyFSMDefinition> {
  readonly state: ExtractStates<TFSM>;
  readonly context: Readonly<ExtractContext<TFSM>>;
  readonly stateEpoch: number;
  readonly children?: Readonly<Record<string, MachineSnapshot<any>>>;
}

export interface InspectEvent<TFSM extends AnyFSMDefinition = AnyFSMDefinition> {
  readonly machineId: string;
  readonly from: string;
  readonly via: string;
  readonly to: string;
  readonly payload: unknown;
  readonly nextContext: Readonly<ExtractContext<TFSM>>;
  readonly timestamp: number;
}

export type InspectCallback<TFSM extends AnyFSMDefinition = AnyFSMDefinition> = (
  event: InspectEvent<TFSM>,
) => void;

export interface MachineInstance<TFSM extends AnyFSMDefinition = AnyFSMDefinition> {
  readonly id: string;
  readonly state: () => ExtractStates<TFSM>;
  readonly getState: () => ExtractStates<TFSM>;
  readonly epoch: number;
  readonly stateEpoch: () => number;
  readonly subState: () => string | null;
  readonly subContext: () => Readonly<Record<string, unknown>> | null;
  readonly context: () => Readonly<ExtractContext<TFSM>>;
  readonly isPending: () => boolean;
  readonly isDone: () => boolean;
  readonly finalOutcome: () => string | null;
  readonly finalPayload?: () => unknown;
  readonly send: (event: string, payload?: unknown) => void;
  readonly patchContext: (patch: Partial<ExtractContext<TFSM>>) => void;
  readonly getSnapshot: () => MachineSnapshot<TFSM>;
  readonly restoreSnapshot: (snapshot: MachineSnapshot<TFSM>) => void;
  readonly reset: () => void;
  readonly destroy: () => void;
}

export type DebugLogger =
  | boolean
  | ((message: string, details?: unknown) => void);

export function resolveDebugLogger(
  debug?: DebugLogger,
): ((message: string, details?: unknown) => void) | null {
  if (typeof debug === 'function') {
    return debug;
  }
  if (debug === true) {
    return (msg, details) => {
      if (details !== undefined) {
        console.debug(msg, details);
      } else {
        console.debug(msg);
      }
    };
  }
  return null;
}

export interface MachineInstanceHooks<TFSM extends AnyFSMDefinition> {
  readonly initialContext?: Partial<ExtractContext<TFSM>>;
  readonly context?: Partial<ExtractContext<TFSM>>;
  readonly debug?: DebugLogger;
  readonly inspect?: InspectCallback<TFSM>;
  /**
   * Optional method map or store reference used to resolve `{ call: (m) => m.methodName }`
   * during transitions.
   */
  readonly methods?:
    | Partial<ExtractMethods<TFSM>>
    | Record<string, (...args: any[]) => any>;
  /**
   * Optional dynamic context provider (e.g., SignalStore's live state getter).
   */
  readonly getContext?: () => ExtractContext<TFSM>;
  readonly onStateChange?: (
    state: ExtractStates<TFSM>,
    context: Readonly<ExtractContext<TFSM>>,
    info: {
      stayed: boolean;
      isPending: boolean;
      isDone: boolean;
      finalOutcome: string | null;
      finalPayload?: unknown;
      hasFinalPayloadSelector?: boolean;
      emittedOutput?: { readonly type: string; readonly payload: unknown } | null;
      enteredSubMachine: SubMachineRef<any, any> | null;
      exitedSubMachine: SubMachineRef<any, any> | null;
    },
  ) => void;
  readonly onEnter?: Partial<
    Record<string, (ctx: Readonly<ExtractContext<TFSM>>) => void>
  >;
  readonly onExit?: Partial<
    Record<string, (ctx: Readonly<ExtractContext<TFSM>>) => void>
  >;
}

export function invokeCallSelector<TContext>(
  callSelector: TransitionCallSelector<any, any, TContext> | null,
  methodsTarget: Record<string, any> | undefined,
  payload: unknown,
  context: Readonly<TContext>,
): void {
  if (!callSelector || !methodsTarget) {
    return;
  }
  const fn =
    typeof callSelector === 'function'
      ? callSelector(methodsTarget)
      : methodsTarget[callSelector];
  if (typeof fn === 'function') {
    fn.call(methodsTarget, payload, context);
  }
}

/**
 * Creates a standalone, framework-agnostic state machine instance from a pure `FSMDefinition`.
 */
export function createMachineInstance<TFSM extends AnyFSMDefinition>(
  fsm: TFSM,
  hooks?: MachineInstanceHooks<TFSM>,
): MachineInstance<TFSM> {
  type TState = ExtractStates<TFSM>;
  type TContext = ExtractContext<TFSM>;

  let currentState: TState = fsm.initial as TState;
  let stateEpoch = 0;
  let currentContext: TContext = {
    ...fsm.context,
    ...(hooks?.context ?? {}),
    ...(hooks?.initialContext ?? {}),
  };
  let activeSubMachine: MachineInstance<any> | null = null;
  let activeSubRef: SubMachineRef<any, any> | null = null;
  let activeCombinator: {
    readonly node: CombinatorNode<any, any>;
    readonly instances: MachineInstance<any>[];
    readonly failedIndices: Set<number>;
  } | null = null;
  let doneOutcome: string | null = null;
  let donePayload: unknown = undefined;
  const eventQueue: Array<{
    event: string;
    payload: unknown;
    fromChildOutput: boolean;
    fromChildTerminal: boolean;
    sourceStateOverride?: string;
  }> = [];
  let isProcessing = false;
  const activeTimers: Array<ReturnType<typeof setTimeout>> = [];
  const debugLog = resolveDebugLogger(hooks?.debug);

  const clearActiveTimers = (): void => {
    for (const timer of activeTimers) {
      clearTimeout(timer);
    }
    activeTimers.length = 0;
  };

  const destroyActiveCombinator = (): void => {
    if (!activeCombinator) {
      return;
    }
    const combToDestroy = activeCombinator;
    activeCombinator = null;
    for (const inst of combToDestroy.instances) {
      inst.destroy();
    }
  };

  const scheduleStateTimers = (stateName: string): void => {
    clearActiveTimers();
    const entryEpoch = stateEpoch;
    const scheduledIds = new Set<string>();
    for (const row of fsm.transitions) {
      const [from, via] = row as unknown as readonly [unknown, unknown];
      const srcId = resolveSourceId(from);
      if (
        (srcId === stateName || srcId === '*') &&
        isAfterNode(via) &&
        !scheduledIds.has(via.id)
      ) {
        scheduledIds.add(via.id);
        const timerId = setTimeout(() => {
          if (!isDestroyed && stateEpoch === entryEpoch && currentState === stateName) {
            sendInternal(via.id, undefined, false, false);
          }
        }, via.ms);
        activeTimers.push(timerId);
      }
    }
  };

  const readEffectiveContext = (): TContext => {
    if (hooks?.getContext) {
      return hooks.getContext();
    }
    return currentContext;
  };

  const isPending = (): boolean => {
    if (activeSubMachine) {
      return activeSubMachine.isPending();
    }
    if (activeCombinator) {
      return activeCombinator.instances.some((inst) => inst.isPending());
    }
    return fsm.awaitingStates.has(currentState);
  };

  const isDone = (): boolean => doneOutcome !== null;

  const enterSubMachineIfNeeded = (
    subRef: SubMachineRef<any, any> | null,
    inputMapped?: Record<string, unknown> | null,
  ) => {
    if (!subRef) {
      return;
    }
    activeSubRef = subRef;
    activeSubMachine = createMachineInstance(subRef.machine, {
      initialContext: {
        ...readEffectiveContext(),
        ...(inputMapped ?? {}),
      },
      methods: hooks?.methods,
      debug: hooks?.debug,
      onEnter: hooks?.onEnter as any,
      onExit: hooks?.onExit as any,
      onStateChange: (_childState, childCtx, childInfo) => {
        if (!childInfo.isDone && childInfo.emittedOutput && activeSubRef) {
          const refId = activeSubRef.id;
          const outType = childInfo.emittedOutput.type;
          const outPayload = childInfo.emittedOutput.payload;
          if (!fsm.hasTransitionFor(refId, outType)) {
            throw new Error(
              `[MatrixFSM Error]: Sub-machine '${refId}' emitted output '${outType}', but parent '${fsm.id}' has no matching transition. Prevented silent deadlock!`,
            );
          }
          sendInternal(outType, outPayload, true, false);
        }
        if (childInfo.isDone) {
          const outcome = childInfo.finalOutcome ?? 'DONE';
          const outputPayload = childInfo.hasFinalPayloadSelector
            ? childInfo.finalPayload
            : childCtx;
          const refToExit = activeSubRef;
          const subToDestroy = activeSubMachine;
          activeSubMachine = null;
          activeSubRef = null;
          subToDestroy?.destroy();
          if (!refToExit) {
            return;
          }
          if (fsm.hasTransitionFor(refToExit.id, outcome)) {
            sendInternal(outcome, outputPayload, true, true);
          } else {
            throw new Error(
              `[MatrixFSM Error]: Sub-machine '${refToExit.id}' emitted output '${outcome}', but parent '${fsm.id}' has no matching transition. Prevented silent deadlock!`,
            );
          }
        }
      },
    });
  };

  const enterCombinatorIfNeeded = (
    combNode: CombinatorNode<any, any> | null | undefined,
    inputMapped?: Record<string, unknown> | null,
  ) => {
    if (!combNode) {
      return;
    }
    destroyActiveCombinator();
    const instances: MachineInstance<any>[] = [];
    const failedIndices = new Set<number>();
    const failedErrors: unknown[] = new Array(combNode.machines.length);
    const activeCombState = {
      node: combNode,
      instances,
      failedIndices,
    };
    activeCombinator = activeCombState;

    const dispatchCombinatorExit = (
      preferredOutcome: string,
      outputPayload: unknown,
    ) => {
      const combId = combNode.id;
      destroyActiveCombinator();
      if (fsm.hasTransitionFor(combId, preferredOutcome)) {
        sendInternal(preferredOutcome, outputPayload, true, true);
      } else if (fsm.hasTransitionFor(combId, 'ALL_DONE')) {
        sendInternal('ALL_DONE', outputPayload, true, true);
      } else if (fsm.hasTransitionFor(combId, 'DONE')) {
        sendInternal('DONE', outputPayload, true, true);
      }
    };

    const childSettled = new Array<boolean>(combNode.machines.length).fill(false);
    const completedOutputs: Record<string, unknown> = {};
    const orderedOutputs: unknown[] = new Array(combNode.machines.length);

    combNode.machines.forEach((childMachine: AnyFSMDefinition, idx: number) => {
      const childInst = createMachineInstance(childMachine, {
        initialContext: {
          ...readEffectiveContext(),
          ...(inputMapped ?? {}),
        },
        methods: hooks?.methods,
        debug: hooks?.debug,
        onEnter: hooks?.onEnter as any,
        onExit: hooks?.onExit as any,
        onStateChange: (_childState, childCtx, childInfo) => {
          if (activeCombinator !== activeCombState) {
            return;
          }
          if (!childInfo.isDone && childInfo.emittedOutput) {
            const outType = childInfo.emittedOutput.type;
            const outPayload = childInfo.emittedOutput.payload;
            if (
              fsm.hasTransitionFor(childMachine.id, outType) ||
              fsm.hasTransitionFor(combNode.id, outType) ||
              fsm.hasTransitionFor('anyState', outType)
            ) {
              sendInternal(
                outType,
                outPayload,
                true,
                false,
                fsm.hasTransitionFor(childMachine.id, outType)
                  ? childMachine.id
                  : undefined,
              );
            }
          }
          if (!childInfo.isDone || childSettled[idx]) {
            return;
          }
          childSettled[idx] = true;
          const outcome = childInfo.finalOutcome ?? 'DONE';
          const childPayload = childInfo.hasFinalPayloadSelector
            ? childInfo.finalPayload
            : childCtx;

          // Immediately tear down the finished child!
          instances[idx]?.destroy();

          if (combNode.__type === 'all') {
            completedOutputs[childMachine.id] = childPayload;
            orderedOutputs[idx] = childPayload;

            if (fsm.hasTransitionFor(childMachine.id, outcome)) {
              sendInternal(outcome, childPayload, true, false, childMachine.id);
              if (activeCombinator !== activeCombState) {
                return;
              }
            } else if (outcome === 'ERROR') {
              dispatchCombinatorExit('ERROR', childPayload);
              return;
            }

            if (
              instances.length === combNode.machines.length &&
              childSettled.every(Boolean)
            ) {
              const combId = combNode.id;
              if (
                fsm.hasTransitionFor(combId, 'ALL_DONE') ||
                fsm.hasTransitionFor('anyState', 'ALL_DONE')
              ) {
                dispatchCombinatorExit('ALL_DONE', { ...completedOutputs });
              } else {
                dispatchCombinatorExit('DONE', orderedOutputs);
              }
            }
          } else if (combNode.__type === 'race') {
            if (fsm.hasTransitionFor(childMachine.id, outcome)) {
              destroyActiveCombinator();
              sendInternal(outcome, childPayload, true, true, childMachine.id);
              return;
            }
            dispatchCombinatorExit(outcome, childPayload);
          } else if (combNode.__type === 'any') {
            if (outcome === 'ERROR') {
              failedIndices.add(idx);
              failedErrors[idx] = childPayload;
              if (failedIndices.size === combNode.machines.length) {
                dispatchCombinatorExit('ERROR', failedErrors);
              }
            } else {
              if (fsm.hasTransitionFor(childMachine.id, outcome)) {
                destroyActiveCombinator();
                sendInternal(outcome, childPayload, true, true, childMachine.id);
                return;
              }
              dispatchCombinatorExit(outcome, childPayload);
            }
          }
        },
      });
      instances.push(childInst);
    });
  };

  const processOneEvent = (
    event: string,
    payload?: unknown,
    fromChildOutput = false,
    fromChildTerminal = false,
    sourceStateOverride?: string,
  ): void => {
    // 1. If inside a subMachine:
    //    - Cooperative Cancel / Child Event Priority: if child handles `event` in its current state, delegate first.
    //    - Fallback / Hard Kill / Output Event: if parent handles `[subMachine, event, ...]` or `[anyState(), event, ...]`, evaluate parent transition.
    if (!fromChildOutput && activeSubMachine && activeSubRef) {
      if (
        activeSubRef.machine.hasTransitionFor(activeSubMachine.state(), event)
      ) {
        activeSubMachine.patchContext(readEffectiveContext());
        activeSubMachine.send(event, payload);
        return;
      }
    }

    if (
      !fromChildOutput &&
      activeCombinator &&
      !fsm.hasTransitionFor(activeCombinator.node.id, event)
    ) {
      let handledByAny = false;
      for (let i = 0; i < activeCombinator.instances.length; i++) {
        const inst = activeCombinator.instances[i];
        const childMach = activeCombinator.node.machines[i];
        if (!inst.isDone() && childMach.hasTransitionFor(inst.state(), event)) {
          handledByAny = true;
          inst.patchContext(readEffectiveContext());
          inst.send(event, payload);
        }
      }
      if (handledByAny) {
        return;
      }
    }

    const prevState = currentState;
    const effectiveFromState = sourceStateOverride ?? currentState;
    const effectiveCtx = readEffectiveContext();
    const evaluation = fsm.evaluate(
      effectiveFromState,
      event,
      payload,
      effectiveCtx,
    );

    if (!evaluation.matched) {
      debugLog?.(
        `[MatrixFSM:${fsm.id}] Ignored event '${event}' in state '${prevState}'`,
      );
      return;
    }

    if (fromChildTerminal && evaluation.stayed) {
      throw new Error(
        `[MatrixFSM Error]: Sub-machine '${prevState}' terminated with final output '${event}', but parent '${fsm.id}' responded with stay(). A parent must transition to a new state when a sub-machine reaches finalState()!`,
      );
    }

    debugLog?.(
      `[MatrixFSM:${fsm.id}] Transition '${prevState}' --(${event})--> '${evaluation.nextState}'`,
    );

    // If leaving an active subMachine or combinator (not staying), clean it up and fire its onExit hook
    if (!evaluation.stayed && activeSubMachine && activeSubRef) {
      const subState = activeSubMachine.state();
      activeSubMachine.destroy();
      activeSubMachine = null;
      activeSubRef = null;
      hooks?.onExit?.[subState]?.(readEffectiveContext());
    }
    if (!evaluation.stayed && activeCombinator) {
      destroyActiveCombinator();
    }

    if (!evaluation.stayed) {
      clearActiveTimers();
      hooks?.onExit?.[prevState]?.(readEffectiveContext());
      currentState = evaluation.nextState;
      stateEpoch++;
    }

    currentContext = evaluation.nextContext;

    if (evaluation.callSelector) {
      invokeCallSelector(
        evaluation.callSelector,
        hooks?.methods as Record<string, any> | undefined,
        payload,
        readEffectiveContext(),
      );
      if (hooks?.getContext) {
        currentContext = hooks.getContext();
      }
      if (activeSubMachine && !fromChildOutput) {
        currentContext = {
          ...currentContext,
          ...(activeSubMachine.context() as Record<string, unknown>),
        };
      }
    }

    const effectiveCtxAfterMutations = readEffectiveContext();
    const resolvedInputMapped = evaluation.inputSelector
      ? evaluation.inputSelector(effectiveCtxAfterMutations, payload)
      : evaluation.inputMapped;
    const resolvedEmittedOutput = evaluation.emittedOutput
      ? {
          type: evaluation.emittedOutput.type,
          payload: evaluation.outputSelector
            ? evaluation.outputSelector(effectiveCtxAfterMutations, payload)
            : evaluation.emittedOutput.payload,
        }
      : null;
    const resolvedFinalPayload = evaluation.outputSelector
      ? resolvedEmittedOutput?.payload
      : evaluation.finalPayload;

    if (resolvedEmittedOutput) {
      debugLog?.(
        `[MatrixFSM:${fsm.id}] Output '${resolvedEmittedOutput.type}'`,
        resolvedEmittedOutput.payload,
      );
    } else if (evaluation.finalOutcome !== null) {
      debugLog?.(`[MatrixFSM:${fsm.id}] Output '${evaluation.finalOutcome}'`);
    }

    if (evaluation.stayed) {
      hooks?.inspect?.({
        machineId: fsm.id,
        from: prevState,
        via: event,
        to: currentState,
        payload,
        nextContext: effectiveCtxAfterMutations,
        timestamp: Date.now(),
      });
      hooks?.onStateChange?.(currentState, effectiveCtxAfterMutations, {
        stayed: true,
        isPending: isPending(),
        isDone: isDone(),
        finalOutcome: doneOutcome,
        finalPayload: donePayload,
        hasFinalPayloadSelector: false,
        emittedOutput: resolvedEmittedOutput,
        enteredSubMachine: null,
        exitedSubMachine: null,
      });
      return;
    }

    if (evaluation.finalOutcome !== null) {
      doneOutcome = evaluation.finalOutcome;
      donePayload = evaluation.hasFinalPayloadSelector
        ? resolvedFinalPayload
        : readEffectiveContext();
    }

    if (evaluation.enteredSubMachine) {
      enterSubMachineIfNeeded(
        evaluation.enteredSubMachine,
        resolvedInputMapped,
      );
    }

    if (evaluation.enteredCombinator) {
      enterCombinatorIfNeeded(
        evaluation.enteredCombinator,
        resolvedInputMapped,
      );
    }

    hooks?.onEnter?.[currentState]?.(readEffectiveContext());
    scheduleStateTimers(currentState);
    if (
      !isDone() &&
      (fsm.hasTransitionFor(currentState, '__always__') ||
        fsm.hasTransitionFor('*', '__always__'))
    ) {
      eventQueue.unshift({
        event: '__always__',
        payload: undefined,
        fromChildOutput: false,
        fromChildTerminal: false,
      });
    }
    const finalEffectiveCtx = readEffectiveContext();
    hooks?.inspect?.({
      machineId: fsm.id,
      from: prevState,
      via: event,
      to: currentState,
      payload,
      nextContext: finalEffectiveCtx,
      timestamp: Date.now(),
    });
    hooks?.onStateChange?.(currentState, finalEffectiveCtx, {
      stayed: false,
      isPending: isPending(),
      isDone: isDone(),
      finalOutcome: doneOutcome,
      finalPayload: resolvedFinalPayload,
      hasFinalPayloadSelector: evaluation.hasFinalPayloadSelector,
      emittedOutput:
        evaluation.finalOutcome === null ? resolvedEmittedOutput : null,
      enteredSubMachine: evaluation.enteredSubMachine,
      exitedSubMachine: evaluation.exitedSubMachine,
    });
  };

  let isDestroyed = false;

  const sendInternal = (
    event: string,
    payload?: unknown,
    fromChildOutput = false,
    fromChildTerminal = false,
    sourceStateOverride?: string,
  ): void => {
    if (isDestroyed) {
      return;
    }
    eventQueue.push({
      event,
      payload,
      fromChildOutput,
      fromChildTerminal,
      sourceStateOverride,
    });
    if (isProcessing) {
      return;
    }
    isProcessing = true;
    try {
      let syncMicrosteps = 0;
      while (eventQueue.length > 0) {
        if (syncMicrosteps >= MAX_SYNC_MICROSTEPS) {
          eventQueue.length = 0;
          throw new MatrixFsmInfiniteLoopError(
            fsm.id,
            currentState,
            MAX_SYNC_MICROSTEPS,
          );
        }
        syncMicrosteps++;
        const next = eventQueue.shift()!;
        processOneEvent(
          next.event,
          next.payload,
          next.fromChildOutput,
          next.fromChildTerminal,
          next.sourceStateOverride,
        );
      }
    } finally {
      isProcessing = false;
    }
  };

  const send = (event: string, payload?: unknown): void => {
    sendInternal(event, payload, false, false);
  };

  const patchContext = (patch: Partial<TContext>): void => {
    currentContext = { ...currentContext, ...patch };
    if (activeSubMachine) {
      activeSubMachine.patchContext(patch as Record<string, unknown>);
    }
  };

  const destroy = (): void => {
    isDestroyed = true;
    clearActiveTimers();
    eventQueue.length = 0;
    isProcessing = false;
    if (activeSubMachine) {
      activeSubMachine.destroy();
      activeSubMachine = null;
      activeSubRef = null;
    }
    destroyActiveCombinator();
  };

  const getSnapshot = (): MachineSnapshot<TFSM> => {
    const children: Record<string, MachineSnapshot<any>> = {};
    if (activeSubMachine && activeSubRef) {
      children[activeSubRef.id] = activeSubMachine.getSnapshot();
    }
    if (activeCombinator) {
      activeCombinator.instances.forEach(
        (child: MachineInstance<any>, idx: number) => {
          const childFSM = activeCombinator!.node.machines[idx];
          if (child && childFSM) {
            children[childFSM.id] = child.getSnapshot();
          }
        },
      );
    }
    return {
      state: currentState,
      context: { ...readEffectiveContext() },
      stateEpoch,
      ...(Object.keys(children).length > 0 ? { children } : {}),
    };
  };

  const restoreSnapshot = (snapshot: MachineSnapshot<TFSM>): void => {
    clearActiveTimers();
    eventQueue.length = 0;
    if (activeSubMachine) {
      activeSubMachine.destroy();
      activeSubMachine = null;
      activeSubRef = null;
    }
    destroyActiveCombinator();
    doneOutcome = null;
    donePayload = undefined;
    currentState = snapshot.state;
    currentContext = {
      ...fsm.context,
      ...(snapshot.context as TContext),
    };
    stateEpoch = Math.max(stateEpoch + 1, snapshot.stateEpoch);
    const subRef = fsm.subMachines.get(currentState);
    if (subRef) {
      enterSubMachineIfNeeded(subRef, currentContext);
      const childSnap = snapshot.children?.[subRef.id];
      const spawnedSub = activeSubMachine as MachineInstance<any> | null;
      if (childSnap && spawnedSub) {
        spawnedSub.restoreSnapshot(childSnap);
      }
    }
    const combNode = fsm.combinatorNodes?.get(currentState);
    if (combNode) {
      enterCombinatorIfNeeded(combNode, currentContext);
    }
    scheduleStateTimers(currentState);
    if (
      fsm.hasTransitionFor(currentState, '__always__') ||
      fsm.hasTransitionFor('*', '__always__')
    ) {
      sendInternal('__always__', undefined, false, false);
    }
  };

  const reset = (): void => {
    destroy();
    isDestroyed = false;
    doneOutcome = null;
    donePayload = undefined;
    currentState = fsm.initial as TState;
    stateEpoch++;
    currentContext = {
      ...fsm.context,
      ...(hooks?.context ?? {}),
      ...(hooks?.initialContext ?? {}),
    };
    scheduleStateTimers(currentState);
    if (
      fsm.hasTransitionFor(currentState, '__always__') ||
      fsm.hasTransitionFor('*', '__always__')
    ) {
      sendInternal('__always__', undefined, false, false);
    }
  };

  scheduleStateTimers(currentState);
  if (
    fsm.hasTransitionFor(currentState, '__always__') ||
    fsm.hasTransitionFor('*', '__always__')
  ) {
    sendInternal('__always__', undefined, false, false);
  }

  return {
    id: fsm.id,
    state: () => currentState,
    getState: () => currentState,
    get epoch() {
      return stateEpoch;
    },
    stateEpoch: () => stateEpoch,
    subState: () => (activeSubMachine ? activeSubMachine.state() : null),
    subContext: () =>
      activeSubMachine
        ? (activeSubMachine.context() as Readonly<Record<string, unknown>>)
        : null,
    context: () => readEffectiveContext(),
    isPending,
    isDone,
    finalOutcome: () => doneOutcome,
    finalPayload: () => donePayload,
    send,
    patchContext,
    getSnapshot,
    restoreSnapshot,
    reset,
    destroy,
  };
}
