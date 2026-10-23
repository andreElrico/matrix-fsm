/**
 * @matrix-fsm/core - Pure TypeScript Machine Runner (0% Angular)
 */

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
}

export interface MachineInstanceHooks<TFSM extends AnyFSMDefinition> {
  readonly initialContext?: Partial<ExtractContext<TFSM>>;
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
  /**
   * Optional callback invoked whenever a transition applies a pure `patch`.
   */
  readonly onPatch?: (patch: Partial<ExtractContext<TFSM>>) => void;
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
    ...(hooks?.initialContext ?? {}),
  };
  let activeSubMachine: MachineInstance<any> | null = null;
  let activeSubRef: SubMachineRef<any, any> | null = null;
  let doneOutcome: string | null = null;
  let donePayload: unknown = undefined;

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
      onEnter: hooks?.onEnter as any,
      onExit: hooks?.onExit as any,
      onPatch: (patch) => {
        currentContext = { ...currentContext, ...patch };
        hooks?.onPatch?.(patch);
      },
      onStateChange: (_childState, childCtx, childInfo) => {
        if (childInfo.emittedOutput && activeSubRef) {
          const refId = activeSubRef.id;
          const outType = childInfo.emittedOutput.type;
          const outPayload = childInfo.emittedOutput.payload;
          if (!fsm.hasTransitionFor(refId, outType)) {
            throw new Error(
              `[MatrixFSM Error]: Sub-machine '${refId}' emitted output '${outType}', but parent '${fsm.id}' has no matching transition. Prevented silent deadlock!`,
            );
          }
          send(outType, outPayload);
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
            send(outcome, outputPayload);
          } else {
            throw new Error(
              `[MatrixFSM Error]: Sub-machine '${refToExit.id}' emitted output '${outcome}', but parent '${fsm.id}' has no matching transition. Prevented silent deadlock!`,
            );
          }
        }
      },
    });
  };

  const send = (event: string, payload?: unknown): void => {
    // 1. If inside a subMachine:
    //    - Cooperative Cancel / Child Event Priority: if child handles `event` in its current state, delegate first.
    //    - Fallback / Hard Kill / Output Event: if parent handles `[subMachine, event, ...]`, evaluate parent transition.
    if (activeSubMachine && activeSubRef) {
      if (
        activeSubRef.machine.hasTransitionFor(activeSubMachine.state(), event)
      ) {
        activeSubMachine.patchContext(readEffectiveContext());
        activeSubMachine.send(event, payload);
        return;
      } else if (!fsm.hasTransitionFor(activeSubRef.id, event)) {
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
      return;
    }

    // If leaving an active subMachine (not staying), clean it up and fire its onExit hook
    if (!evaluation.stayed && activeSubMachine && activeSubRef) {
      const subState = activeSubMachine.state();
      activeSubMachine = null;
      activeSubRef = null;
      hooks?.onExit?.[subState]?.(readEffectiveContext());
    }

    currentContext = evaluation.nextContext;
    if (evaluation.patchApplied) {
      hooks?.onPatch?.(evaluation.patchApplied);
    }

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
    }

    if (evaluation.stayed) {
      hooks?.onStateChange?.(currentState, readEffectiveContext(), {
        stayed: true,
        isPending: isPending(),
        isDone: isDone(),
        finalOutcome: doneOutcome,
        finalPayload: donePayload,
        hasFinalPayloadSelector: false,
        emittedOutput: evaluation.emittedOutput,
        enteredSubMachine: null,
        exitedSubMachine: null,
      });
      return;
    }

    // Standard state transition
    hooks?.onExit?.[prevState]?.(readEffectiveContext());
    currentState = evaluation.nextState;

    if (evaluation.finalOutcome !== null) {
      doneOutcome = evaluation.finalOutcome;
      donePayload = evaluation.hasFinalPayloadSelector
        ? evaluation.finalPayload
        : readEffectiveContext();
    }

    if (evaluation.enteredSubMachine) {
      enterSubMachineIfNeeded(
        evaluation.enteredSubMachine,
        evaluation.inputMapped,
      );
    }

    hooks?.onEnter?.[currentState]?.(readEffectiveContext());
    hooks?.onStateChange?.(currentState, readEffectiveContext(), {
      stayed: false,
      isPending: isPending(),
      isDone: isDone(),
      finalOutcome: doneOutcome,
      finalPayload: evaluation.finalPayload,
      hasFinalPayloadSelector: evaluation.hasFinalPayloadSelector,
      emittedOutput: evaluation.emittedOutput,
      enteredSubMachine: evaluation.enteredSubMachine,
      exitedSubMachine: evaluation.exitedSubMachine,
    });
  };

  const patchContext = (patch: Partial<TContext>): void => {
    currentContext = { ...currentContext, ...patch };
  };

  const reset = (): void => {
    activeSubMachine = null;
    activeSubRef = null;
    doneOutcome = null;
    donePayload = undefined;
    currentState = fsm.initial as TState;
    currentContext = {
      ...fsm.context,
      ...(hooks?.initialContext ?? {}),
    };
  };

  return {
    id: fsm.id,
    state: () => currentState,
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
  };
}
