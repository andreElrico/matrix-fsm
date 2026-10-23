/**
 * @matrix-fsm/angular - SignalStore Bridge & Scoped Tree Node Execution Engine
 * Supports Promise, RxJS Observable, Pluggable Task Runners (Effect-TS),
 * Zero-Leakage Sub-Machine Encapsulation via Angular DI (`provideStateMachine`),
 * and Full Async Recursive 1:N Pools (`each`).
 */

import {
  computed,
  DestroyRef,
  inject,
  InjectionToken,
  Injector,
  isSignal,
  makeEnvironmentProviders,
  runInInjectionContext,
  signal,
  untracked,
  ɵɵdefineInjectable,
  type EnvironmentProviders,
  type Provider,
  type Signal,
  type Type,
} from '@angular/core';
import {
  deepComputed,
  getState,
  patchState,
  signalState,
  signalStoreFeature,
  withMethods,
  withProps,
  withState,
  type DeepSignalOf,
  type EmptyFeatureResult,
  type SignalStoreFeature,
  type WritableStateSource,
} from '@ngrx/signals';
import {
  awaiting,
  createFSM,
  each,
  finalState,
  invokeCallSelector,
  stay,
  subMachine,
  toMermaid,
  transitions,
  type AnyFSMDefinition,
  type AwaitingNode,
  type EachNode,
  type EmptyObject,
  type ExtractAllSubMachines,
  type ExtractAwaitingNodes,
  type ExtractContext,
  type ExtractEventPayload,
  type ExtractEvents,
  type ExtractInput,
  type ExtractMethods,
  type ExtractOwnAwaitingNodes,
  type ExtractStates,
  type FSMDefinition,
  type ResolveContext,
  type SubMachineRef,
  type TransitionRow,
  type ValidateTransitionRows,
} from '@matrix-fsm/core';

export {
  awaiting,
  createFSM,
  each,
  finalState,
  stay,
  subMachine,
  toMermaid,
  transitions,
};

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

export type TaskHandler<TContext, TPatch = TContext> = (
  ctx: Readonly<TContext>,
  signal: AbortSignal,
) => TaskResult<TPatch>;

export type TasksMapFor<TFSM extends AnyFSMDefinition> = {
  readonly [K in ExtractOwnAwaitingNodes<TFSM>]: TaskHandler<
    ExtractContext<TFSM>
  >;
};

export const FSM_TASKS = '__fsmTasks' as const;
export type FSM_TASKS = typeof FSM_TASKS;

export type MachineTaskSlots<K extends string> = {
  readonly [FSM_TASKS]: { readonly [P in K]: TaskHandler<any> };
};

export type SubMachineAwaitingNodes<TFSM extends AnyFSMDefinition> =
  ExtractAwaitingNodes<ExtractAllSubMachines<TFSM>>;

export type OwnAwaitingNodes<TFSM extends AnyFSMDefinition> =
  ExtractOwnAwaitingNodes<TFSM>;

