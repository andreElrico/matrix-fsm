/**
 * @matrix-fsm/core - Pure TypeScript Machine Runner (0% Angular)
 */

import { resolveSourceId } from './fsm.js';
import { isAfterNode } from './primitives.js';
import type {
  AnyFSMDefinition,
  ExtractContext,
  ExtractMethods,
  ExtractStates,
  SubMachineRef,
  TransitionCallSelector,
} from './types.js';

export interface MachineInstance<TFSM extends AnyFSMDefinition = AnyFSMDefinition> {
  readonly id: string;
  readonly state: () => ExtractStates<TFSM>;
  readonly getState: () => ExtractStates<TFSM>;
  readonly subState: () => string | null;
  readonly subContext: () => Readonly<Record<string, unknown>> | null;
  readonly context: () => Readonly<ExtractContext<TFSM>>;
  readonly isPending: () => boolean;
  readonly isDone: () => boolean;
  readonly finalOutcome: () => string | null;
  readonly finalPayload?: () => unknown;
  readonly send: (event: string, payload?: unknown) => void;
  readonly patchContext: (patch: Partial<ExtractContext<TFSM>>) => void;
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
  let currentContext: TContext = {
    ...fsm.context,
    ...(hooks?.context ?? {}),
    ...(hooks?.initialContext ?? {}),
  };
  let activeSubMachine: MachineInstance<any> | null = null;
  let activeSubRef: SubMachineRef<any, any> | null = null;
  let doneOutcome: string | null = null;
  let donePayload: unknown = undefined;
  const eventQueue: Array<{
    event: string;
    payload: unknown;
    fromChildOutput: boolean;
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

  const scheduleStateTimers = (stateName: string): void => {
    clearActiveTimers();
    const scheduledIds = new Set<string>();
    for (const row of fsm.transitions) {
      const [from, via] = row as unknown as readonly [unknown, unknown];
      if (
        resolveSourceId(from) === stateName &&
        isAfterNode(via) &&
        !scheduledIds.has(via.id)
      ) {
        scheduledIds.add(via.id);
        const timerId = setTimeout(() => {
          sendInternal(via.id, undefined, false);
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
          sendInternal(outType, outPayload, true);
        }
        if (childInfo.isDone) {
          const outcome = childInfo.finalOutcome ?? 'DONE';
          const outputPayload = childInfo.hasFinalPayloadSelector
            ? childInfo.finalPayload
            : childCtx;
          const refToExit = activeSubRef;
          activeSubMachine = null;
          activeSubRef = null;
          if (!refToExit) {
            return;
          }
          if (fsm.hasTransitionFor(refToExit.id, outcome)) {
            sendInternal(outcome, outputPayload, true);
          } else {
            throw new Error(
              `[MatrixFSM Error]: Sub-machine '${refToExit.id}' emitted output '${outcome}', but parent '${fsm.id}' has no matching transition. Prevented silent deadlock!`,
            );
          }
        }
      },
    });
  };

  const processOneEvent = (
    event: string,
    payload?: unknown,
    fromChildOutput = false,
  ): void => {
    // 1. If inside a subMachine:
    //    - Cooperative Cancel / Child Event Priority: if child handles `event` in its current state, delegate first.
    //    - Fallback / Hard Kill / Output Event: if parent handles `[subMachine, event, ...]`, evaluate parent transition.
    if (!fromChildOutput && activeSubMachine && activeSubRef) {
      if (
        activeSubRef.machine.hasTransitionFor(activeSubMachine.state(), event)
      ) {
        activeSubMachine.patchContext(readEffectiveContext());
        activeSubMachine.send(event, payload);
        return;
      } else if (!fsm.hasTransitionFor(activeSubRef.id, event)) {
        debugLog?.(
          `[MatrixFSM:${fsm.id}] Ignored event '${event}' in state '${currentState}'`,
        );
        return;
      }
    }

    const prevState = currentState;
    const effectiveCtx = readEffectiveContext();
    const evaluation = fsm.evaluate(
      currentState,
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

    debugLog?.(
      `[MatrixFSM:${fsm.id}] Transition '${prevState}' --(${event})--> '${evaluation.nextState}'`,
    );

    // If leaving an active subMachine (not staying), clean it up and fire its onExit hook
    if (!evaluation.stayed && activeSubMachine && activeSubRef) {
      const subState = activeSubMachine.state();
      activeSubMachine.destroy();
      activeSubMachine = null;
      activeSubRef = null;
      hooks?.onExit?.[subState]?.(readEffectiveContext());
    }

    if (!evaluation.stayed) {
      clearActiveTimers();
      hooks?.onExit?.[prevState]?.(readEffectiveContext());
      currentState = evaluation.nextState;
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
    const resolvedEmittedOutput = evaluation.emittedOutput
      ? {
          type: evaluation.emittedOutput.type,
          payload: evaluation.outputSelector
            ? evaluation.outputSelector(effectiveCtxAfterMutations, payload)
            : evaluation.emittedOutput.payload,
        }
      : null;
    const resolvedFinalPayload = evaluation.hasFinalPayloadSelector
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
        evaluation.inputMapped,
      );
    }

    hooks?.onEnter?.[currentState]?.(readEffectiveContext());
    scheduleStateTimers(currentState);
    hooks?.onStateChange?.(currentState, readEffectiveContext(), {
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

  const sendInternal = (
    event: string,
    payload?: unknown,
    fromChildOutput = false,
  ): void => {
    eventQueue.push({ event, payload, fromChildOutput });
    if (isProcessing) {
      return;
    }
    isProcessing = true;
    try {
      while (eventQueue.length > 0) {
        const next = eventQueue.shift()!;
        processOneEvent(next.event, next.payload, next.fromChildOutput);
      }
    } finally {
      isProcessing = false;
    }
  };

  const send = (event: string, payload?: unknown): void => {
    sendInternal(event, payload, false);
  };

  const patchContext = (patch: Partial<TContext>): void => {
    currentContext = { ...currentContext, ...patch };
    if (activeSubMachine) {
      activeSubMachine.patchContext(patch as Record<string, unknown>);
    }
  };

  const destroy = (): void => {
    clearActiveTimers();
    eventQueue.length = 0;
    isProcessing = false;
    if (activeSubMachine) {
      activeSubMachine.destroy();
      activeSubMachine = null;
      activeSubRef = null;
    }
  };

  const reset = (): void => {
    destroy();
    doneOutcome = null;
    donePayload = undefined;
    currentState = fsm.initial as TState;
    currentContext = {
      ...fsm.context,
      ...(hooks?.context ?? {}),
      ...(hooks?.initialContext ?? {}),
    };
    scheduleStateTimers(currentState);
  };

  scheduleStateTimers(currentState);

  return {
    id: fsm.id,
    state: () => currentState,
    getState: () => currentState,
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
    reset,
    destroy,
  };
}
