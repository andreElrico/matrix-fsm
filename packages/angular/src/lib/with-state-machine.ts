/**
 * @matrix-fsm/angular - SignalStore Bridge (Promise, RxJS Observable & Pluggable Task Runners)
 * 0% Hard Effect-TS Dependency
 */

import {
  computed,
  DestroyRef,
  inject,
  isSignal,
  signal,
  untracked,
  ɵɵdefineInjectable,
  type Signal,
} from '@angular/core';
import {
  deepComputed,
  getState,
  patchState,
  withProps,
  type DeepSignalOf,
  type EmptyFeatureResult,
  type SignalStoreFeature,
} from '@ngrx/signals';
import {
  createMachineInstance,
  invokeCallSelector,
  type AnyFSMDefinition,
  type EachNode,
  type EmptyObject,
  type ExtractAwaitingNodes,
  type ExtractContext,
  type ExtractEventPayload,
  type ExtractEvents,
  type ExtractMethods,
  type ExtractStates,
  type MachineInstance,
  type SubMachineRef,
} from '@matrix-fsm/core';

function ensureJitCompilerFacade(): void {
  const g = globalThis as Record<string, any>;
  g['ng'] ??= {};
  g['ng'].ɵcompilerFacade ??= {
    compileFactoryDeclaration(
      _env: unknown,
      _url: string,
      decl: { type: new (...args: any[]) => unknown },
    ) {
      return (...args: any[]) => new decl.type(...args);
    },
    compileInjectableDeclaration(
      _env: unknown,
      _url: string,
      decl: { type: new (...args: any[]) => unknown; providedIn?: any },
    ) {
      return ɵɵdefineInjectable({
        token: decl.type,
        providedIn: decl.providedIn ?? null,
        factory: () => new decl.type(),
      });
    },
  };
}

ensureJitCompilerFacade();

/**
 * Structural interface matching RxJS `Observable<T>` without requiring `rxjs` at runtime.
 */
export interface Subscribable<T> {
  subscribe(
    observer?: {
      next?: (value: T) => void;
      error?: (err: unknown) => void;
      complete?: () => void;
    },
  ): { unsubscribe(): void } | (() => void);
}

/**
 * Structural interface matching Effect-TS `Effect.Effect<A, E, never>` without importing `'effect'`.
 */
export interface EffectLike<out A = any> {
  readonly '~effect/Effect': any;
  [Symbol.iterator](): Iterator<any, A, any>;
}

/**
 * Pluggable task adapter interface (e.g., used by `@matrix-fsm/angular/effect`).
 */
export interface CustomTaskAdapter {
  canHandle(result: unknown): boolean;
  execute<TContext>(
    result: unknown,
    callbacks: {
      onSuccess: (output: Partial<TContext> | void) => void;
      onFailure: (err: unknown) => void;
      isCancelled: () => boolean;
    },
  ): () => void;
}

const registeredTaskAdapters: CustomTaskAdapter[] = [];

/**
 * Registers a pluggable task execution adapter (such as `@matrix-fsm/angular/effect`).
 */
export function registerTaskAdapter(adapter: CustomTaskAdapter): void {
  if (!registeredTaskAdapters.includes(adapter)) {
    registeredTaskAdapters.unshift(adapter);
  }
}

export type TaskResult<TContext> =
  | Promise<Partial<TContext> | void>
  | Subscribable<Partial<TContext> | void>
  | EffectLike<Partial<TContext> | void>
  | Partial<TContext>
  | void;

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

export type RequiredStoreMethods<
  TFSM extends AnyFSMDefinition,
  TExplicitMethods = EmptyObject,
> = [keyof Omit<ExtractMethods<TFSM>, keyof TExplicitMethods>] extends [never]
  ? EmptyFeatureResult['methods']
  : {
      [K in keyof Omit<
        ExtractMethods<TFSM>,
        keyof TExplicitMethods
      >]: Omit<ExtractMethods<TFSM>, keyof TExplicitMethods>[K] extends (
        ...args: any[]
      ) => any
        ? Omit<ExtractMethods<TFSM>, keyof TExplicitMethods>[K]
        : (...args: any[]) => any;
    };

