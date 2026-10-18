/**
 * @matrix-fsm/angular - SignalStore Bridge & Dual Promise / Effect-TS Task Runner
 */

import { computed, DestroyRef, inject, isSignal, signal, untracked, ɵɵdefineInjectable, type Signal } from '@angular/core';
import {
  deepComputed,
  signalStoreFeature,
  withProps,
  type DeepSignalOf,
  type EmptyFeatureResult,
  type SignalStoreFeature,
} from '@ngrx/signals';
import { Cause, Effect, Exit, Fiber } from 'effect';
import {
  createMachineInstance,
  type AnyFSMDefinition,
  type EachNode,
  type ExtractAwaitingNodes,
  type ExtractContext,
  type ExtractEventPayload,
  type ExtractEvents,
  type ExtractStates,
  type MachineInstance,
  type SubMachineRef,
} from '@matrix-fsm/core';

function ensureJitCompilerFacade(): void {
  const g = globalThis as Record<string, any>;
  g['ng'] ??= {};
  g['ng'].ɵcompilerFacade ??= {
    compileFactoryDeclaration(_env: unknown, _url: string, decl: { type: new (...args: any[]) => unknown }) {
      return (...args: any[]) => new decl.type(...args);
    },
    compileInjectableDeclaration(_env: unknown, _url: string, decl: { type: new (...args: any[]) => unknown; providedIn?: any }) {
      return ɵɵdefineInjectable({
        token: decl.type,
        providedIn: decl.providedIn ?? null,
        factory: () => new decl.type(),
      });
    },
  };
}

ensureJitCompilerFacade();

export type TaskResult<TContext> =
  | Promise<Partial<TContext> | void>
  | Effect.Effect<Partial<TContext> | void, any, never>;

export type TaskHandler<TContext> = (
  ctx: Readonly<TContext>,
  signal: AbortSignal,
) => TaskResult<TContext>;

export type TasksMapFor<TFSM extends AnyFSMDefinition> = {
  readonly [K in ExtractAwaitingNodes<TFSM>]: TaskHandler<ExtractContext<TFSM>>;
};

export type SyncContextMap<TContext extends object> = {
  readonly [K in keyof TContext]?: Signal<TContext[K]>;
};

export type StateLifecycleHooks<TFSM extends AnyFSMDefinition> = Partial<
  Record<ExtractStates<TFSM>, (ctx: Readonly<ExtractContext<TFSM>>) => void>
>;

export type StateMachineFeatureConfig<TFSM extends AnyFSMDefinition> = {
  /**
   * Reactive Context Mirroring: syncs external Angular Signals (e.g. from Layer 1 global stores)
   * into the FSM context without tight coupling.
   */
  readonly syncContext?:
    | (() => SyncContextMap<ExtractContext<TFSM>>)
    | SyncContextMap<ExtractContext<TFSM>>;
  /**
   * Optional lifecycle hooks invoked when entering a state.
   */
  readonly onEnter?:
    | (() => StateLifecycleHooks<TFSM>)
    | StateLifecycleHooks<TFSM>;
  /**
   * Optional lifecycle hooks invoked when exiting a state.
   */
  readonly onExit?:
    | (() => StateLifecycleHooks<TFSM>)
    | StateLifecycleHooks<TFSM>;
} & (
  [ExtractAwaitingNodes<TFSM>] extends [never]
    ? {
        readonly tasks?:
          | (() => Record<string, TaskHandler<ExtractContext<TFSM>>>)
          | Record<string, TaskHandler<ExtractContext<TFSM>>>;
      }
    : {
        /**
         * Compile-time enforced Tasks for every `awaiting('...')` state in the FSM.
         */
        readonly tasks:
          | (() => TasksMapFor<TFSM>)
          | TasksMapFor<TFSM>;
      }
);

export interface ChildMachineSnapshot<TContext = any> {
  readonly id: string;
  readonly state: string;
  readonly context: Readonly<TContext>;
  readonly isPending: boolean;
  readonly isDone: boolean;
  readonly finalOutcome: string | null;
}