export type StateMachineTasksConfig<TFSM extends AnyFSMDefinition> = {
  readonly [K in OwnAwaitingNodes<TFSM>]: TaskHandler<ExtractContext<TFSM>>;
} & {
  readonly [K in SubMachineAwaitingNodes<TFSM>]?: TaskHandler<any>;
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

export type InlineStoreFor<TFSM extends AnyFSMDefinition> =
  WritableStateSource<ExtractContext<TFSM>> &
    DeepSignalOf<ExtractContext<TFSM>> &
    Record<string, any>;

export type StateMachineFeatureConfig<
  TFSM extends AnyFSMDefinition,
  TExplicitMethods extends Record<string, (...args: any[]) => any> = EmptyObject,
> = {
  /**
   * Optional initial context state (enables standalone encapsulated stores in a single `withStateMachine` block).
   */
  readonly state?: ExtractContext<TFSM> | (() => ExtractContext<TFSM>);
  /**
   * Reactive Context Mirroring: syncs external Angular Signals (e.g. from Layer 1 global stores)
   * into the FSM context without tight coupling.
   */
  readonly syncContext?:
    | (() => SyncContextMap<ExtractContext<TFSM>>)
    | SyncContextMap<ExtractContext<TFSM>>;
  /**
   * Optional method dictionary or SignalStore-aware method factory for `{ call: (m) => m._methodName }`.
   */
  readonly methods?:
    | ((
        store: InlineStoreFor<TFSM>,
      ) => TExplicitMethods & Partial<ExtractMethods<TFSM>>)
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
} & ([OwnAwaitingNodes<TFSM>] extends [never]
  ? {
      /**
       * Tasks for the machine's OWN `awaiting('...')` states.
       */
      readonly tasks?:
        | (() => StateMachineTasksConfig<TFSM>)
        | StateMachineTasksConfig<TFSM>;
    }
  : {
      /**
       * Compile-time enforced tasks for every OWN `awaiting('...')` state.
       */
      readonly tasks:
        | (() => StateMachineTasksConfig<TFSM>)
        | StateMachineTasksConfig<TFSM>;
    });

export interface ChildMachineSnapshot<TContext = any> {
  readonly id: string;
  readonly state: string;
  readonly subState?: string | null;
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

type CleanObject<T> = [keyof T] extends [never] ? EmptyObject : T;

export type ActorStateOf<TSub extends AnyFSMDefinition> = Readonly<
  CleanObject<ExtractInput<TSub>> & CleanObject<ExtractContext<TSub>>
>;

export type ActorsMapFor<TFSM extends AnyFSMDefinition> = {
  readonly [M in ExtractAllSubMachines<TFSM> as M['id']]: Signal<
    ActorStateOf<M> | null
  >;
} & Readonly<Record<string, Signal<Readonly<Record<string, any>> | null>>>;

export interface StateMachineStoreMembers<TFSM extends AnyFSMDefinition> {
  readonly fsmState: Signal<ExtractStates<TFSM>>;
  readonly fsmSubState: Signal<string | null>;
  readonly fsmSubContext: Signal<Readonly<Record<string, any>> | null>;
  readonly fsmContext: DeepSignalOf<ExtractContext<TFSM>>;
  readonly actors: ActorsMapFor<TFSM>;
  readonly isPending: Signal<boolean>;
  readonly isDone: Signal<boolean>;
  readonly finalOutcome: Signal<string | null>;
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
  readonly patchContext: (patch: Partial<ExtractContext<TFSM>>) => void;
  readonly reset: (initialOverride?: Partial<ExtractContext<TFSM>>) => void;
  readonly destroy: () => void;
}

// ============================================================================
// Scoped Sub-Machine DI Token & Default Factory Registry
// ============================================================================

export interface SubMachineRuntimeNode<
  TFSM extends AnyFSMDefinition = AnyFSMDefinition,
> {
  readonly fsmState: Signal<string>;
  readonly fsmSubState: Signal<string | null>;
  readonly fsmSubContext: Signal<Readonly<Record<string, any>> | null>;
  readonly fsmContext: Signal<ExtractContext<TFSM>>;
  readonly isPending: Signal<boolean>;
  readonly isDone: Signal<boolean>;
  readonly finalOutcome: Signal<string | null>;
  readonly finalPayload?: Signal<unknown>;
  readonly hasFinalPayloadSelector?: Signal<boolean>;
  readonly send: (...args: any[]) => void;
  readonly patchContext?: (patch: Partial<ExtractContext<TFSM>>) => void;
  readonly reset: (initialOverride?: Partial<ExtractContext<TFSM>>) => void;
  readonly destroy?: () => void;
  readonly __setNotifyParent?: (cb: () => void) => void;
  readonly __setEmitOutputHandler?: (
    cb: (output: { readonly type: string; readonly payload: unknown }) => void,
  ) => void;
}

export type SubMachineSpawnFactory<
  TFSM extends AnyFSMDefinition = AnyFSMDefinition,
> = (
  injector: Injector | null,
  initialOverride?: Record<string, unknown>,
  onNotifyParent?: () => void,
  onEmitOutput?: (output: {
    readonly type: string;
    readonly payload: unknown;
  }) => void,
) => SubMachineRuntimeNode<TFSM>;

const machineTokenCache = new WeakMap<
  AnyFSMDefinition,
  InjectionToken<SubMachineSpawnFactory<any>>
>();

const defaultMachineFactories = new WeakMap<
  AnyFSMDefinition,
  SubMachineSpawnFactory<any>
>();

/**
 * Returns the unique Angular `InjectionToken` associated with a pure `FSMDefinition`.
 */
export function getMachineToken<TFSM extends AnyFSMDefinition>(
  fsm: TFSM,
): InjectionToken<SubMachineSpawnFactory<TFSM>> {
  let token = machineTokenCache.get(fsm);
  if (!token) {
    token = new InjectionToken<SubMachineSpawnFactory<any>>(
      `@matrix-fsm/SubMachineToken(${fsm.id})`,
      {
        providedIn: 'root',
        factory: () => {
          const fallback = defaultMachineFactories.get(fsm);
          if (fallback) {
            return fallback;
          }
          throw new Error(
            `@matrix-fsm: No runtime store or provider registered for sub-machine '${fsm.id}'. Ensure its store (e.g. BaristaStore) is defined or registered via provideStateMachine(${fsm.id}FSM, ...).`,
          );
        },
      },
    );
    machineTokenCache.set(fsm, token);
  }
  return token as InjectionToken<SubMachineSpawnFactory<TFSM>>;
}

/**
 * Registers a default spawn factory on an `FSMDefinition` when its store or feature is evaluated.
 */
export function bindDefaultMachineFactory<TFSM extends AnyFSMDefinition>(
  fsm: TFSM,
  factory: SubMachineSpawnFactory<TFSM>,
): void {
  defaultMachineFactories.set(fsm, factory);
}

/**
 * Helper to patch context/state cleanly inside both full SignalStore instances
 * and scoped sub-machine runners (`methods: (store) => ({ ... })`).
 */
export function patchMachineState<TState extends object>(
  store: any,
  ...updaters: Array<Partial<TState> | ((state: TState) => Partial<TState>)>
): void {
  if (store && typeof store.__fsmApplyPatch === 'function') {
    for (const updater of updaters) {
      const patch =
        typeof updater === 'function'
          ? updater(
              typeof store.fsmContext === 'function'
                ? store.fsmContext()
                : ({} as TState),
            )
          : updater;
      store.__fsmApplyPatch(patch);
    }
    return;
  }
  patchState(store, ...(updaters as any[]));
}

/**
 * Explicitly binds a pure `FSMDefinition` to an Angular SignalStore class or inline configuration
 * inside Angular Dependency Injection (`providers: [provideStateMachine(baristaFSM, BaristaStore)]`).
 * Enables zero-leakage hierarchical tree composition and effortless test mocking!
 */
export function provideStateMachine<TFSM extends AnyFSMDefinition>(
  fsm: TFSM,
  storeClassOrConfig:
    | Type<any>
    | StateMachineFeatureConfig<TFSM, ExtractMethods<TFSM> & Record<string, any>>,
): EnvironmentProviders & Provider {
  const token = getMachineToken(fsm);
  const spawnFactory: SubMachineSpawnFactory<TFSM> = (
    injector,
    initialOverride,
    onNotifyParent,
    onEmitOutput,
  ) => {
    if (typeof storeClassOrConfig === 'function') {
      const instance = injector
        ? runInInjectionContext(injector, () => new storeClassOrConfig())
        : new storeClassOrConfig();
      if (initialOverride && typeof instance.reset === 'function') {
        instance.reset(initialOverride);
      }
      if (onNotifyParent && typeof instance.__setNotifyParent === 'function') {
        instance.__setNotifyParent(onNotifyParent);
      }
      if (
        onEmitOutput &&
        typeof instance.__setEmitOutputHandler === 'function'
      ) {
        instance.__setEmitOutputHandler(onEmitOutput);
      }
      return instance as SubMachineRuntimeNode<TFSM>;
    }
    return createScopedMachineRunner(
      fsm,
      storeClassOrConfig,
      injector,
      initialOverride,
      undefined,
      onNotifyParent,
      onEmitOutput,
    );
  };
  bindDefaultMachineFactory(fsm, spawnFactory);
  return makeEnvironmentProviders([
    {
      provide: token,
      useValue: spawnFactory,
    },
  ]) as unknown as EnvironmentProviders & Provider;
}

interface ActiveTaskHandle {
  readonly stateName: string;
  cancelled: boolean;
  readonly abortController: AbortController;
  teardown: (() => void) | null;
}

function resolveFactoryOrValue<T>(
  input: ((...args: any[]) => T) | T | undefined,
  ...args: any[]
): T | undefined {
  if (typeof input === 'function') {
    return (input as (...a: any[]) => T)(...args);
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

function isSubscribable(value: unknown): value is Subscribable<any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Subscribable<any>).subscribe === 'function'
  );
}

declare const ngDevMode: boolean | undefined;

function collectOwnAwaitingStates(fsm: AnyFSMDefinition): Set<string> {
  return new Set<string>(fsm.awaitingStates);
}

/**
 * Composable task contribution bound to a specific (sub-)machine.
 * Automatically registers a scoped machine runner for `fsm` so parent machines
 * can also spawn `fsm` as an isolated child node without parent store leakage.
 */
export function withMachineTasks<TFSM extends AnyFSMDefinition>(
  fsm: TFSM,
  ...[tasks]: [TFSM] extends [never]
    ? [tasks?: never]
    : [tasks: (() => TasksMapFor<TFSM>) | TasksMapFor<TFSM>]
): SignalStoreFeature<
  EmptyFeatureResult,
  {
    state: EmptyFeatureResult['state'];
    props: MachineTaskSlots<ExtractOwnAwaitingNodes<TFSM>>;
    methods: EmptyFeatureResult['methods'];
  }
> {
  // Also register a default scoped factory so `fsm` can be spawned in isolation if needed
  if (!defaultMachineFactories.has(fsm)) {
    bindDefaultMachineFactory(
      fsm,
      (injector, initialOverride, onNotifyParent, onEmitOutput) =>
        createScopedMachineRunner(
          fsm,
          { tasks: tasks as any },
          injector,
          initialOverride,
          undefined,
          onNotifyParent,
          onEmitOutput,
        ),
    );
  }

  return ((store: any) => {
    const resolved = (resolveFactoryOrValue(tasks as any) ?? {}) as Record<
      string,
      TaskHandler<any>
    >;
    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      const known = collectOwnAwaitingStates(fsm);
      for (const key of Object.keys(resolved)) {
        if (!known.has(key)) {
          console.warn(
            `@matrix-fsm: withMachineTasks('${fsm.id}') received task '${key}' which is not an awaiting state of '${fsm.id}'.`,
          );
        }
      }
    }
    const existing = (store.props?.[FSM_TASKS] ?? {}) as Record<
      string,
      TaskHandler<any>
    >;
    const updatedTasks = { ...existing, ...resolved };
    // Always bind the latest resolved tasks as the default scoped factory for `fsm`
    bindDefaultMachineFactory(
      fsm,
      (injector, initialOverride, onNotifyParent, onEmitOutput) =>
        createScopedMachineRunner(
          fsm,
          { tasks: updatedTasks as any },
          injector,
          initialOverride,
          undefined,
          onNotifyParent,
          onEmitOutput,
        ),
    );
    return {
      ...store,
      props: {
        ...store.props,
        [FSM_TASKS]: updatedTasks,
      },
    };
  }) as any;
}