export type StateMachineFeatureConfig<
  TFSM extends AnyFSMDefinition,
  TExplicitMethods extends Record<string, (...args: any[]) => any> = EmptyObject,
> = {
  /**
   * Reactive Context Mirroring: syncs external Angular Signals (e.g. from Layer 1 global stores)
   * into the FSM context without tight coupling.
   */
  readonly syncContext?:
    | (() => SyncContextMap<ExtractContext<TFSM>>)
    | SyncContextMap<ExtractContext<TFSM>>;
  /**
   * Optional explicit method dictionary for `{ call: (m) => m.methodName }` if not provided via `withMethods`.
   */
  readonly methods?:
    | (() => TExplicitMethods & Partial<ExtractMethods<TFSM>>)
    | (TExplicitMethods & Partial<ExtractMethods<TFSM>>);
  /**
   * Optional pluggable task runner adapter (e.g. `effectTaskAdapter` from `@matrix-fsm/angular/effect`).
   */
  readonly taskAdapter?: CustomTaskAdapter;
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

export type AllowedSendEvents<TFSM extends AnyFSMDefinition> =
  [ExtractEvents<TFSM>] extends [never]
    ? string
    : ExtractEvents<TFSM> | 'DONE' | 'ERROR' | 'ALL_DONE';

export type SendFn<TFSM extends AnyFSMDefinition> = <
  TEvent extends AllowedSendEvents<TFSM>,
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
  readonly childMachines: Signal<
    Record<string, ReadonlyArray<ChildMachineSnapshot>>
  >;
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
  teardown: (() => void) | null;
}

function resolveFactoryOrValue<T>(
  input: (() => T) | T | undefined,
): T | undefined {
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

function isSubscribable(
  value: unknown,
): value is Subscribable<any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Subscribable<any>).subscribe === 'function'
  );
}

/**
 * Custom `@ngrx/signals` feature that binds a `@matrix-fsm/core` state machine
 * directly to SignalStore's `withState` and `withMethods`, with native Promise,
 * RxJS Observable, and pluggable task runner support.
 */
export function withStateMachine<
  TFSM extends AnyFSMDefinition,
  TExplicitMethods extends Record<string, (...args: any[]) => any> = EmptyObject,
>(
  fsm: TFSM,
  ...configArgs: [ExtractAwaitingNodes<TFSM>] extends [never]
    ? [config?: StateMachineFeatureConfig<TFSM, TExplicitMethods>]
    : [config: StateMachineFeatureConfig<TFSM, TExplicitMethods>]
): SignalStoreFeature<
  {
    state: EmptyFeatureResult['state'];
    props: EmptyFeatureResult['props'];
    methods: RequiredStoreMethods<TFSM, TExplicitMethods>;
  },
  {
    state: EmptyFeatureResult['state'];
    props: StateMachineStoreMembers<TFSM>;
    methods: EmptyFeatureResult['methods'];
  }