export type SendFn<TFSM extends AnyFSMDefinition> = <
  TEvent extends ExtractEvents<TFSM> | 'DONE' | 'ERROR' | 'ALL_DONE' | (string & {}),
>(
  ...args: ExtractEventPayload<TFSM, TEvent> extends void | undefined
    ? [event: TEvent, payload?: unknown]
    : unknown extends ExtractEventPayload<TFSM, TEvent>
      ? [event: TEvent, payload?: unknown]
      : [event: TEvent, payload: ExtractEventPayload<TFSM, TEvent>]
) => void;

export interface StateMachineStoreMembers<TFSM extends AnyFSMDefinition> {
  readonly fsmState: Signal<ExtractStates<TFSM>>;
  readonly fsmSubState: Signal<string | null>;
  readonly fsmContext: DeepSignalOf<ExtractContext<TFSM>>;
  readonly isPending: Signal<boolean>;
  readonly childMachines: Signal<Record<string, ReadonlyArray<ChildMachineSnapshot>>>;
  readonly send: SendFn<TFSM>;
  readonly sendToChild: (
    key: string,
    itemId: string,
    event: string,
    payload?: unknown,
  ) => void;
  readonly reset: () => void;
}

interface ActiveTaskHandle {
  readonly stateName: string;
  cancelled: boolean;
  readonly abortController: AbortController;
  fiber: Fiber.Fiber<any, any> | null;
}

function resolveFactoryOrValue<T>(input: (() => T) | T | undefined): T | undefined {
  if (typeof input === 'function') {
    return (input as () => T)();
  }
  return input;
}

function extractItemId(item: unknown): string {
  if (typeof item === 'string' || typeof item === 'number') {
    return String(item);
  }
  if (typeof item === 'object' && item !== null && 'id' in item) {
    return String((item as { id: unknown }).id);
  }
  return JSON.stringify(item);
}

/**
 * Custom `@ngrx/signals` feature that binds a flat-tuple `@matrix-fsm/core` state machine
 * with reactive `syncContext` mirroring and dual Promise / Effect-TS task execution.
 */
export function withStateMachine<TFSM extends AnyFSMDefinition>(
  fsm: TFSM,
  config?: StateMachineFeatureConfig<TFSM>,
): SignalStoreFeature<
  EmptyFeatureResult,
  {
    state: {};
    props: StateMachineStoreMembers<TFSM>;
    methods: {};
  }