const defaultFeatureConfigs = new WeakMap<
  AnyFSMDefinition,
  StateMachineFeatureConfig<any, any>
>();

/**
 * Internal engine that creates a reactive, scope-invariant state machine runner.
 * Used both by `withStateMachine` on SignalStores and for dynamically spawned child / `each()` machines.
 */
function createScopedMachineRunner<TFSM extends AnyFSMDefinition>(
  fsm: TFSM,
  config: StateMachineFeatureConfig<TFSM, any> | undefined,
  hostInjector: Injector | null,
  initialOverride?: Record<string, unknown>,
  hostStore?: Record<string, any>,
  initialNotifyParent?: () => void,
  initialEmitOutput?: (output: {
    readonly type: string;
    readonly payload: unknown;
  }) => void,
): StateMachineStoreMembers<TFSM> & {
  readonly finalPayload: Signal<unknown>;
  readonly hasFinalPayloadSelector: Signal<boolean>;
  readonly __setNotifyParent: (cb: () => void) => void;
  readonly __setEmitOutputHandler: (
    cb: (output: { readonly type: string; readonly payload: unknown }) => void,
  ) => void;
} {
  type TState = ExtractStates<TFSM>;
  type TContext = ExtractContext<TFSM>;
  let onNotifyParent: (() => void) | undefined = initialNotifyParent;
  let onEmitOutput:
    | ((output: { readonly type: string; readonly payload: unknown }) => void)
    | undefined = initialEmitOutput;

  const effectiveConfig = config ?? defaultFeatureConfigs.get(fsm);

  const runWithDI = <R>(fn: () => R): R =>
    hostInjector ? runInInjectionContext(hostInjector, fn) : fn();

  const syncedSignals = (runWithDI(() =>
    resolveFactoryOrValue(effectiveConfig?.syncContext),
  ) ?? {}) as Record<string, Signal<unknown> | undefined>;

  const configuredInitialState = (runWithDI(() =>
    resolveFactoryOrValue(effectiveConfig?.state),
  ) ?? {}) as Record<string, unknown>;

  const effectiveStoreSource =
    hostStore ??
    signalState<Record<string, unknown>>({
      ...(fsm.context ?? {}),
      ...configuredInitialState,
      ...(initialOverride ?? {}),
    });

  const readStoreState = (): Record<string, unknown> => {
    try {
      return getState(effectiveStoreSource as any) as Record<string, unknown>;
    } catch {
      return {};
    }
  };

  const initialStoreStateSnapshot = {
    ...configuredInitialState,
    ...untracked(() => readStoreState()),
  };
  const storeStateKeys = new Set<string>(
    Object.keys(untracked(() => readStoreState())),
  );

  const fsmStateSig = signal<TState>(fsm.initial as TState);
  const fsmSubStateSig = signal<string | null>(null);
  const fsmSubContextSig = signal<Readonly<Record<string, any>> | null>(null);
  const activeSubNodeSig = signal<SubMachineRuntimeNode<any> | null>(null);
  const activeSubRefIdSig = signal<string | null>(null);
  const activeSubIsFeatureSig = signal<boolean>(false);
  const doneOutcomeSig = signal<string | null>(null);
  const finalPayloadSig = signal<unknown>(undefined);
  const hasFinalPayloadSelectorSig = signal<boolean>(false);

  const rawContextSig = signal<TContext>({
    ...(fsm.context ?? {}),
    ...initialStoreStateSnapshot,
    ...(initialOverride ?? {}),
  } as TContext);

  const childMachinesSig = signal<
    Record<string, ReadonlyArray<ChildMachineSnapshot>>
  >({});

  // Reactive merged context: combines internal context, SignalStore `withState`, `syncContext` signals,
  // and (for non-feature legacy sub-machines) exposes child context properties transparently.
  const fsmContext = deepComputed<TContext>(() => {
    const base = rawContextSig();
    const storeState = readStoreState();
    const isFeatureSub = activeSubIsFeatureSig();
    const subCtx = isFeatureSub ? null : fsmSubContextSig();
    const syncedPatch: Record<string, unknown> = {};
    for (const [key, sig] of Object.entries(syncedSignals)) {
      if (isSignal(sig)) {
        syncedPatch[key] = sig();
      }
    }
    return {
      ...(subCtx ?? {}),
      ...base,
      ...storeState,
      ...(subCtx && 'error' in subCtx && subCtx['error'] !== null
        ? { error: subCtx['error'] }
        : {}),
      ...syncedPatch,
    } as TContext;
  });

  const getEffectiveContext = (): TContext => untracked(() => fsmContext());

  const applyContextPatch = (patch: Partial<TContext>): void => {
    if (!patch || typeof patch !== 'object') {
      return;
    }
    rawContextSig.update((prev) => ({
      ...prev,
      ...patch,
    }));
    if (!hostStore) {
      patchState(effectiveStoreSource as any, patch as Record<string, unknown>);
      return;
    }
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
        patchState(effectiveStoreSource as any, storeSlicePatch);
      }
    }
  };

  const virtualStoreTarget = effectiveStoreSource;

  const explicitMethods = (runWithDI(() =>
    resolveFactoryOrValue(effectiveConfig?.methods, virtualStoreTarget),
  ) ?? {}) as Record<string, (...args: any[]) => any>;

  const contributedTasks = ((hostStore as any)?.[FSM_TASKS] ?? {}) as Record<
    string,
    TaskHandler<TContext> | undefined
  >;
  const tasksMap = {
    ...contributedTasks,
    ...((runWithDI(() => resolveFactoryOrValue(effectiveConfig?.tasks as any)) ??
      {}) as Record<string, TaskHandler<TContext> | undefined>),
  } as Record<string, TaskHandler<TContext> | undefined>;

  if (typeof ngDevMode === 'undefined' || ngDevMode) {
    for (const s of collectOwnAwaitingStates(fsm)) {
      if (!tasksMap[s]) {
        console.warn(
          `@matrix-fsm: '${fsm.id}' has awaiting state '${s}' without a task. Provide it via withStateMachine({ tasks }) or withMachineTasks(subFSM, ...).`,
        );
      }
    }
  }

  const onEnterHooks = (runWithDI(() =>
    resolveFactoryOrValue(effectiveConfig?.onEnter),
  ) ?? {}) as Record<string, ((ctx: Readonly<TContext>) => void) | undefined>;
  const onExitHooks = (runWithDI(() =>
    resolveFactoryOrValue(effectiveConfig?.onExit),
  ) ?? {}) as Record<string, ((ctx: Readonly<TContext>) => void) | undefined>;

  const getMethodsTarget = (): Record<string, any> =>
    new Proxy((hostStore ?? explicitMethods) as Record<string, any>, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && prop in explicitMethods) {
          return explicitMethods[prop];
        }
        const val = Reflect.get(target, prop, receiver);
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });

  let activeTask: ActiveTaskHandle | null = null;
  let activeSubNode: SubMachineRuntimeNode<any> | null = null;
  let activeSubRef: SubMachineRef<any, any> | null = null;
  const eachRegistries = new Map<
    string,
    Map<string, SubMachineRuntimeNode<any>>
  >();

  const actorSignalsCache = new Map<
    string,
    Signal<Readonly<Record<string, any>> | null>
  >();
  const getOrCreateActorSignal = (
    subId: string,
  ): Signal<Readonly<Record<string, any>> | null> => {
    let sig = actorSignalsCache.get(subId);
    if (!sig) {
      sig = computed(() => {
        const refId = activeSubRefIdSig();
        const node = activeSubNodeSig();
        if (refId !== subId || !node) {
          return null;
        }
        return node.fsmContext() as Readonly<Record<string, any>>;
      });
      actorSignalsCache.set(subId, sig);
    }
    return sig;
  };
  for (const subId of fsm.subMachines.keys()) {
    getOrCreateActorSignal(subId);
  }
  const actors = new Proxy({} as ActorsMapFor<TFSM>, {
    get(_target, prop) {
      if (typeof prop === 'string') {
        return getOrCreateActorSignal(prop);
      }
      return undefined;
    },
  });

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

  const destroyActiveSubNode = (): void => {
    if (!activeSubNode) {
      return;
    }
    const subToDestroy = activeSubNode;
    activeSubNode = null;
    activeSubRef = null;
    activeSubNodeSig.set(null);
    activeSubRefIdSig.set(null);
    activeSubIsFeatureSig.set(false);
    fsmSubStateSig.set(null);
    fsmSubContextSig.set(null);
    if (subToDestroy.destroy) {
      subToDestroy.destroy();
    } else {
      subToDestroy.reset();
    }
  };

  const destroyAllEachPools = (): void => {
    for (const registry of eachRegistries.values()) {
      for (const child of registry.values()) {
        if (child.destroy) {
          child.destroy();
        } else {
          child.reset();
        }
      }
    }
    eachRegistries.clear();
  };

  const destroy = (): void => {
    cancelActiveTask();
    destroyActiveSubNode();
    destroyAllEachPools();
  };

  const isPending = computed<boolean>(() => {
    const currentState = fsmStateSig();
    const subState = fsmSubStateSig();
    if (activeSubNode && activeSubRef && subState) {
      return activeSubNode.isPending();
    }
    for (const [key, registry] of eachRegistries.entries()) {
      if (currentState === `each:${key}`) {
        for (const inst of registry.values()) {
          if (inst.isPending()) {
            return true;
          }
        }
      }
    }
    return fsm.awaitingStates.has(currentState);
  });

  const isDone = computed<boolean>(() => doneOutcomeSig() !== null);

  /**
   * Resolves and instantiates a scoped child machine node for `subFSM`.
   * Resolution priority:
   * 1. Explicit Angular DI `InjectionToken` (`provideStateMachine(subFSM, ...)`)
   * 2. Default bound factory on `subFSM` (from `withStateMachine(subFSM, ...)` in e.g. `BaristaStore`)
   * 3. Scoped fallback runner inheriting parent tasks/methods (for inline tests or `withMachineTasks`)
   */
  const spawnChildNode = (
    subFSM: AnyFSMDefinition,
    inputContext: Record<string, unknown>,
    onChildTransition?: () => void,
    onChildEmitOutput?: (output: {
      readonly type: string;
      readonly payload: unknown;
    }) => void,
  ): SubMachineRuntimeNode<any> => {
    const token = getMachineToken(subFSM);
    let factory: SubMachineSpawnFactory<any> | null = null;
    if (hostInjector) {
      try {
        factory = hostInjector.get(token, null, { optional: true });
      } catch {
        factory = null;
      }
    }
    if (!factory && defaultMachineFactories.has(subFSM)) {
      factory = defaultMachineFactories.get(subFSM) ?? null;
    }

    // If the parent store explicitly contributed or overridden tasks for this sub-machine,
    // run a scoped child runner that integrates with the parent's contributed tasks & methods!
    const hasParentContributedSubTask = [...subFSM.awaitingStates].some(
      (s) => s in tasksMap && tasksMap[s] !== undefined,
    );

    if (factory && !hasParentContributedSubTask) {
      const node = factory(
        hostInjector,
        inputContext,
        onChildTransition,
        onChildEmitOutput,
      );
      if (onChildTransition && typeof node.__setNotifyParent === 'function') {
        node.__setNotifyParent(onChildTransition);
      }
      if (
        onChildEmitOutput &&
        typeof node.__setEmitOutputHandler === 'function'
      ) {
        node.__setEmitOutputHandler(onChildEmitOutput);
      }
      // Merge input into the child node's context cleanly
      if (Object.keys(inputContext).length > 0) {
        if (typeof node.patchContext === 'function') {
          node.patchContext(inputContext);
        } else {
          node.reset(inputContext);
        }
      }
      return node;
    }

    // Fallback: create a scoped runner that shares explicit/contributed tasks & methods
    return createScopedMachineRunner(
      subFSM,
      {
        tasks: tasksMap as any,
        methods: () => getMethodsTarget(),
        taskAdapter: effectiveConfig?.taskAdapter,
      },
      hostInjector,
      inputContext,
      hostStore,
      onChildTransition,
      onChildEmitOutput,
    );
  };

  const syncSubNodeSignals = (): void => {
    if (!activeSubNode) {
      fsmSubStateSig.set(null);
      fsmSubContextSig.set(null);
      return;
    }
    fsmSubStateSig.set(activeSubNode.fsmState());
    fsmSubContextSig.set(
      activeSubNode.fsmContext() as Readonly<Record<string, any>>,
    );
  };

  const checkSubNodeCompletion = (): void => {
    if (!activeSubNode || !activeSubRef) {
      return;
    }
    syncSubNodeSignals();
    if (activeSubNode.isDone()) {
      const outcome = activeSubNode.finalOutcome() ?? 'DONE';
      const childFinalContext = activeSubNode.fsmContext() as Record<
        string,
        unknown
      >;
      const hasSelector =
        typeof activeSubNode.hasFinalPayloadSelector === 'function' &&
        activeSubNode.hasFinalPayloadSelector();
      const outputPayload =
        hasSelector && typeof activeSubNode.finalPayload === 'function'
          ? activeSubNode.finalPayload()
          : childFinalContext;
      const refId = activeSubRef.id;

      // When no explicit payload selector is used on finalState, sync non-internal output slices
      // from the child's terminal state for backwards compatibility.
      if (!hasSelector) {
        const outputPatch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(childFinalContext)) {
          if (k !== 'error') {
            outputPatch[k] = v;
          }
        }
        if (Object.keys(outputPatch).length > 0) {
          applyContextPatch(outputPatch as Partial<TContext>);
        }
      }

      destroyActiveSubNode();
      if (fsm.hasTransitionFor(refId, outcome)) {
        dispatchInternal(outcome, outputPayload, true);
      } else {
        throw new Error(
          `[MatrixFSM Error]: Sub-machine '${refId}' emitted output '${outcome}', but parent '${fsm.id}' has no matching transition. Prevented silent deadlock!`,
        );
      }
    }
  };

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

  const handleTaskFailure = (handle: ActiveTaskHandle, err: unknown): void => {
    if (handle.cancelled || activeTask !== handle) {
      return;
    }
    activeTask = null;

    const activeStateName = fsmStateSig();

    // Check if err has a `_tag` (e.g. TaggedError) or custom Error `.name` matching a transition row
    if (typeof err === 'object' && err !== null) {
      if (
        '_tag' in err &&
        typeof (err as { _tag: unknown })._tag === 'string'
      ) {
        const tag = (err as { _tag: string })._tag;
        if (fsm.hasTransitionFor(activeStateName, tag)) {
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
        if (fsm.hasTransitionFor(activeStateName, errName)) {
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
      const adapters = effectiveConfig?.taskAdapter
        ? [effectiveConfig.taskAdapter, ...registeredTaskAdapters]
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
      if (result && typeof (result as Promise<unknown>).then === 'function') {
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

  const syncEachInstances = (
    eachNode: EachNode<any, any>,
    inputMapped?: Record<string, unknown> | null,
  ): void => {
    const key = eachNode.key;
    const ctx = getEffectiveContext() as Record<string, unknown>;
    const rawArray = Array.isArray(ctx[key]) ? (ctx[key] as unknown[]) : [];

    let registry = eachRegistries.get(key);
    if (!registry) {
      registry = new Map<string, SubMachineRuntimeNode<any>>();
      eachRegistries.set(key, registry);
    }

    const activeIds = new Set<string>();
    for (const item of rawArray) {
      const id = extractItemId(item);
      activeIds.add(id);
      if (!registry.has(id)) {
        const itemContext =
          typeof item === 'object' && item !== null
            ? { ...(ctx as Record<string, unknown>), ...(inputMapped ?? {}), ...(item as Record<string, unknown>) }
            : { ...(ctx as Record<string, unknown>), ...(inputMapped ?? {}), itemId: id };

        const childNode = spawnChildNode(
          eachNode.machine,
          itemContext,
          () => {
            publishChildSnapshots();
            checkEachAllDone(eachNode);
          },
        );
        registry.set(id, childNode);
      }
    }

    // Remove and destroy instances whose ID is no longer in the array
    for (const [existingId, existingChild] of [...registry.entries()]) {
      if (!activeIds.has(existingId)) {
        if (existingChild.destroy) {
          existingChild.destroy();
        }
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
          state: instance.fsmState(),
          subState: instance.fsmSubState(),
          context: instance.fsmContext(),
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
        const aggregatedOutputs = instances.map((inst) => inst.fsmContext());
        dispatchInternal('ALL_DONE', aggregatedOutputs);
      }
    }
  };

  const enterSubMachineNode = (
    subRef: SubMachineRef<any, any>,
    inputMapped: Record<string, unknown> | null,
  ): void => {
    destroyActiveSubNode();
    activeSubRef = subRef;
    activeSubRefIdSig.set(subRef.id);
    const isFeatureSubMachine = defaultFeatureConfigs.has(subRef.machine);
    activeSubIsFeatureSig.set(isFeatureSubMachine);
    const initialSubInput = isFeatureSubMachine
      ? { ...(inputMapped ?? {}) }
      : {
          ...(getEffectiveContext() as Record<string, unknown>),
          ...(inputMapped ?? {}),
        };

    const childNode = spawnChildNode(
      subRef.machine,
      initialSubInput,
      () => {
        checkSubNodeCompletion();
        onNotifyParent?.();
      },
      (emitted) => {
        if (!activeSubRef) {
          return;
        }
        const refId = activeSubRef.id;
        if (!fsm.hasTransitionFor(refId, emitted.type)) {
          throw new Error(
            `[MatrixFSM Error]: Sub-machine '${refId}' emitted output '${emitted.type}', but parent '${fsm.id}' has no matching transition. Prevented silent deadlock!`,
          );
        }
        dispatchInternal(emitted.type, emitted.payload, true);
      },
    );
    activeSubNode = childNode;
    activeSubNodeSig.set(childNode);
    syncSubNodeSignals();
    checkSubNodeCompletion();
  };

  const canSubNodeHandleEvent = (
    subRef: SubMachineRef<any, any>,
    node: SubMachineRuntimeNode<any>,
    event: string,
  ): boolean => {
    const childCurrentState = node.fsmState();
    if (subRef.machine.hasTransitionFor(childCurrentState, event)) {
      return true;
    }
    const nestedSubRef = subRef.machine.subMachines.get(childCurrentState);
    const nestedSubState = node.fsmSubState();
    if (nestedSubRef && nestedSubState) {
      return nestedSubRef.machine.hasTransitionFor(nestedSubState, event);
    }
    return false;
  };

  const dispatchInternal = (
    event: string,
    payload?: unknown,
    fromChildOutput = false,
  ): void => {
    const currentState = untracked(() => fsmStateSig());
    const currentCtx = getEffectiveContext();

    // 1. Handle subMachine delegation vs parent group-interrupt (Cooperative Cancel vs Hard Kill!)
    if (!fromChildOutput && activeSubNode && activeSubRef) {
      const subHandlesEvent = canSubNodeHandleEvent(
        activeSubRef,
        activeSubNode,
        event,
      );
      const parentHasTransition = fsm.hasTransitionFor(activeSubRef.id, event);

      if (subHandlesEvent) {
        activeSubNode.send(event, payload);
        checkSubNodeCompletion();
        onNotifyParent?.();
        return;
      } else if (!parentHasTransition) {
        return;
      }
    }

    // 2. Evaluate parent transition
    const evaluation = fsm.evaluate(
      currentState,
      event,
      payload,
      currentCtx,
    );

    if (!evaluation.matched) {
      return;
    }

    // If leaving an active sub-machine (e.g. Hard Kill via [baristaFSM, 'CANCEL', 'customerBrowsing']),
    // atomically abort child tasks & destroy child instance in the exact same tick!
    if (!evaluation.stayed && activeSubNode && activeSubRef) {
      const childCurrentState = activeSubNode.fsmState();
      onExitHooks[childCurrentState]?.(getEffectiveContext());
      destroyActiveSubNode();
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

    const freshCtx = getEffectiveContext();
    const resolvedEmittedOutput = evaluation.emittedOutput
      ? {
          type: evaluation.emittedOutput.type,
          payload: evaluation.outputSelector
            ? evaluation.outputSelector(freshCtx, payload)
            : evaluation.emittedOutput.payload,
        }
      : null;
    const resolvedFinalPayload = evaluation.hasFinalPayloadSelector
      ? resolvedEmittedOutput?.payload
      : evaluation.finalPayload;

    // In-place stay(): patch/call applied, keep current state, do NOT re-enter or interrupt tasks!
    if (evaluation.stayed) {
      const activeEach = fsm.eachNodes.get(currentState);
      if (activeEach) {
        syncEachInstances(activeEach, evaluation.inputMapped);
      }
      onNotifyParent?.();
      if (resolvedEmittedOutput) {
        onEmitOutput?.(resolvedEmittedOutput);
      }
      return;
    }

    // Leaving current state -> cancel any in-flight awaiting task or active `each` pool!
    cancelActiveTask();
    const exitingEach = fsm.eachNodes.get(currentState);
    if (exitingEach && evaluation.nextState !== currentState) {
      const poolToCancel = eachRegistries.get(exitingEach.key);
      if (poolToCancel) {
        for (const child of poolToCancel.values()) {
          if (!child.isDone() && child.destroy) {
            child.destroy();
          }
        }
      }
    }

    onExitHooks[currentState]?.(getEffectiveContext());

    const nextState = evaluation.nextState;
    fsmStateSig.set(nextState);

    if (evaluation.finalOutcome !== null) {
      hasFinalPayloadSelectorSig.set(
        Boolean(evaluation.hasFinalPayloadSelector),
      );
      finalPayloadSig.set(
        evaluation.hasFinalPayloadSelector
          ? resolvedFinalPayload
          : getEffectiveContext(),
      );
      doneOutcomeSig.set(evaluation.finalOutcome);
    }

    if (evaluation.enteredSubMachine) {
      enterSubMachineNode(
        evaluation.enteredSubMachine,
        evaluation.inputMapped,
      );
    } else {
      fsmSubStateSig.set(null);
      fsmSubContextSig.set(null);
    }

    if (evaluation.enteredEach) {
      syncEachInstances(evaluation.enteredEach, evaluation.inputMapped);
    }

    onEnterHooks[nextState]?.(getEffectiveContext());

    if (evaluation.isAwaiting) {
      startAwaitingTaskIfNeeded(nextState);
    }

    onNotifyParent?.();

    if (evaluation.finalOutcome === null && resolvedEmittedOutput) {
      onEmitOutput?.(resolvedEmittedOutput);
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
    onNotifyParent?.();
  };

  const patchContext = (patch: Partial<TContext>): void => {
    applyContextPatch(patch);
  };

  const reset = (initialOverrideArg?: Partial<TContext>): void => {
    cancelActiveTask();
    destroyActiveSubNode();
    destroyAllEachPools();
    doneOutcomeSig.set(null);
    finalPayloadSig.set(undefined);
    hasFinalPayloadSelectorSig.set(false);
    const nextInit = {
      ...(fsm.context ?? {}),
      ...initialStoreStateSnapshot,
      ...(initialOverrideArg ?? {}),
    } as TContext;
    rawContextSig.set(nextInit);
    if (!hostStore) {
      patchState(effectiveStoreSource as any, nextInit as Record<string, unknown>);
    } else if (storeStateKeys.size > 0) {
      const storeResetPatch: Record<string, unknown> = {
        ...initialStoreStateSnapshot,
      };
      if (initialOverrideArg && typeof initialOverrideArg === 'object') {
        for (const [k, v] of Object.entries(initialOverrideArg)) {
          if (storeStateKeys.has(k)) {
            storeResetPatch[k] = v;
          }
        }
      }
      patchState(effectiveStoreSource as any, storeResetPatch);
    }
    fsmStateSig.set(fsm.initial as TState);
    childMachinesSig.set({});
    if (fsm.awaitingStates.has(fsm.initial)) {
      startAwaitingTaskIfNeeded(fsm.initial);
    }
  };

  // If initial state itself is an awaiting node, initialize it
  if (fsm.awaitingStates.has(fsm.initial)) {
    startAwaitingTaskIfNeeded(fsm.initial);
  }

  return {
    fsmState: fsmStateSig.asReadonly(),
    fsmSubState: fsmSubStateSig.asReadonly(),
    fsmSubContext: fsmSubContextSig.asReadonly(),
    fsmContext,
    actors,
    isPending,
    isDone,
    finalOutcome: doneOutcomeSig.asReadonly(),
    finalPayload: finalPayloadSig.asReadonly(),
    hasFinalPayloadSelector: hasFinalPayloadSelectorSig.asReadonly(),
    childMachines: childMachinesSig.asReadonly(),
    send,
    sendToChild,
    patchContext,
    reset,
    destroy,
    __setNotifyParent: (cb: () => void) => {
      onNotifyParent = cb;
    },
    __setEmitOutputHandler: (
      cb: (output: { readonly type: string; readonly payload: unknown }) => void,
    ) => {
      onEmitOutput = cb;
    },
  };
}

/**
 * Custom `@ngrx/signals` feature that binds a `@matrix-fsm/core` state machine
 * directly to SignalStore's `withState` and `withMethods`, with native Promise,
 * RxJS Observable, and pluggable task runner support.
 *
 * Also supports standalone encapsulated sub-machine stores via `{ state, methods, tasks }`
 * and automatically registers the machine's default spawn factory for hierarchical tree composition.
 */
export function withStateMachine<
  TFSM extends AnyFSMDefinition,
  TConfig extends StateMachineFeatureConfig<TFSM, any> = StateMachineFeatureConfig<
    TFSM,
    EmptyObject
  >,
>(
  fsm: TFSM,
  ...configArgs: [OwnAwaitingNodes<TFSM>] extends [never]
    ? [config?: TConfig & StateMachineFeatureConfig<TFSM, any>]
    : [config: TConfig & StateMachineFeatureConfig<TFSM, any>]
): SignalStoreFeature<
  {
    state: EmptyFeatureResult['state'];
    props: EmptyFeatureResult['props'];
    methods: RequiredStoreMethods<
      TFSM,
      TConfig extends { readonly methods: (store: any) => infer M }
        ? M
        : TConfig extends { readonly methods: infer M extends object }
          ? M
          : EmptyObject
    >;
  },
  {
    state: TConfig extends { readonly state: any }
      ? ExtractContext<TFSM>
      : EmptyFeatureResult['state'];
    props: StateMachineStoreMembers<TFSM>;
    methods: EmptyFeatureResult['methods'];
  }
> {
  const [config] = configArgs;

  // Automatically bind a default spawn factory for `fsm` whenever `withStateMachine(fsm, config)`
  // is declared, so parent machines that transition into `fsm` can spawn an encapsulated
  // child runner with zero parent-store coupling!
  bindDefaultMachineFactory(
    fsm,
    (injector, initialOverride, onNotifyParent, onEmitOutput) =>
      createScopedMachineRunner(
        fsm,
        config,
        injector,
        initialOverride,
        undefined,
        onNotifyParent,
        onEmitOutput,
      ),
  );

  const features: SignalStoreFeature<any, any>[] = [];

  if (config?.state !== undefined) {
    features.push(
      withState(() => resolveFactoryOrValue(config.state) as object),
    );
  }

  if (typeof config?.methods === 'function') {
    const methodsFactory = config.methods;
    features.push(
      withMethods((store) => methodsFactory(store) as Record<string, any>),
    );
  }

  features.push(
    withProps<any, StateMachineStoreMembers<TFSM>>(
      (store): StateMachineStoreMembers<TFSM> => {
        let hostInjector: Injector | null = null;
        try {
          hostInjector = inject(Injector, { optional: true });
        } catch {
          hostInjector = null;
        }

        const runner = createScopedMachineRunner(
          fsm,
          config,
          hostInjector,
          undefined,
          store as Record<string, any>,
        );

        try {
          const destroyRef = inject(DestroyRef, { optional: true });
          destroyRef?.onDestroy(() => {
            runner.destroy();
          });
        } catch {
          // Instantiated outside Angular DI context
        }

        return runner;
      },
    ),
  );

  return (signalStoreFeature as (...f: any[]) => any)(...features);
}

// ============================================================================
// Cohesive Sub-Machine Actor Feature (`createMachineFeature`)
// ============================================================================

export interface MachineFeatureContract {
  readonly inputs?: Record<string, any>;
  readonly events?: Record<string, any>;
  readonly outputs?: Record<string, any>;
  readonly states?: string;
}

type FeatureInputs<T extends MachineFeatureContract> =
  T extends { readonly inputs: infer I extends Record<string, any> }
    ? I
    : EmptyObject;

type FeatureEvents<T extends MachineFeatureContract> =
  T extends { readonly events: infer E extends Record<string, any> }
    ? E
    : EmptyObject;

type FeatureOutputs<T extends MachineFeatureContract> =
  T extends { readonly outputs: infer O extends Record<string, any> }
    ? O
    : EmptyObject;

type FeatureStates<T extends MachineFeatureContract> =
  T extends { readonly states: infer S extends string } ? S : string;

export type ExtractShallowAwaitingFromTransitions<
  TTransitions extends readonly any[],
> = TTransitions[number] extends infer Row
  ? Row extends readonly [any, any, AwaitingNode<infer S>, ...any[]]
    ? S
    : Row extends readonly [infer From extends string, 'DONE' | 'ERROR', ...any[]]
      ? From
      : never
  : never;

export type MachineFeatureConfig<
  TId extends string,
  TInitial extends TDeclaredStates,
  TInputs extends object,
  TState extends object,
  TEvents extends Record<string, any>,
  TOutputs extends Record<string, any>,
  TDeclaredStates extends string,
  TMethods extends Record<string, any>,
  TTransitions extends readonly TransitionRow<
    TInputs & TState,
    Extract<keyof TEvents, string>,
    TDeclaredStates,
    any,
    TOutputs
  >[],
> = {
  readonly id: TId;
  readonly initial: TInitial;
  readonly transitions: TTransitions &
    ValidateTransitionRows<
      TTransitions,
      NoInfer<TInputs & TState>,
      Extract<keyof TEvents, string>,
      NoInfer<TMethods>,
      TOutputs
    >;
  readonly state?: TState;
  readonly syncContext?:
    | (() => SyncContextMap<NoInfer<TInputs & TState>>)
    | SyncContextMap<NoInfer<TInputs & TState>>;
  readonly methods?:
    | ((
        store: WritableStateSource<NoInfer<TInputs & TState>> &
          DeepSignalOf<NoInfer<TInputs & TState>> &
          Record<string, any>,
      ) => TMethods)
    | TMethods;
  readonly taskAdapter?: CustomTaskAdapter;
  readonly onEnter?:
    | (() => Partial<
        Record<
          TDeclaredStates,
          (ctx: Readonly<NoInfer<TInputs & TState>>) => void
        >
      >)
    | Partial<
        Record<
          TDeclaredStates,
          (ctx: Readonly<NoInfer<TInputs & TState>>) => void
        >
      >;
  readonly onExit?:
    | (() => Partial<
        Record<
          TDeclaredStates,
          (ctx: Readonly<NoInfer<TInputs & TState>>) => void
        >
      >)
    | Partial<
        Record<
          TDeclaredStates,
          (ctx: Readonly<NoInfer<TInputs & TState>>) => void
        >
      >;
} & ([ExtractShallowAwaitingFromTransitions<NoInfer<TTransitions>>] extends [
  never,
]
  ? {
      readonly tasks?:
        | ((
            ...args: any[]
          ) => Record<
            string,
            TaskHandler<NoInfer<TInputs & TState>, NoInfer<TInputs & TState>>
          >)
        | Record<
            string,
            TaskHandler<NoInfer<TInputs & TState>, NoInfer<TInputs & TState>>
          >;
    }
  : {
      readonly tasks:
        | ((
            ...args: any[]
          ) => {
            readonly [K in ExtractShallowAwaitingFromTransitions<
              NoInfer<TTransitions>
            >]: TaskHandler<NoInfer<TInputs & TState>, NoInfer<TInputs & TState>>;
          } & Record<
            string,
            TaskHandler<NoInfer<TInputs & TState>, NoInfer<TInputs & TState>>
          >)
        | ({
            readonly [K in ExtractShallowAwaitingFromTransitions<
              NoInfer<TTransitions>
            >]: TaskHandler<NoInfer<TInputs & TState>, NoInfer<TInputs & TState>>;
          } & Record<
            string,
            TaskHandler<NoInfer<TInputs & TState>, NoInfer<TInputs & TState>>
          >);
    });

/**
 * Cohesive Sub-Machine Actor Creator ("Sandwich-Pattern"):
 * Combines Public Contract (`inputs`, `events`, `outputs`, `states`) at the top,
 * the visual Transition Matrix in the middle, and isolated Runtime Implementation
 * (`state`, `methods`, `tasks`) at the bottom — with zero `provideStateMachine` boilerplate!
 */
export function createMachineFeature<
  TContract extends MachineFeatureContract = EmptyObject,
>(): <
  const TId extends string,
  const TInitial extends FeatureStates<TContract>,
  const TTransitions extends readonly TransitionRow<
    FeatureInputs<TContract> & TState,
    Extract<keyof FeatureEvents<TContract>, string>,
    FeatureStates<TContract>,
    any,
    FeatureOutputs<TContract>
  >[],
  TState extends object = EmptyObject,
  TMethods extends Record<string, any> = Record<string, any>,
>(
  config: MachineFeatureConfig<
    TId,
    TInitial,
    FeatureInputs<TContract>,
    TState,
    FeatureEvents<TContract>,
    FeatureOutputs<TContract>,
    FeatureStates<TContract>,
    TMethods,
    TTransitions
  >,
) => FSMDefinition<
  TId,
  TInitial,
  ResolveContext<FeatureInputs<TContract> & TState, TTransitions>,
  FeatureEvents<TContract>,
  TTransitions,
  TMethods,
  FeatureInputs<TContract>,
  FeatureOutputs<TContract>
> {
  return (config: any) => {
    const fsm = createFSM<any>()({
      id: config.id,
      initial: config.initial,
      context: config.state,
      transitions: config.transitions,
    });

    const featureRuntimeConfig: StateMachineFeatureConfig<any, any> = {
      state: config.state,
      syncContext: config.syncContext,
      methods: config.methods,
      tasks: config.tasks,
      taskAdapter: config.taskAdapter,
      onEnter: config.onEnter,
      onExit: config.onExit,
    };

    defaultFeatureConfigs.set(fsm, featureRuntimeConfig);

    bindDefaultMachineFactory(
      fsm,
      (injector, initialOverride, onNotifyParent, onEmitOutput) =>
        createScopedMachineRunner(
          fsm,
          featureRuntimeConfig,
          injector,
          initialOverride,
          undefined,
          onNotifyParent,
          onEmitOutput,
        ),
    );

    return fsm as any;
  };
}