> {
  const [config] = configArgs;
  type TState = ExtractStates<TFSM>;
  type TContext = ExtractContext<TFSM>;

  return withProps<
    {
      state: EmptyFeatureResult['state'];
      props: EmptyFeatureResult['props'];
      methods: RequiredStoreMethods<TFSM, TExplicitMethods>;
    },
    StateMachineStoreMembers<TFSM>
  >(
    (store): StateMachineStoreMembers<TFSM> => {
      const syncedSignals = (resolveFactoryOrValue(config?.syncContext) ??
        {}) as Record<string, Signal<unknown> | undefined>;
      const explicitMethods = (resolveFactoryOrValue(config?.methods) ??
        {}) as Record<string, (...args: any[]) => any>;
      const tasksMap = (resolveFactoryOrValue(config?.tasks as any) ??
        {}) as Record<string, TaskHandler<TContext> | undefined>;
      const onEnterHooks = (resolveFactoryOrValue(config?.onEnter) ??
        {}) as Record<string, ((ctx: Readonly<TContext>) => void) | undefined>;
      const onExitHooks = (resolveFactoryOrValue(config?.onExit) ??
        {}) as Record<string, ((ctx: Readonly<TContext>) => void) | undefined>;

      const readStoreState = (): Record<string, unknown> => {
        try {
          return getState(store as any) as Record<string, unknown>;
        } catch {
          return {};
        }
      };

      const initialStoreStateSnapshot = {
        ...untracked(() => readStoreState()),
      };
      const storeStateKeys = new Set<string>(
        Object.keys(initialStoreStateSnapshot),
      );

      const fsmStateSig = signal<TState>(fsm.initial as TState);
      const fsmSubStateSig = signal<string | null>(null);
      const rawContextSig = signal<TContext>({
        ...(fsm.context ?? {}),
        ...initialStoreStateSnapshot,
      } as TContext);
      const childMachinesSig = signal<
        Record<string, ReadonlyArray<ChildMachineSnapshot>>
      >({});

      // Reactive merged context: combines internal context, SignalStore `withState`, and `syncContext` signals
      const fsmContext = deepComputed<TContext>(() => {
        const base = rawContextSig();
        const storeState = readStoreState();
        const syncedPatch: Record<string, unknown> = {};
        for (const [key, sig] of Object.entries(syncedSignals)) {
          if (isSignal(sig)) {
            syncedPatch[key] = sig();
          }
        }
        return {
          ...base,
          ...storeState,
          ...syncedPatch,
        } as TContext;
      });

      const getEffectiveContext = (): TContext =>
        untracked(() => fsmContext());

      const applyContextPatch = (patch: Partial<TContext>): void => {
        if (!patch || typeof patch !== 'object') {
          return;
        }
        rawContextSig.update((prev) => ({
          ...prev,
          ...patch,
        }));
        if (storeStateKeys.size > 0) {
          const storeSlicePatch: Record<string, unknown> = {};
          let hasMatchingStoreKey = false;
          for (const [k, v] of Object.entries(patch)) {
            if (storeStateKeys.has(k)) {
              storeSlicePatch[k] = v;
              hasMatchingStoreKey = true;
            }
          }
          if (hasMatchingStoreKey) {
            patchState(store as any, storeSlicePatch);
          }
        }
      };

      const getMethodsTarget = (): Record<string, any> =>
        new Proxy(store as Record<string, any>, {
          get(target, prop, receiver) {
            if (typeof prop === 'string' && prop in explicitMethods) {
              return explicitMethods[prop];
            }
            const val = Reflect.get(target, prop, receiver);
            return typeof val === 'function' ? val.bind(target) : val;
          },
        });

      let activeTask: ActiveTaskHandle | null = null;
      let activeSubMachine: MachineInstance<any> | null = null;
      let activeSubRef: SubMachineRef<any, any> | null = null;
      const eachRegistries = new Map<
        string,
        Map<string, MachineInstance<any>>
      >();

      const cancelActiveTask = (): void => {
        if (!activeTask) {
          return;
        }
        const taskToCancel = activeTask;
        activeTask = null;
        taskToCancel.cancelled = true;
        taskToCancel.abortController.abort();
        if (taskToCancel.teardown) {
          const cleanup = taskToCancel.teardown;
          taskToCancel.teardown = null;
          cleanup();
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

        // 1. Pre-DONE context patching: merge task output into context/SignalStore BEFORE 'DONE' guards evaluate!
        if (output && typeof output === 'object') {
          applyContextPatch(output);
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

        // Check if err has a `_tag` (e.g. TaggedError) or custom Error `.name` matching a transition row
        if (typeof err === 'object' && err !== null) {
          if (
            '_tag' in err &&
            typeof (err as { _tag: unknown })._tag === 'string'
          ) {
            const tag = (err as { _tag: string })._tag;
            if (activeMachine.hasTransitionFor(activeStateName, tag)) {
              dispatchInternal(tag, err);
              return;
            }
          }
          if (
            'name' in err &&
            typeof (err as { name: unknown }).name === 'string' &&
            (err as { name: string }).name !== 'Error'
          ) {
            const errName = (err as { name: string }).name;
            if (activeMachine.hasTransitionFor(activeStateName, errName)) {
              dispatchInternal(errName, err);
              return;
            }
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
          teardown: null,
        };
        activeTask = handle;

        const ctxSnapshot = getEffectiveContext();

        try {
          const result = taskFn(ctxSnapshot, abortController.signal);

          // 1. Check explicit or registered custom task adapters (e.g. @matrix-fsm/angular/effect)
          const adapters = config?.taskAdapter
            ? [config.taskAdapter, ...registeredTaskAdapters]
            : registeredTaskAdapters;
          const matchingAdapter = adapters.find((a) => a.canHandle(result));

          if (matchingAdapter) {
            handle.teardown = matchingAdapter.execute<TContext>(result, {
              onSuccess: (output) => handleTaskSuccess(handle, output),
              onFailure: (err) => handleTaskFailure(handle, err),
              isCancelled: () => handle.cancelled,
            });
            return;
          }

          // 2. Native Promise support
          if (
            result &&
            typeof (result as Promise<unknown>).then === 'function'
          ) {
            (result as Promise<Partial<TContext> | void>).then(
              (output) => handleTaskSuccess(handle, output),
              (err) => handleTaskFailure(handle, err),
            );
            return;
          }

          // 3. Native RxJS Observable / Subscribable support with automatic unsubscribe on cancel
          if (isSubscribable(result)) {
            let emitted = false;
            let lastValue: Partial<TContext> | void = undefined;
            const sub = result.subscribe({
              next: (val) => {
                emitted = true;
                lastValue = val;
              },
              error: (err) => handleTaskFailure(handle, err),
              complete: () => {
                handleTaskSuccess(handle, emitted ? lastValue : undefined);
              },
            });
            handle.teardown = () => {
              if (typeof sub === 'function') {
                sub();
              } else if (sub && typeof sub.unsubscribe === 'function') {
                sub.unsubscribe();
              }
            };
            return;
          }

          // 4. Synchronous return value
          handleTaskSuccess(
            handle,
            result as unknown as Partial<TContext> | void,
          );
        } catch (syncErr) {
          handleTaskFailure(handle, syncErr);
        }
      };

      const syncEachInstances = (eachNode: EachNode<any, any>): void => {
        const key = eachNode.key;
        const ctx = getEffectiveContext() as Record<string, unknown>;
        const rawArray = Array.isArray(ctx[key])
          ? (ctx[key] as unknown[])
          : [];

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
            const childInstance = createMachineInstance(eachNode.machine, {
              methods: getMethodsTarget(),
            });
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
            activeSubMachine.patchContext(getEffectiveContext());
            activeSubMachine.send(event, payload);
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
              const subCtx = getEffectiveContext();
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
            // Parent group-interrupt (e.g. [baristaFSM, 'CANCEL', 'customerBrowsing'])
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
          applyContextPatch(evaluation.patchApplied);
        }

        if (evaluation.callSelector) {
          invokeCallSelector(
            evaluation.callSelector,
            getMethodsTarget(),
            payload,
            getEffectiveContext(),
          );
        }

        // In-place stay(): patch/call applied, keep current state, do NOT re-enter or interrupt tasks!
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
            methods: getMethodsTarget(),
            getContext: getEffectiveContext,
            onPatch: applyContextPatch,
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

      const send: SendFn<TFSM> = (
        ...args: [event: string, payload?: unknown]
      ) => {
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
        rawContextSig.set({
          ...(fsm.context ?? {}),
          ...initialStoreStateSnapshot,
        } as TContext);
        if (storeStateKeys.size > 0) {
          patchState(store as any, initialStoreStateSnapshot);
        }
        fsmStateSig.set(fsm.initial as TState);
        childMachinesSig.set({});
      };

      // If initial state itself is an awaiting node, initialize it
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
    },
  );
}