> {
  type TState = ExtractStates<TFSM>;
  type TContext = ExtractContext<TFSM>;

  return signalStoreFeature(
    withProps((): StateMachineStoreMembers<TFSM> => {
      const syncedSignals = (resolveFactoryOrValue(config?.syncContext) ?? {}) as Record<
        string,
        Signal<unknown> | undefined
      >;
      const tasksMap = (resolveFactoryOrValue(config?.tasks as any) ?? {}) as Record<
        string,
        TaskHandler<TContext> | undefined
      >;
      const onEnterHooks = (resolveFactoryOrValue(config?.onEnter) ?? {}) as Record<
        string,
        ((ctx: Readonly<TContext>) => void) | undefined
      >;
      const onExitHooks = (resolveFactoryOrValue(config?.onExit) ?? {}) as Record<
        string,
        ((ctx: Readonly<TContext>) => void) | undefined
      >;

      const fsmStateSig = signal<TState>(fsm.initial as TState);
      const fsmSubStateSig = signal<string | null>(null);
      const rawContextSig = signal<TContext>({ ...fsm.context });
      const childMachinesSig = signal<
        Record<string, ReadonlyArray<ChildMachineSnapshot>>
      >({});

      // Reactive merged context: combines internal context with live synced signals
      const fsmContext = deepComputed<TContext>(() => {
        const base = rawContextSig();
        const syncedPatch: Record<string, unknown> = {};
        for (const [key, sig] of Object.entries(syncedSignals)) {
          if (isSignal(sig)) {
            syncedPatch[key] = sig();
          }
        }
        return {
          ...base,
          ...syncedPatch,
        };
      });

      const getEffectiveContext = (): TContext => untracked(() => fsmContext());

      let activeTask: ActiveTaskHandle | null = null;
      let activeSubMachine: MachineInstance<any> | null = null;
      let activeSubRef: SubMachineRef<any, any> | null = null;
      const eachRegistries = new Map<string, Map<string, MachineInstance<any>>>();

      const cancelActiveTask = (): void => {
        if (!activeTask) {
          return;
        }
        const taskToCancel = activeTask;
        activeTask = null;
        taskToCancel.cancelled = true;
        taskToCancel.abortController.abort();
        if (taskToCancel.fiber) {
          const fiberToInterrupt = taskToCancel.fiber;
          taskToCancel.fiber = null;
          Effect.runFork(Fiber.interrupt(fiberToInterrupt));
        }
      };

      // Register automatic cleanup when Angular destroys the store
      try {
        const destroyRef = inject(DestroyRef, { optional: true });
        destroyRef?.onDestroy(() => {
          cancelActiveTask();
        });
      } catch {
        // Store instantiated outside of Angular DI context; manual reset() still cleans up
      }

      const isPending = computed<boolean>(() => {
        const currentState = fsmStateSig();
        const subState = fsmSubStateSig();
        if (activeSubRef && subState) {
          return activeSubRef.machine.awaitingStates.has(subState);
        }
        return fsm.awaitingStates.has(currentState);
      });

      const handleTaskSuccess = (
        handle: ActiveTaskHandle,
        output: Partial<TContext> | void,
      ): void => {
        if (handle.cancelled || activeTask !== handle) {
          return;
        }
        activeTask = null;

        // 1. Pre-DONE context patching: merge task output into context BEFORE 'DONE' guards evaluate!
        if (output && typeof output === 'object') {
          rawContextSig.update((prev) => ({
            ...prev,
            ...output,
          }));
        }

        // 2. Dispatch 'DONE' with output as payload
        dispatchInternal('DONE', output);
      };

      const handleTaskFailure = (
        handle: ActiveTaskHandle,
        err: unknown,
      ): void => {
        if (handle.cancelled || activeTask !== handle) {
          return;
        }
        activeTask = null;

        const activeMachine = activeSubRef ? activeSubRef.machine : fsm;
        const activeStateName = activeSubRef
          ? (fsmSubStateSig() ?? fsmStateSig())
          : fsmStateSig();

        // Check if err is an Effect TaggedError (`'_tag' in err`) and machine defines `[currentState, err._tag]`
        if (
          typeof err === 'object' &&
          err !== null &&
          '_tag' in err &&
          typeof (err as { _tag: unknown })._tag === 'string'
        ) {
          const tag = (err as { _tag: string })._tag;
          if (activeMachine.hasTransitionFor(activeStateName, tag)) {
            dispatchInternal(tag, err);
            return;
          }
        }

        dispatchInternal('ERROR', err);
      };

      const startAwaitingTaskIfNeeded = (stateName: string): void => {
        const taskFn = tasksMap[stateName];
        if (!taskFn) {
          return;
        }

        cancelActiveTask();

        const abortController = new AbortController();
        const handle: ActiveTaskHandle = {
          stateName,
          cancelled: false,
          abortController,
          fiber: null,
        };
        activeTask = handle;

        const ctxSnapshot = getEffectiveContext();

        try {
          const result = taskFn(ctxSnapshot, abortController.signal);

          if (Effect.isEffect(result)) {
            const fiber = Effect.runFork(
              result as Effect.Effect<Partial<TContext> | void, any, never>,
            );
            handle.fiber = fiber;
            fiber.addObserver((exit) => {
              if (handle.cancelled) {
                return;
              }
              if (Exit.isSuccess(exit)) {
                handleTaskSuccess(handle, exit.value);
              } else {
                if (Cause.hasInterruptsOnly(exit.cause)) {
                  return;
                }
                const squashedError = Cause.squash(exit.cause);
                handleTaskFailure(handle, squashedError);
              }
            });
          } else if (result && typeof (result as Promise<unknown>).then === 'function') {
            (result as Promise<Partial<TContext> | void>).then(
              (output) => handleTaskSuccess(handle, output),
              (err) => handleTaskFailure(handle, err),
            );
          } else {
            handleTaskSuccess(
              handle,
              result as unknown as Partial<TContext> | void,
            );
          }
        } catch (syncErr) {
          handleTaskFailure(handle, syncErr);
        }
      };

      const syncEachInstances = (eachNode: EachNode<any, any>): void => {
        const key = eachNode.key;
        const ctx = getEffectiveContext() as Record<string, unknown>;
        const rawArray = Array.isArray(ctx[key]) ? (ctx[key] as unknown[]) : [];

        let registry = eachRegistries.get(key);
        if (!registry) {
          registry = new Map<string, MachineInstance<any>>();
          eachRegistries.set(key, registry);
        }

        const activeIds = new Set<string>();
        for (const item of rawArray) {
          const id = extractItemId(item);
          activeIds.add(id);
          if (!registry.has(id)) {
            const childInstance = createMachineInstance(eachNode.machine);
            registry.set(id, childInstance);
          }
        }

        // Remove instances whose ID is no longer in the array
        for (const existingId of [...registry.keys()]) {
          if (!activeIds.has(existingId)) {
            registry.delete(existingId);
          }
        }

        publishChildSnapshots();
        checkEachAllDone(eachNode);
      };

      const publishChildSnapshots = (): void => {
        const record: Record<string, ReadonlyArray<ChildMachineSnapshot>> = {};
        for (const [key, registry] of eachRegistries.entries()) {
          const list: ChildMachineSnapshot[] = [];
          for (const [id, instance] of registry.entries()) {
            list.push({
              id,
              state: instance.state(),
              context: instance.context(),
              isPending: instance.isPending(),
              isDone: instance.isDone(),
              finalOutcome: instance.finalOutcome(),
            });
          }
          record[key] = list;
        }
        childMachinesSig.set(record);
      };

      const checkEachAllDone = (eachNode: EachNode<any, any>): void => {
        const registry = eachRegistries.get(eachNode.key);
        if (!registry || registry.size === 0) {
          return;
        }
        const instances = [...registry.values()];
        if (instances.length > 0 && instances.every((inst) => inst.isDone())) {
          if (fsmStateSig() === eachNode.id) {
            dispatchInternal('ALL_DONE');
          }
        }
      };

      const dispatchInternal = (event: string, payload?: unknown): void => {
        const currentState = untracked(() => fsmStateSig());
        const currentCtx = getEffectiveContext();

        // Handle subMachine delegation vs parent group-interrupt
        if (activeSubMachine && activeSubRef) {
          const subHasTransition = activeSubRef.machine.hasTransitionFor(
            activeSubMachine.state(),
            event,
          );
          const parentHasInterrupt = fsm.hasTransitionFor(
            activeSubRef.id,
            event,
          );

          if (subHasTransition) {
            const prevSubState = activeSubMachine.state();
            activeSubMachine.patchContext(currentCtx);
            activeSubMachine.send(event, payload);
            const updatedSubCtx = activeSubMachine.context();
            if (updatedSubCtx && typeof updatedSubCtx === 'object') {
              rawContextSig.update((prev) => ({
                ...prev,
                ...(updatedSubCtx as Partial<TContext>),
              }));
            }
            const nextSubState = activeSubMachine.state();
            fsmSubStateSig.set(nextSubState);

            if (prevSubState !== nextSubState) {
              cancelActiveTask();
              if (activeSubRef.machine.awaitingStates.has(nextSubState)) {
                startAwaitingTaskIfNeeded(nextSubState);
              }
            }

            if (activeSubMachine && activeSubMachine.isDone()) {
              const outcome = activeSubMachine.finalOutcome() ?? 'DONE';
              const subCtx = activeSubMachine.context();
              const refId = activeSubRef.id;
              cancelActiveTask();
              activeSubMachine = null;
              activeSubRef = null;
              fsmSubStateSig.set(null);
              if (fsm.hasTransitionFor(refId, outcome)) {
                dispatchInternal(outcome, subCtx);
              } else {
                dispatchInternal('DONE', subCtx);
              }
            }
            return;
          } else if (parentHasInterrupt) {
            // Parent group-interrupt (e.g. [paymentFSM, 'CANCEL', 'cart'])
            cancelActiveTask();
            activeSubMachine = null;
            activeSubRef = null;
            fsmSubStateSig.set(null);
          } else {
            return;
          }
        }

        const evaluation = fsm.evaluate(
          currentState,
          event,
          payload,
          currentCtx,
        );

        if (!evaluation.matched) {
          return;
        }

        if (evaluation.patchApplied) {
          rawContextSig.update((prev) => ({
            ...prev,
            ...evaluation.patchApplied,
          }));
        }

        // In-place stay(): patch applied, keep current state, do NOT re-enter or interrupt tasks!
        if (evaluation.stayed) {
          const activeEach = fsm.eachNodes.get(currentState);
          if (activeEach) {
            syncEachInstances(activeEach);
          }
          return;
        }

        // Leaving current state -> cancel any in-flight awaiting task!
        cancelActiveTask();
        onExitHooks[currentState]?.(getEffectiveContext());

        const nextState = evaluation.nextState;
        fsmStateSig.set(nextState);

        if (evaluation.enteredSubMachine) {
          activeSubRef = evaluation.enteredSubMachine;
          activeSubMachine = createMachineInstance(activeSubRef.machine, {
            initialContext: getEffectiveContext(),
          });
          const initialSubState = activeSubMachine.state();
          fsmSubStateSig.set(initialSubState);
          if (activeSubRef.machine.awaitingStates.has(initialSubState)) {
            startAwaitingTaskIfNeeded(initialSubState);
          }
        } else {
          fsmSubStateSig.set(null);
        }

        if (evaluation.enteredEach) {
          syncEachInstances(evaluation.enteredEach);
        }

        onEnterHooks[nextState]?.(getEffectiveContext());

        if (evaluation.isAwaiting) {
          startAwaitingTaskIfNeeded(nextState);
        }
      };

      const send: SendFn<TFSM> = (...args: [event: string, payload?: unknown]) => {
        const [event, payload] = args;
        dispatchInternal(event, payload);
      };

      const sendToChild = (
        key: string,
        itemId: string,
        event: string,
        payload?: unknown,
      ): void => {
        const eachNode = fsm.eachNodes.get(`each:${key}`);
        if (eachNode && !eachRegistries.has(key)) {
          syncEachInstances(eachNode);
        }
        const registry = eachRegistries.get(key);
        const child = registry?.get(itemId);
        if (!child) {
          return;
        }
        child.send(event, payload);
        publishChildSnapshots();
        if (eachNode) {
          checkEachAllDone(eachNode);
        }
      };

      const reset = (): void => {
        cancelActiveTask();
        activeSubMachine = null;
        activeSubRef = null;
        eachRegistries.clear();
        fsmSubStateSig.set(null);
        rawContextSig.set({ ...fsm.context });
        fsmStateSig.set(fsm.initial as TState);
        childMachinesSig.set({});
      };

      // If initial state itself is an awaiting node or each node, initialize it
      if (fsm.awaitingStates.has(fsm.initial)) {
        startAwaitingTaskIfNeeded(fsm.initial);
      }

      return {
        fsmState: fsmStateSig.asReadonly(),
        fsmSubState: fsmSubStateSig.asReadonly(),
        fsmContext,
        isPending,
        childMachines: childMachinesSig.asReadonly(),
        send,
        sendToChild,
        reset,
      };
    }),
  );
}
