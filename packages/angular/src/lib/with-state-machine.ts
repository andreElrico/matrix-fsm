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
  createWatch,
  type Watch,
} from '@angular/core/primitives/signals';
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
  after,
  all,
  always,
  any,
  anyState,
  awaiting,
  createFSM,
  each,
  every,
  finalState,
  getShortestPaths,
  invokeCallSelector,
  isAfterNode,
  isAlwaysNode,
  isEveryNode,
  isOutcomeNode,
  MAX_SYNC_MICROSTEPS,
  MatrixFsmInfiniteLoopError,
  outcome,
  race,
  resolveDebugLogger,
  resolveSourceIds,
  stay,
  subMachine,
  toMermaid,
  transitions,
  type AfterNode,
  type AllNode,
  type AlwaysNode,
  type AnyFSMDefinition,
  type AnyNode,
  type AnyStateNode,
  type AwaitingNode,
  type CombinatorNode,
  type DebugLogger,
  type EachNode,
  type EmptyObject,
  type EveryNode,
  type ExtractAllSubMachines,
  type ExtractAwaitingNodes,
  type ExtractContext,
  type ExtractEventPayload,
  type ExtractEvents,
  type ExtractInput,
  type ExtractMethods,
  type ExtractOwnAwaitingNodes,
  type ExtractStates,
  type ExtractTerminalOutputs,
  type FSMDefinition,
  type InspectCallback,
  type InspectEvent,
  type MachineSnapshot,
  type OutcomeNode,
  type RaceNode,
  type ResolveContext,
  type ResourceRefLike,
  type ShortestPathStep,
  type SubMachineRef,
  type SubscribableLike,
  type TransitionCallSelector,
  type TransitionRow,
  type ValidateTransitionRows,
  type VoidOutputKeys,
} from '@matrix-fsm/core';

export {
  after,
  all,
  always,
  any,
  anyState,
  awaiting,
  createFSM,
  each,
  every,
  finalState,
  getShortestPaths,
  isAlwaysNode,
  isEveryNode,
  isOutcomeNode,
  MAX_SYNC_MICROSTEPS,
  MatrixFsmInfiniteLoopError,
  outcome,
  race,
  stay,
  subMachine,
  toMermaid,
  transitions,
  type AfterNode,
  type AllNode,
  type AlwaysNode,
  type AnyNode,
  type AnyStateNode,
  type CombinatorNode,
  type EveryNode,
  type ExtractTerminalOutputs,
  type InspectCallback,
  type InspectEvent,
  type MachineSnapshot,
  type OutcomeNode,
  type RaceNode,
  type ResourceRefLike,
  type ShortestPathStep,
  type SubscribableLike,
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
 * Internal async executor adapter interface (used by `@matrix-fsm/angular/effect`).
 */
export interface CustomTaskAdapter {
  canHandle(result: unknown): boolean;
  execute<TContext>(
    result: unknown,
    callbacks: {
      onSuccess: (output: unknown) => void;
      onFailure: (err: unknown) => void;
      isCancelled: () => boolean;
    },
  ): () => void;
}

export type SubMachineAwaitingNodes<TFSM extends AnyFSMDefinition> =
  ExtractAwaitingNodes<ExtractAllSubMachines<TFSM>>;

export type OwnAwaitingNodes<TFSM extends AnyFSMDefinition> =
  ExtractOwnAwaitingNodes<TFSM>;

export type SyncContextMap<TContext extends object> = {
  readonly [K in keyof TContext]?: Signal<TContext[K]> | TContext[K];
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
   * Optional pluggable task runner adapter (e.g. used internally by `createEffectMachineFeature`).
   */
  readonly taskAdapter?: CustomTaskAdapter;
  /**
   * Optional structured debug logger (`true` for `console.debug` or a custom callback).
   */
  readonly debug?: DebugLogger;
  /**
   * Optional transition telemetry callback invoked on every matched transition.
   */
  readonly inspect?: InspectCallback<TFSM>;
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
};

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
  ...args: [void] extends [ExtractEventPayload<TFSM, TEvent>]
    ? [event: TEvent, payload?: ExtractEventPayload<TFSM, TEvent>]
    : [undefined] extends [ExtractEventPayload<TFSM, TEvent>]
      ? [event: TEvent, payload?: ExtractEventPayload<TFSM, TEvent>]
      : unknown extends ExtractEventPayload<TFSM, TEvent>
        ? [event: TEvent, payload?: unknown]
        : [event: TEvent, payload: ExtractEventPayload<TFSM, TEvent>]
) => void;

export type CanFn<TFSM extends AnyFSMDefinition> = <
  TEvent extends AllowedSendEvents<TFSM>,
>(
  ...args: [void] extends [ExtractEventPayload<TFSM, TEvent>]
    ? [event: TEvent, payload?: ExtractEventPayload<TFSM, TEvent>]
    : [undefined] extends [ExtractEventPayload<TFSM, TEvent>]
      ? [event: TEvent, payload?: ExtractEventPayload<TFSM, TEvent>]
      : unknown extends ExtractEventPayload<TFSM, TEvent>
        ? [event: TEvent, payload?: unknown]
        : [event: TEvent, payload: ExtractEventPayload<TFSM, TEvent>]
) => boolean;

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
  readonly state: Signal<ExtractStates<TFSM>>;
  readonly fsmState: Signal<ExtractStates<TFSM>>;
  readonly stateEpoch: Signal<number>;
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
  readonly can: CanFn<TFSM>;
  readonly send: SendFn<TFSM>;
  readonly sendToChild: (
    key: string,
    itemId: string,
    event: string,
    payload?: unknown,
  ) => void;
  readonly patchContext: (patch: Partial<ExtractContext<TFSM>>) => void;
  readonly getSnapshot: () => MachineSnapshot<TFSM>;
  readonly restoreSnapshot: (snapshot: MachineSnapshot<TFSM>) => void;
  readonly reset: (initialOverride?: Partial<ExtractContext<TFSM>>) => void;
  readonly destroy: () => void;
}

// ============================================================================
// Scoped Sub-Machine DI Token & Default Factory Registry
// ============================================================================

export interface SubMachineRuntimeNode<
  TFSM extends AnyFSMDefinition = AnyFSMDefinition,
> {
  readonly state?: Signal<string>;
  readonly fsmState: Signal<string>;
  readonly fsmSubState: Signal<string | null>;
  readonly fsmSubContext: Signal<Readonly<Record<string, any>> | null>;
  readonly fsmContext: Signal<ExtractContext<TFSM>>;
  readonly isPending: Signal<boolean>;
  readonly isDone: Signal<boolean>;
  readonly finalOutcome: Signal<string | null>;
  readonly finalPayload?: Signal<unknown>;
  readonly hasFinalPayloadSelector?: Signal<boolean>;
  readonly can?: (...args: any[]) => boolean;
  readonly send: (...args: any[]) => void;
  readonly patchContext?: (patch: Partial<ExtractContext<TFSM>>) => void;
  readonly getSnapshot?: () => MachineSnapshot<TFSM>;
  readonly restoreSnapshot?: (snapshot: MachineSnapshot<TFSM>) => void;
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
  readonly entryEpoch: number;
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

const DUMMY_DI_DEP = Object.freeze({});

function resolveMethodsConfig(
  input: ((...args: any[]) => any) | Record<string, any> | undefined,
  store: any,
  hostInjector: Injector | null,
): Record<string, any> {
  if (!input) {
    return {};
  }
  if (typeof input !== 'function') {
    return input;
  }
  try {
    if (hostInjector) {
      return runInInjectionContext(hostInjector, () => input(store)) ?? {};
    }
    return (
      input(
        store,
        DUMMY_DI_DEP,
        DUMMY_DI_DEP,
        DUMMY_DI_DEP,
        DUMMY_DI_DEP,
        DUMMY_DI_DEP,
      ) ?? {}
    );
  } catch (err) {
    if (
      !hostInjector &&
      err instanceof Error &&
      (err.message.includes('NG0203') ||
        err.message.includes('inject() must be called'))
    ) {
      return {};
    }
    throw err;
  }
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

function isResourceRef(value: unknown): value is ResourceRefLike<any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ResourceRefLike<any>).status === 'function' &&
    typeof (value as ResourceRefLike<any>).value === 'function' &&
    typeof (value as ResourceRefLike<any>).error === 'function' &&
    typeof (value as ResourceRefLike<any>).reload === 'function'
  );
}

declare const ngDevMode: boolean | undefined;

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
  actorMethodsOverrides?: Record<
    string,
    | ((store: any) => Record<string, (...args: any[]) => any>)
    | Record<string, (...args: any[]) => any>
    | undefined
  >,
  onTrackPromise?: (p: PromiseLike<unknown>) => void,
): StateMachineStoreMembers<TFSM> & {
  readonly finalPayload: Signal<unknown>;
  readonly hasFinalPayloadSelector: Signal<boolean>;
  readonly __flushPendingWatches: () => void;
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

  const runWithDI = <R>(fn: () => R): R | undefined => {
    try {
      return hostInjector ? runInInjectionContext(hostInjector, fn) : fn();
    } catch (err) {
      if (
        !hostInjector &&
        err instanceof Error &&
        (err.message.includes('NG0203') ||
          err.message.includes('inject() must be called'))
      ) {
        return undefined;
      }
      throw err;
    }
  };

  const SyncContextMapResolved = runWithDI(() =>
    resolveFactoryOrValue(effectiveConfig?.syncContext),
  );
  const syncedSignals: Record<string, Signal<unknown> | undefined> = {};
  const initialSyncedPatch: Record<string, unknown> = {};
  if (SyncContextMapResolved && typeof SyncContextMapResolved === 'object') {
    for (const [k, val] of Object.entries(SyncContextMapResolved)) {
      if (isSignal(val)) {
        syncedSignals[k] = val;
        initialSyncedPatch[k] = untracked(() => val());
      } else {
        initialSyncedPatch[k] = val;
      }
    }
  }

  const configuredInitialState = (runWithDI(() =>
    resolveFactoryOrValue(effectiveConfig?.state),
  ) ?? {}) as Record<string, unknown>;

  const effectiveStoreSource =
    hostStore ??
    signalState<Record<string, unknown>>({
      ...(fsm.context ?? {}),
      ...configuredInitialState,
      ...initialSyncedPatch,
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
  const stateEpochSig = signal<number>(0);
  let stateEpoch = 0;
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
    ...initialSyncedPatch,
    ...(initialOverride ?? {}),
  } as TContext);

  if (hostStore && Object.keys(initialSyncedPatch).length > 0) {
    const storeSyncPatch: Record<string, unknown> = {};
    let hasSyncKey = false;
    for (const [k, v] of Object.entries(initialSyncedPatch)) {
      if (storeStateKeys.size === 0 || storeStateKeys.has(k)) {
        storeSyncPatch[k] = v;
        hasSyncKey = true;
      }
    }
    if (hasSyncKey) {
      patchState(effectiveStoreSource as any, storeSyncPatch);
    }
  }

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

  const explicitMethods = resolveMethodsConfig(
    effectiveConfig?.methods,
    virtualStoreTarget,
    hostInjector,
  ) as Record<string, (...args: any[]) => any>;

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
  let activeCombinator: {
    readonly node: CombinatorNode<any, any>;
    readonly children: SubMachineRuntimeNode<any>[];
    readonly failedIndices: Set<number>;
    settled: boolean;
  } | null = null;
  const combinatorTickSig = signal<number>(0);
  const activeTimers: Array<ReturnType<typeof setTimeout>> = [];
  const activeEveryTimers = new Map<
    string,
    {
      timerId: ReturnType<typeof setTimeout> | null;
      currentDelay: number;
      via: EveryNode<any>;
    }
  >();
  const activeWatchers: Watch[] = [];
  const pendingWatchRuns = new Set<Watch>();
  let isFlushingWatches = false;

  const flushPendingSignalWatches = (): void => {
    if (isFlushingWatches || pendingWatchRuns.size === 0) {
      return;
    }
    isFlushingWatches = true;
    try {
      const toRun = [...pendingWatchRuns];
      pendingWatchRuns.clear();
      for (const w of toRun) {
        w.run();
      }
    } finally {
      isFlushingWatches = false;
    }
  };
  const eachRegistries = new Map<
    string,
    Map<string, SubMachineRuntimeNode<any>>
  >();

  const clearActiveTimers = (): void => {
    for (const timer of activeTimers) {
      clearTimeout(timer);
    }
    activeTimers.length = 0;
    for (const entry of activeEveryTimers.values()) {
      if (entry.timerId !== null) {
        clearTimeout(entry.timerId);
      }
    }
    activeEveryTimers.clear();
  };

  const destroySignalWatchers = (): void => {
    pendingWatchRuns.clear();
    for (const watcher of activeWatchers) {
      watcher.destroy();
    }
    activeWatchers.length = 0;
  };

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
        combinatorTickSig();
        const refId = activeSubRefIdSig();
        const node = activeSubNodeSig();
        if (refId === subId && node) {
          return node.fsmContext() as Readonly<Record<string, any>>;
        }
        if (activeCombinator && !activeCombinator.settled) {
          const idx = activeCombinator.node.machines.findIndex(
            (m: AnyFSMDefinition) => m.id === subId,
          );
          if (idx >= 0 && activeCombinator.children[idx]) {
            return activeCombinator.children[idx].fsmContext() as Readonly<
              Record<string, any>
            >;
          }
        }
        return null;
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

  const destroyActiveCombinator = (): void => {
    if (!activeCombinator) {
      return;
    }
    const combToDestroy = activeCombinator;
    combToDestroy.settled = true;
    activeCombinator = null;
    combinatorTickSig.update((n) => n + 1);
    for (const child of combToDestroy.children) {
      if (child.destroy) {
        child.destroy();
      } else {
        child.reset();
      }
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

  let isDestroyed = false;

  const destroy = (): void => {
    isDestroyed = true;
    eventQueue.length = 0;
    onNotifyParent = undefined;
    onEmitOutput = undefined;
    destroySignalWatchers();
    clearActiveTimers();
    cancelActiveTask();
    destroyActiveSubNode();
    destroyActiveCombinator();
    destroyAllEachPools();
  };

  const isPending = computed<boolean>(() => {
    combinatorTickSig();
    const currentState = fsmStateSig();
    const subState = fsmSubStateSig();
    if (activeSubNode && activeSubRef && subState) {
      return activeSubNode.isPending();
    }
    if (activeCombinator && !activeCombinator.settled) {
      for (const child of activeCombinator.children) {
        if (child.isPending()) {
          return true;
        }
      }
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

    // If `actorMethods` overrides or `onTrackPromise` (e.g. via `createFeatureTester`) are active,
    // spawn a scoped runner for `subFSM` with its feature config + overridden methods!
    const childActorMethodOverrides = actorMethodsOverrides?.[subFSM.id];
    const childBaseConfig = defaultFeatureConfigs.get(subFSM);
    if (childActorMethodOverrides || (onTrackPromise && childBaseConfig)) {
      return createScopedMachineRunner(
        subFSM,
        {
          ...childBaseConfig,
          methods: (store: any) => ({
            ...resolveMethodsConfig(
              childBaseConfig?.methods,
              store,
              hostInjector,
            ),
            ...resolveMethodsConfig(
              childActorMethodOverrides,
              store,
              hostInjector,
            ),
          }),
          taskAdapter:
            childBaseConfig?.taskAdapter ?? effectiveConfig?.taskAdapter,
        },
        hostInjector,
        inputContext,
        undefined,
        onChildTransition,
        onChildEmitOutput,
        actorMethodsOverrides,
        onTrackPromise,
      );
    }

    if (factory) {
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

    // Fallback: create a scoped runner that shares explicit/host methods
    return createScopedMachineRunner(
      subFSM,
      {
        methods: () => getMethodsTarget(),
        taskAdapter: effectiveConfig?.taskAdapter,
      },
      hostInjector,
      inputContext,
      hostStore,
      onChildTransition,
      onChildEmitOutput,
      actorMethodsOverrides,
      onTrackPromise,
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
        dispatchInternal(outcome, outputPayload, true, true);
      } else {
        throw new Error(
          `[MatrixFSM Error]: Sub-machine '${refId}' emitted output '${outcome}', but parent '${fsm.id}' has no matching transition. Prevented silent deadlock!`,
        );
      }
    }
  };

  const handleTaskSuccess = (
    handle: ActiveTaskHandle,
    output: unknown,
  ): void => {
    if (
      isDestroyed ||
      handle.cancelled ||
      handle.abortController.signal.aborted ||
      stateEpoch !== handle.entryEpoch ||
      activeTask !== handle
    ) {
      return;
    }
    activeTask = null;

    if (isOutcomeNode(output)) {
      dispatchInternal(output.event, output.payload);
    } else {
      dispatchInternal('DONE', output);
    }
  };

  const handleTaskFailure = (handle: ActiveTaskHandle, err: unknown): void => {
    if (
      isDestroyed ||
      handle.cancelled ||
      handle.abortController.signal.aborted ||
      stateEpoch !== handle.entryEpoch ||
      activeTask !== handle
    ) {
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

    if (
      !fsm.hasTransitionFor(activeStateName, 'ERROR') &&
      !fsm.hasTransitionFor('*', 'ERROR')
    ) {
      onEmitOutput?.({ type: '__UNHANDLED_ERROR__', payload: err });
      return;
    }

    dispatchInternal('ERROR', err);
  };

  const startAwaitingTaskIfNeeded = (
    stateName: string,
    callSelector?: TransitionCallSelector<any, any, TContext> | null,
    eventPayload?: unknown,
  ): void => {
    const effectiveSelector =
      callSelector ?? fsm.awaitingCallSelectors?.get(stateName) ?? null;
    if (!effectiveSelector) {
      return;
    }
    const methodsTarget = getMethodsTarget();
    const taskFn =
      typeof effectiveSelector === 'function'
        ? effectiveSelector(methodsTarget)
        : methodsTarget[effectiveSelector];
    if (typeof taskFn !== 'function') {
      return;
    }

    cancelActiveTask();

    const abortController = new AbortController();
    const handle: ActiveTaskHandle = {
      stateName,
      entryEpoch: stateEpoch,
      cancelled: false,
      abortController,
      teardown: null,
    };
    activeTask = handle;

    const ctxSnapshot = getEffectiveContext();

    try {
      const result = taskFn.call(
        methodsTarget,
        eventPayload,
        abortController.signal,
        ctxSnapshot,
      );

      // 1. Check explicit executor adapter (used by createEffectMachineFeature in @matrix-fsm/angular/effect)
      if (effectiveConfig?.taskAdapter?.canHandle(result)) {
        handle.teardown = effectiveConfig.taskAdapter.execute<TContext>(result, {
          onSuccess: (output) => handleTaskSuccess(handle, output),
          onFailure: (err) => handleTaskFailure(handle, err),
          isCancelled: () => handle.cancelled,
        });
        return;
      }

      // 2. Native Promise support
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        const promiseResult = result as Promise<unknown>;
        onTrackPromise?.(promiseResult);
        promiseResult.then(
          (output) => handleTaskSuccess(handle, output),
          (err) => handleTaskFailure(handle, err),
        );
        return;
      }

      // 3. Native Angular ResourceRef support (resource / rxResource / httpResource)
      if (isResourceRef(result)) {
        const initialStatus = untracked(() => result.status());
        if (initialStatus !== 'loading' && initialStatus !== 'reloading') {
          untracked(() => result.reload());
        }
        let settled = false;
        let resourceWatch: Watch | null = null;
        const cleanupWatch = () => {
          if (resourceWatch) {
            const w = resourceWatch;
            resourceWatch = null;
            pendingWatchRuns.delete(w);
            w.destroy();
          }
        };
        handle.teardown = cleanupWatch;
        resourceWatch = createWatch(
          () => {
            const st = result.status();
            if (settled || handle.cancelled) {
              return;
            }
            if (st === 'resolved' || st === 'local') {
              settled = true;
              const val = untracked(() => result.value());
              cleanupWatch();
              handle.teardown = null;
              untracked(() => handleTaskSuccess(handle, val));
            } else if (st === 'error') {
              settled = true;
              const err = untracked(() => result.error());
              cleanupWatch();
              handle.teardown = null;
              untracked(() => handleTaskFailure(handle, err));
            }
          },
          (watch) => {
            pendingWatchRuns.add(watch);
            queueMicrotask(() => {
              flushPendingSignalWatches();
            });
          },
          true,
        );
        resourceWatch.run();
        return;
      }

      // 4. Native RxJS Observable / Subscribable support (take(1) semantics + automatic unsubscribe on cancel)
      if (isSubscribable(result)) {
        let settled = false;
        let sub: { unsubscribe(): void } | (() => void) | null = null;
        const cleanupSub = () => {
          if (!sub) {
            return;
          }
          const s = sub;
          sub = null;
          if (typeof s === 'function') {
            s();
          } else if (typeof s.unsubscribe === 'function') {
            s.unsubscribe();
          }
        };
        handle.teardown = cleanupSub;
        sub = result.subscribe({
          next: (val) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanupSub();
            handle.teardown = null;
            handleTaskSuccess(handle, val);
          },
          error: (err) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanupSub();
            handle.teardown = null;
            handleTaskFailure(handle, err);
          },
          complete: () => {
            if (settled) {
              return;
            }
            settled = true;
            cleanupSub();
            handle.teardown = null;
            handleTaskSuccess(handle, undefined);
          },
        });
        if (settled) {
          cleanupSub();
        }
        return;
      }

      // 5. Synchronous return value
      handleTaskSuccess(handle, result);
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
    const singularKey =
      key.endsWith('s') && key.length > 1 ? key.slice(0, -1) : null;
    const isFeatureEach = defaultFeatureConfigs.has(eachNode.machine);
    const baseEachCtx = isFeatureEach ? {} : (ctx as Record<string, unknown>);

    for (const item of rawArray) {
      const id = extractItemId(item);
      activeIds.add(id);
      if (!registry.has(id)) {
        const itemContext =
          typeof item === 'object' && item !== null
            ? {
                ...baseEachCtx,
                ...(singularKey ? { [singularKey]: item } : {}),
                item,
                ...(inputMapped ?? {}),
                ...(item as Record<string, unknown>),
              }
            : {
                ...baseEachCtx,
                ...(singularKey ? { [singularKey]: item } : {}),
                item,
                ...(inputMapped ?? {}),
                itemId: id,
              };

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
      if (untracked(() => fsmStateSig()) === eachNode.id) {
        dispatchInternal('ALL_DONE', [], true, true);
      }
      return;
    }
    const instances = [...registry.values()];
    if (instances.length > 0 && instances.every((inst) => inst.isDone())) {
      if (untracked(() => fsmStateSig()) === eachNode.id) {
        const aggregatedOutputs = instances.map((inst) =>
          typeof inst.hasFinalPayloadSelector === 'function' &&
          inst.hasFinalPayloadSelector() &&
          typeof inst.finalPayload === 'function'
            ? inst.finalPayload()
            : inst.fsmContext(),
        );
        dispatchInternal('ALL_DONE', aggregatedOutputs, true, true);
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

  const extractChildTerminalPayload = (
    child: SubMachineRuntimeNode<any>,
  ): unknown => {
    const hasSelector =
      typeof child.hasFinalPayloadSelector === 'function' &&
      child.hasFinalPayloadSelector();
    if (hasSelector && typeof child.finalPayload === 'function') {
      return child.finalPayload();
    }
    return child.fsmContext();
  };

  const enterCombinatorNode = (
    combNode: CombinatorNode<any, any>,
    inputMapped: Record<string, unknown> | null,
  ): void => {
    destroyActiveCombinator();
    const children: SubMachineRuntimeNode<any>[] = [];
    const failedIndices = new Set<number>();
    const failedErrors: unknown[] = new Array(combNode.machines.length);
    const combState = {
      node: combNode,
      children,
      failedIndices,
      settled: false,
    };
    activeCombinator = combState;

    const settleCombinator = (preferredOutcome: string, payload: unknown) => {
      if (combState.settled || activeCombinator !== combState) {
        return;
      }
      combState.settled = true;
      const combId = combNode.id;
      destroyActiveCombinator();
      if (
        fsm.hasTransitionFor(combId, preferredOutcome) ||
        fsm.hasTransitionFor('anyState', preferredOutcome)
      ) {
        dispatchInternal(preferredOutcome, payload, true, true);
      } else if (
        fsm.hasTransitionFor(combId, 'ALL_DONE') ||
        fsm.hasTransitionFor('anyState', 'ALL_DONE')
      ) {
        dispatchInternal('ALL_DONE', payload, true, true);
      } else if (
        fsm.hasTransitionFor(combId, 'DONE') ||
        fsm.hasTransitionFor('anyState', 'DONE')
      ) {
        dispatchInternal('DONE', payload, true, true);
      }
    };

    const childSettled = new Array<boolean>(combNode.machines.length).fill(false);
    const completedOutputs: Record<string, unknown> = {};
    const orderedOutputs: unknown[] = new Array(combNode.machines.length);

    const evaluateCombinatorProgress = (idx: number) => {
      if (combState.settled || activeCombinator !== combState) {
        return;
      }
      combinatorTickSig.update((n) => n + 1);
      const child = children[idx];
      const childFSM = combNode.machines[idx];
      if (!child || !child.isDone() || childSettled[idx]) {
        return;
      }
      childSettled[idx] = true;
      const outcome = child.finalOutcome() ?? 'DONE';
      const childPayload = extractChildTerminalPayload(child);

      // Immediately tear down the finished child so its timers and watchers stop!
      child.destroy?.();

      if (combNode.__type === 'all') {
        completedOutputs[childFSM.id] = childPayload;
        orderedOutputs[idx] = childPayload;

        // Check if parent has a specific row for this child `[childFSM, outcome, ...]`
        if (fsm.hasTransitionFor(childFSM.id, outcome)) {
          dispatchInternal(
            outcome,
            childPayload,
            true,
            false,
            childFSM.id,
          );
          if (combState.settled || activeCombinator !== combState) {
            return;
          }
        } else if (outcome === 'ERROR') {
          settleCombinator('ERROR', childPayload);
          return;
        }

        if (
          children.length === combNode.machines.length &&
          childSettled.every(Boolean)
        ) {
          const combId = combNode.id;
          if (
            fsm.hasTransitionFor(combId, 'ALL_DONE') ||
            fsm.hasTransitionFor('anyState', 'ALL_DONE')
          ) {
            settleCombinator('ALL_DONE', { ...completedOutputs });
          } else {
            settleCombinator('DONE', orderedOutputs);
          }
        }
      } else if (combNode.__type === 'race') {
        if (fsm.hasTransitionFor(childFSM.id, outcome)) {
          combState.settled = true;
          destroyActiveCombinator();
          dispatchInternal(outcome, childPayload, true, true, childFSM.id);
          return;
        }
        settleCombinator(outcome, childPayload);
      } else if (combNode.__type === 'any') {
        if (outcome === 'ERROR') {
          failedIndices.add(idx);
          failedErrors[idx] = childPayload;
          if (failedIndices.size === combNode.machines.length) {
            settleCombinator('ERROR', failedErrors);
          }
        } else {
          if (fsm.hasTransitionFor(childFSM.id, outcome)) {
            combState.settled = true;
            destroyActiveCombinator();
            dispatchInternal(outcome, childPayload, true, true, childFSM.id);
            return;
          }
          settleCombinator(outcome, childPayload);
        }
      }
    };

    combNode.machines.forEach((childFSM: AnyFSMDefinition, idx: number) => {
      const isFeatureChild = defaultFeatureConfigs.has(childFSM);
      const keyedChildInput =
        inputMapped &&
        typeof inputMapped === 'object' &&
        childFSM.id in inputMapped &&
        typeof inputMapped[childFSM.id] === 'object' &&
        inputMapped[childFSM.id] !== null
          ? (inputMapped[childFSM.id] as Record<string, unknown>)
          : null;
      const initialChildInput = isFeatureChild
        ? { ...(inputMapped ?? {}), ...(keyedChildInput ?? {}) }
        : {
            ...(getEffectiveContext() as Record<string, unknown>),
            ...(inputMapped ?? {}),
            ...(keyedChildInput ?? {}),
          };

      const childNode = spawnChildNode(
        childFSM,
        initialChildInput,
        () => {
          evaluateCombinatorProgress(idx);
          onNotifyParent?.();
        },
        (emitted) => {
          if (combState.settled || activeCombinator !== combState) {
            return;
          }
          if (emitted.type === '__UNHANDLED_ERROR__') {
            if (combNode.__type === 'all' || combNode.__type === 'race') {
              settleCombinator('ERROR', emitted.payload);
            } else if (combNode.__type === 'any') {
              failedIndices.add(idx);
              failedErrors[idx] = emitted.payload;
              if (failedIndices.size === combNode.machines.length) {
                settleCombinator('ERROR', failedErrors);
              }
            }
            return;
          }
          if (
            fsm.hasTransitionFor( childFSM.id, emitted.type) ||
            fsm.hasTransitionFor(combNode.id, emitted.type) ||
            fsm.hasTransitionFor('anyState', emitted.type)
          ) {
            dispatchInternal(
              emitted.type,
              emitted.payload,
              true,
              false,
              fsm.hasTransitionFor(childFSM.id, emitted.type)
                ? childFSM.id
                : undefined,
            );
          }
        },
      );
      children.push(childNode);
    });

    combinatorTickSig.update((n) => n + 1);
    for (let i = 0; i < children.length; i++) {
      evaluateCombinatorProgress(i);
    }
  };

  const canSubNodeHandleEvent = (
    subRef: SubMachineRef<any, any>,
    node: SubMachineRuntimeNode<any>,
    event: string,
  ): boolean => {
    const childCurrentState = node.fsmState();
    if (
      subRef.machine.hasTransitionFor(childCurrentState, event) ||
      subRef.machine.hasTransitionFor('*', event)
    ) {
      return true;
    }
    const nestedSubRef = subRef.machine.subMachines.get(childCurrentState);
    const nestedSubState = node.fsmSubState();
    if (nestedSubRef && nestedSubState) {
      return (
        nestedSubRef.machine.hasTransitionFor(nestedSubState, event) ||
        nestedSubRef.machine.hasTransitionFor('*', event)
      );
    }
    return false;
  };

  const eventQueue: Array<{
    event: string;
    payload: unknown;
    fromChildOutput: boolean;
    fromChildTerminal: boolean;
    sourceStateOverride?: string;
  }> = [];
  let isProcessing = false;
  const debugLog = resolveDebugLogger(effectiveConfig?.debug);

  const scheduleOrUpdateEveryTimer = (
    stateName: string,
    entryEpoch: number,
    via: EveryNode<any>,
    forceReschedule: boolean,
  ): void => {
    const rawMs =
      typeof via.ms === 'function' ? via.ms(getEffectiveContext()) : via.ms;
    const delay =
      typeof rawMs === 'number' && Number.isFinite(rawMs) && rawMs > 0
        ? rawMs
        : 0;
    const existing = activeEveryTimers.get(via.id);
    if (!forceReschedule && existing && existing.currentDelay === delay) {
      return;
    }
    if (existing?.timerId !== null && existing?.timerId !== undefined) {
      clearTimeout(existing.timerId);
    }
    if (delay <= 0) {
      activeEveryTimers.set(via.id, { timerId: null, currentDelay: 0, via });
      return;
    }
    const timerId = setTimeout(() => {
      if (
        !isDestroyed &&
        stateEpoch === entryEpoch &&
        untracked(() => fsmStateSig()) === stateName
      ) {
        dispatchInternal(via.id, undefined, false, false);
      }
    }, delay);
    activeEveryTimers.set(via.id, { timerId, currentDelay: delay, via });
  };

  const scheduleStateTimers = (stateName: string): void => {
    clearActiveTimers();
    const entryEpoch = stateEpoch;
    const scheduledIds = new Set<string>();
    for (const row of fsm.transitions) {
      const [from, via] = row as unknown as readonly [unknown, unknown];
      const srcIds = resolveSourceIds(from);
      if (!srcIds.includes(stateName) && !srcIds.includes('*')) {
        continue;
      }
      if (isAfterNode(via) && !scheduledIds.has(via.id)) {
        scheduledIds.add(via.id);
        const rawMs =
          typeof via.ms === 'function'
            ? via.ms(getEffectiveContext())
            : via.ms;
        if (typeof rawMs === 'number' && Number.isFinite(rawMs) && rawMs >= 0) {
          const timerId = setTimeout(() => {
            if (
              !isDestroyed &&
              stateEpoch === entryEpoch &&
              untracked(() => fsmStateSig()) === stateName
            ) {
              dispatchInternal(via.id, undefined, false, false);
            }
          }, rawMs);
          activeTimers.push(timerId);
        }
      } else if (isEveryNode(via) && !scheduledIds.has(via.id)) {
        scheduledIds.add(via.id);
        scheduleOrUpdateEveryTimer(stateName, entryEpoch, via, true);
      }
    }
  };

  const processOneEvent = (
    event: string,
    payload?: unknown,
    fromChildOutput = false,
    fromChildTerminal = false,
    sourceStateOverride?: string,
  ): void => {
    const currentState = untracked(() => fsmStateSig());
    const effectiveFromState = sourceStateOverride ?? currentState;
    const currentCtx = getEffectiveContext();

    // 1. Handle subMachine delegation vs parent group-interrupt (Cooperative Cancel vs Hard Kill!)
    if (!fromChildOutput && activeSubNode && activeSubRef) {
      const subHandlesEvent = canSubNodeHandleEvent(
        activeSubRef,
        activeSubNode,
        event,
      );

      if (subHandlesEvent) {
        activeSubNode.send(event, payload);
        checkSubNodeCompletion();
        onNotifyParent?.();
        return;
      }
    }

    // 1a. Handle combinator (all / race / any) broadcast when parent does not handle `event` directly on the combinator
    if (
      !fromChildOutput &&
      activeCombinator &&
      !activeCombinator.settled &&
      !fsm.hasTransitionFor(activeCombinator.node.id, event)
    ) {
      let handledByAnyCombChild = false;
      const combSnap = activeCombinator;
      for (let i = 0; i < combSnap.children.length; i++) {
        const child = combSnap.children[i];
        const childFSM = combSnap.node.machines[i];
        if (!child || child.isDone()) {
          continue;
        }
        const childRef: SubMachineRef<any, any> = {
          __type: 'subMachine',
          id: childFSM.id,
          machine: childFSM,
        };
        if (canSubNodeHandleEvent(childRef, child, event)) {
          handledByAnyCombChild = true;
          child.send(event, payload);
          if (combSnap.settled) {
            break;
          }
        }
      }
      if (handledByAnyCombChild) {
        combinatorTickSig.update((n) => n + 1);
        onNotifyParent?.();
        return;
      }
    }

    // 1b. Handle 1:N each() pool broadcast when parent does not handle `event` directly
    const activeEachNode = fsm.eachNodes.get(currentState);
    if (
      !fromChildOutput &&
      activeEachNode &&
      !fsm.hasTransitionFor(currentState, event)
    ) {
      const pool = eachRegistries.get(activeEachNode.key);
      if (pool && pool.size > 0) {
        let handledByAnyChild = false;
        const eachSubRef: SubMachineRef<any, any> = {
          __type: 'subMachine',
          id: activeEachNode.machine.id,
          machine: activeEachNode.machine,
        };
        for (const child of pool.values()) {
          if (
            !child.isDone() &&
            canSubNodeHandleEvent(eachSubRef, child, event)
          ) {
            handledByAnyChild = true;
            child.send(event, payload);
          }
        }
        if (handledByAnyChild) {
          publishChildSnapshots();
          checkEachAllDone(activeEachNode);
          onNotifyParent?.();
          return;
        }
      }
    }

    // 2. Evaluate parent transition (Pass 1: specific [effectiveFromState, event, ...], Pass 2: [anyState(), event, ...])
    const evaluation = fsm.evaluate(
      effectiveFromState,
      event,
      payload,
      currentCtx,
    );

    if (!evaluation.matched) {
      debugLog?.(
        `[MatrixFSM:${fsm.id}] Ignored event '${event}' in state '${currentState}'`,
      );
      return;
    }

    if (fromChildTerminal && evaluation.stayed) {
      throw new Error(
        `[MatrixFSM Error]: Sub-machine '${currentState}' terminated with final output '${event}', but parent '${fsm.id}' responded with stay(). A parent must transition to a new state when a sub-machine reaches finalState()!`,
      );
    }

    debugLog?.(
      `[MatrixFSM:${fsm.id}] Transition '${currentState}' --(${event})--> '${evaluation.nextState}'`,
    );

    // If leaving an active sub-machine or combinator (e.g. Hard Kill via [baristaFSM, 'CANCEL', ...] or [anyState(), 'QUICK_ORDER_LINK', ...]),
    // atomically abort child tasks & destroy child instance(s) in the exact same tick!
    if (!evaluation.stayed && activeSubNode && activeSubRef) {
      const childCurrentState = activeSubNode.fsmState();
      onExitHooks[childCurrentState]?.(getEffectiveContext());
      destroyActiveSubNode();
    }
    if (!evaluation.stayed && activeCombinator) {
      destroyActiveCombinator();
    }

    const nextState = evaluation.nextState;
    if (!evaluation.stayed) {
      // Leaving current state -> cancel any in-flight awaiting task, active timers, or active `each` pool!
      clearActiveTimers();
      cancelActiveTask();
      const exitingEach = fsm.eachNodes.get(currentState);
      if (exitingEach && nextState !== currentState) {
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
      stateEpoch++;
      stateEpochSig.set(stateEpoch);
      fsmStateSig.set(nextState);
    }

    const isEnteringAwaiting = !evaluation.stayed && evaluation.isAwaiting;

    if (evaluation.callSelector && !isEnteringAwaiting) {
      invokeCallSelector(
        evaluation.callSelector,
        getMethodsTarget(),
        payload,
        getEffectiveContext(),
      );
    }

    const freshCtx = getEffectiveContext();
    const resolvedInputMapped = evaluation.inputSelector
      ? evaluation.inputSelector(freshCtx, payload)
      : evaluation.inputMapped;
    const resolvedEmittedOutput = evaluation.emittedOutput
      ? {
          type: evaluation.emittedOutput.type,
          payload: evaluation.outputSelector
            ? evaluation.outputSelector(freshCtx, payload)
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

    // In-place stay(): patch/call applied, keep current state, do NOT re-enter or interrupt tasks!
    if (evaluation.stayed) {
      for (const [everyId, entry] of activeEveryTimers.entries()) {
        scheduleOrUpdateEveryTimer(
          currentState,
          stateEpoch,
          entry.via,
          event === everyId,
        );
      }
      const activeEach = fsm.eachNodes.get(currentState);
      if (activeEach) {
        syncEachInstances(activeEach, resolvedInputMapped);
      }
      effectiveConfig?.inspect?.({
        machineId: fsm.id,
        from: currentState,
        via: event,
        to: currentState,
        payload,
        nextContext: getEffectiveContext(),
        timestamp: Date.now(),
      });
      onNotifyParent?.();
      if (resolvedEmittedOutput) {
        onEmitOutput?.(resolvedEmittedOutput);
      }
      return;
    }

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
        resolvedInputMapped,
      );
    } else {
      fsmSubStateSig.set(null);
      fsmSubContextSig.set(null);
    }

    if (evaluation.enteredCombinator) {
      enterCombinatorNode(
        evaluation.enteredCombinator,
        resolvedInputMapped,
      );
    }

    if (evaluation.enteredEach) {
      syncEachInstances(evaluation.enteredEach, resolvedInputMapped);
    }

    onEnterHooks[nextState]?.(getEffectiveContext());
    scheduleStateTimers(nextState);

    if (isEnteringAwaiting) {
      startAwaitingTaskIfNeeded(
        nextState,
        evaluation.callSelector ??
          fsm.awaitingCallSelectors?.get(nextState) ??
          null,
        payload,
      );
    }

    if (
      evaluation.finalOutcome === null &&
      (fsm.hasTransitionFor(nextState, '__always__') ||
        fsm.hasTransitionFor('*', '__always__'))
    ) {
      eventQueue.unshift({
        event: '__always__',
        payload: undefined,
        fromChildOutput: false,
        fromChildTerminal: false,
      });
    }

    effectiveConfig?.inspect?.({
      machineId: fsm.id,
      from: currentState,
      via: event,
      to: nextState,
      payload,
      nextContext: getEffectiveContext(),
      timestamp: Date.now(),
    });

    onNotifyParent?.();

    if (evaluation.finalOutcome === null && resolvedEmittedOutput) {
      onEmitOutput?.(resolvedEmittedOutput);
    }
  };

  const dispatchInternal = (
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
            untracked(() => fsmStateSig()),
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

  const can = (event: string, payload?: unknown): boolean => {
    flushPendingSignalWatches();
    if (isDestroyed) {
      return false;
    }
    const currentState = fsmStateSig();
    const currentCtx = fsmContext();
    const subNode = activeSubNodeSig();
    combinatorTickSig();

    if (subNode && activeSubRef) {
      if (
        typeof subNode.can === 'function'
          ? subNode.can(event, payload)
          : canSubNodeHandleEvent(activeSubRef, subNode, event)
      ) {
        return true;
      }
    }

    if (
      activeCombinator &&
      !activeCombinator.settled &&
      !fsm.hasTransitionFor(activeCombinator.node.id, event)
    ) {
      const combSnap = activeCombinator;
      for (let i = 0; i < combSnap.children.length; i++) {
        const child = combSnap.children[i];
        const childFSM = combSnap.node.machines[i];
        if (!child || child.isDone()) {
          continue;
        }
        const childHandles =
          typeof child.can === 'function'
            ? child.can(event, payload)
            : canSubNodeHandleEvent(
                {
                  __type: 'subMachine',
                  id: childFSM.id,
                  machine: childFSM,
                },
                child,
                event,
              );
        if (childHandles) {
          return true;
        }
      }
    }

    const eachNode = fsm.eachNodes.get(currentState);
    if (eachNode && !fsm.hasTransitionFor(eachNode.id, event)) {
      const registry = eachRegistries.get(eachNode.key);
      if (registry) {
        for (const child of registry.values()) {
          if (
            !child.isDone() &&
            (typeof child.can === 'function'
              ? child.can(event, payload)
              : eachNode.machine.hasTransitionFor(child.fsmState(), event))
          ) {
            return true;
          }
        }
      }
    }

    const evalResult = fsm.evaluate(currentState, event, payload, currentCtx);
    return evalResult.matched && !evalResult.isNoOpStay;
  };

  const send: SendFn<TFSM> = (...args: [event: string, payload?: unknown]) => {
    const [event, payload] = args;
    dispatchInternal(event, payload, false, false);
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

  const getSnapshot = (): MachineSnapshot<TFSM> => {
    flushPendingSignalWatches();
    const children: Record<string, MachineSnapshot<any>> = {};
    if (activeSubNode && activeSubRef && typeof activeSubNode.getSnapshot === 'function') {
      children[activeSubRef.id] = activeSubNode.getSnapshot();
    }
    if (activeCombinator && !activeCombinator.settled) {
      activeCombinator.children.forEach((child, idx) => {
        const childFSM = activeCombinator!.node.machines[idx];
        if (child && childFSM && typeof child.getSnapshot === 'function') {
          children[childFSM.id] = child.getSnapshot();
        }
      });
    }
    for (const [key, registry] of eachRegistries.entries()) {
      for (const [itemId, child] of registry.entries()) {
        if (typeof child.getSnapshot === 'function') {
          children[`each:${key}:${itemId}`] = child.getSnapshot();
        }
      }
    }
    return {
      state: untracked(() => fsmStateSig()) as ExtractStates<TFSM>,
      context: { ...(getEffectiveContext() as Record<string, any>) } as Readonly<
        ExtractContext<TFSM>
      >,
      stateEpoch,
      ...(Object.keys(children).length > 0 ? { children } : {}),
    };
  };

  const restoreSnapshot = (snapshot: MachineSnapshot<TFSM>): void => {
    isDestroyed = false;
    clearActiveTimers();
    cancelActiveTask();
    destroyActiveSubNode();
    destroyActiveCombinator();
    destroyAllEachPools();
    eventQueue.length = 0;
    doneOutcomeSig.set(null);
    finalPayloadSig.set(undefined);
    hasFinalPayloadSelectorSig.set(false);
    applyContextPatch(snapshot.context as Partial<TContext>);
    stateEpoch = Math.max(stateEpoch + 1, snapshot.stateEpoch);
    stateEpochSig.set(stateEpoch);
    const restoredState = snapshot.state as TState;
    fsmStateSig.set(restoredState);
    const subRef = fsm.subMachines.get(restoredState);
    if (subRef) {
      enterSubMachineNode(
        subRef,
        snapshot.context as Record<string, unknown>,
      );
      const childSnap = snapshot.children?.[subRef.id];
      if (
        childSnap &&
        activeSubNode &&
        typeof activeSubNode.restoreSnapshot === 'function'
      ) {
        activeSubNode.restoreSnapshot(childSnap);
        syncSubNodeSignals();
      }
    } else {
      fsmSubStateSig.set(null);
      fsmSubContextSig.set(null);
    }
    const combNode = fsm.combinatorNodes?.get(restoredState);
    if (combNode) {
      enterCombinatorNode(
        combNode,
        snapshot.context as Record<string, unknown>,
      );
      const spawnedComb = activeCombinator as {
        readonly node: CombinatorNode<any, any>;
        readonly children: SubMachineRuntimeNode<any>[];
        readonly failedIndices: Set<number>;
        settled: boolean;
      } | null;
      if (spawnedComb && !spawnedComb.settled && snapshot.children) {
        spawnedComb.children.forEach(
          (child: SubMachineRuntimeNode<any>, idx: number) => {
            const childFSM = combNode.machines[idx];
            const childSnap = childFSM
              ? snapshot.children?.[childFSM.id]
              : undefined;
            if (childSnap && typeof child?.restoreSnapshot === 'function') {
              child.restoreSnapshot(childSnap);
            }
          },
        );
        combinatorTickSig.update((n) => n + 1);
      }
    }
    const eachNode = fsm.eachNodes.get(restoredState);
    if (eachNode) {
      syncEachInstances(eachNode);
      const registry = eachRegistries.get(eachNode.key);
      if (registry && snapshot.children) {
        for (const [itemId, child] of registry.entries()) {
          const childSnap =
            snapshot.children[`${eachNode.id}:${itemId}`] ??
            snapshot.children[itemId];
          if (childSnap && typeof child.restoreSnapshot === 'function') {
            child.restoreSnapshot(childSnap);
          }
        }
        publishChildSnapshots();
      }
    }
    scheduleStateTimers(restoredState);
    if (fsm.awaitingStates.has(restoredState)) {
      startAwaitingTaskIfNeeded(restoredState);
    }
    if (
      fsm.hasTransitionFor(restoredState, '__always__') ||
      fsm.hasTransitionFor('*', '__always__')
    ) {
      dispatchInternal('__always__', undefined, false, false);
    }
  };

  const reset = (initialOverrideArg?: Partial<TContext>): void => {
    isDestroyed = false;
    clearActiveTimers();
    cancelActiveTask();
    destroyActiveSubNode();
    destroyActiveCombinator();
    destroyAllEachPools();
    doneOutcomeSig.set(null);
    finalPayloadSig.set(undefined);
    hasFinalPayloadSelectorSig.set(false);
    const nextSyncedPatch: Record<string, unknown> = {};
    for (const [k, sig] of Object.entries(syncedSignals)) {
      if (isSignal(sig)) {
        nextSyncedPatch[k] = untracked(() => sig());
      }
    }
    const nextInit = {
      ...(fsm.context ?? {}),
      ...initialStoreStateSnapshot,
      ...initialSyncedPatch,
      ...nextSyncedPatch,
      ...(initialOverrideArg ?? {}),
    } as TContext;
    rawContextSig.set(nextInit);
    if (!hostStore) {
      patchState(effectiveStoreSource as any, nextInit as Record<string, unknown>);
    } else if (storeStateKeys.size > 0) {
      const storeResetPatch: Record<string, unknown> = {
        ...initialStoreStateSnapshot,
        ...initialSyncedPatch,
        ...nextSyncedPatch,
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
    stateEpoch++;
    stateEpochSig.set(stateEpoch);
    fsmStateSig.set(fsm.initial as TState);
    childMachinesSig.set({});
    scheduleStateTimers(fsm.initial);
    if (fsm.awaitingStates.has(fsm.initial)) {
      startAwaitingTaskIfNeeded(fsm.initial);
    }
    if (
      fsm.hasTransitionFor(fsm.initial, '__always__') ||
      fsm.hasTransitionFor('*', '__always__')
    ) {
      dispatchInternal('__always__', undefined, false, false);
    }
  };

  scheduleStateTimers(fsm.initial);

  // If initial state itself is an awaiting node, initialize it
  if (fsm.awaitingStates.has(fsm.initial)) {
    startAwaitingTaskIfNeeded(fsm.initial);
  }

  if (
    fsm.hasTransitionFor(fsm.initial, '__always__') ||
    fsm.hasTransitionFor('*', '__always__')
  ) {
    dispatchInternal('__always__', undefined, false, false);
  }

  // Register reactive watchers for `syncContext` signals so `store.<key>()` stays in sync!
  for (const [key, sig] of Object.entries(syncedSignals)) {
    if (!isSignal(sig)) {
      continue;
    }
    let isFirstSyncRun = true;
    let prevSyncVal: unknown = undefined;
    const syncWatcher = createWatch(
      () => {
        const val = sig();
        if (isFirstSyncRun) {
          isFirstSyncRun = false;
          prevSyncVal = val;
          return;
        }
        if (Object.is(val, prevSyncVal)) {
          return;
        }
        prevSyncVal = val;
        untracked(() => {
          applyContextPatch({ [key]: val } as Partial<TContext>);
        });
      },
      (watch) => {
        pendingWatchRuns.add(watch);
        queueMicrotask(() => {
          flushPendingSignalWatches();
        });
      },
      true,
    );
    activeWatchers.push(syncWatcher);
    syncWatcher.run();
  }

  // Also support reactive selector functions in `syncContext` (e.g. `syncContext: (ext = inject(ExternalStore)) => ({ syncedProp: ext.prop() })`)
  const syncContextOption = effectiveConfig?.syncContext;
  if (
    typeof syncContextOption === 'function' &&
    Object.keys(initialSyncedPatch).some((k) => !(k in syncedSignals))
  ) {
    let isFirstSelectorRun = true;
    let prevSelectorValues: Record<string, unknown> = { ...initialSyncedPatch };
    const selectorWatcher = createWatch(
      () => {
        const nextObj = runWithDI(() =>
          (syncContextOption as () => Record<string, unknown>)(),
        );
        if (!nextObj || typeof nextObj !== 'object') {
          return;
        }
        const currentValues: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(nextObj)) {
          if (!isSignal(v)) {
            currentValues[k] = v;
          }
        }
        if (isFirstSelectorRun) {
          isFirstSelectorRun = false;
          prevSelectorValues = currentValues;
          return;
        }
        const diffPatch: Record<string, unknown> = {};
        let hasChanged = false;
        for (const [k, v] of Object.entries(currentValues)) {
          if (!Object.is(v, prevSelectorValues[k])) {
            diffPatch[k] = v;
            hasChanged = true;
          }
        }
        prevSelectorValues = currentValues;
        if (hasChanged) {
          untracked(() => {
            applyContextPatch(diffPatch as Partial<TContext>);
          });
        }
      },
      (watch) => {
        pendingWatchRuns.add(watch);
        queueMicrotask(() => {
          flushPendingSignalWatches();
        });
      },
      true,
    );
    activeWatchers.push(selectorWatcher);
    selectorWatcher.run();
  }

  const wrapSignalWithWatchFlush = <T extends (...args: any[]) => any>(
    sigFn: T,
  ): T =>
    new Proxy(sigFn, {
      apply(target, thisArg, argArray) {
        flushPendingSignalWatches();
        return Reflect.apply(target, thisArg, argArray);
      },
    });

  const fsmStateReadonly = wrapSignalWithWatchFlush(fsmStateSig.asReadonly());
  const fsmContextFlushed = wrapSignalWithWatchFlush(fsmContext);

  return {
    state: fsmStateReadonly,
    fsmState: fsmStateReadonly,
    stateEpoch: stateEpochSig.asReadonly(),
    fsmSubState: wrapSignalWithWatchFlush(fsmSubStateSig.asReadonly()),
    fsmSubContext: wrapSignalWithWatchFlush(fsmSubContextSig.asReadonly()),
    fsmContext: fsmContextFlushed,
    actors,
    isPending: wrapSignalWithWatchFlush(isPending),
    isDone: wrapSignalWithWatchFlush(isDone),
    finalOutcome: wrapSignalWithWatchFlush(doneOutcomeSig.asReadonly()),
    finalPayload: wrapSignalWithWatchFlush(finalPayloadSig.asReadonly()),
    hasFinalPayloadSelector: hasFinalPayloadSelectorSig.asReadonly(),
    childMachines: wrapSignalWithWatchFlush(childMachinesSig.asReadonly()),
    can: can as CanFn<TFSM>,
    send: ((...args: [event: string, payload?: unknown]) => {
      flushPendingSignalWatches();
      return (send as (...a: any[]) => void)(...args);
    }) as SendFn<TFSM>,
    sendToChild,
    patchContext,
    getSnapshot,
    restoreSnapshot,
    reset,
    destroy,
    __flushPendingWatches: flushPendingSignalWatches,
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
  TConfig extends Partial<StateMachineFeatureConfig<TFSM, any>> = StateMachineFeatureConfig<
    TFSM,
    EmptyObject
  >,
>(
  fsm: TFSM,
  ...configArgs: [config?: TConfig & Partial<StateMachineFeatureConfig<TFSM, any>>]
): SignalStoreFeature<
  {
    state: EmptyFeatureResult['state'];
    props: EmptyFeatureResult['props'];
    methods: TFSM extends { readonly __isMachineFeature: true }
      ? EmptyFeatureResult['methods']
      : RequiredStoreMethods<
          TFSM,
          TConfig extends { readonly methods: (store: any) => infer M }
            ? M
            : TConfig extends { readonly methods: infer M extends object }
              ? M
              : EmptyObject
        >;
  },
  {
    state: TFSM extends { readonly __isMachineFeature: true }
      ? ExtractContext<TFSM>
      : TConfig extends { readonly state: any }
        ? ExtractContext<TFSM>
        : EmptyFeatureResult['state'];
    props: StateMachineStoreMembers<TFSM>;
    methods: TFSM extends { readonly __isMachineFeature: true }
      ? ExtractMethods<TFSM>
      : EmptyFeatureResult['methods'];
  }
> {
  const [explicitConfig] = configArgs;
  const baseFeatureConfig = defaultFeatureConfigs.get(fsm);
  const config = (
    baseFeatureConfig
      ? { ...baseFeatureConfig, ...(explicitConfig ?? {}) }
      : explicitConfig
  ) as StateMachineFeatureConfig<TFSM, any> | undefined;

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
  } else if ((fsm as { readonly __isMachineFeature?: boolean }).__isMachineFeature) {
    features.push(withState(() => ({ ...(fsm.context ?? {}) })));
  }

  if (typeof config?.methods === 'function') {
    const methodsFactory = config.methods;
    features.push(
      withMethods((store) => methodsFactory(store) as Record<string, any>),
    );
  } else if (config?.methods && typeof config.methods === 'object') {
    const methodsMap = config.methods;
    features.push(withMethods(() => ({ ...methodsMap })));
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
    ((innerStore: any) => {
      const flushFn = innerStore?.props?.__flushPendingWatches;
      if (typeof flushFn === 'function' && innerStore?.stateSignals) {
        const wrappedStateSignals: Record<PropertyKey, any> = {};
        for (const key of Reflect.ownKeys(innerStore.stateSignals)) {
          const origSig = innerStore.stateSignals[key];
          wrappedStateSignals[key] =
            typeof origSig === 'function'
              ? new Proxy(origSig, {
                  apply(target, thisArg, argArray) {
                    flushFn();
                    return Reflect.apply(target, thisArg, argArray);
                  },
                })
              : origSig;
        }
        return {
          ...innerStore,
          stateSignals: wrappedStateSignals,
        };
      }
      return innerStore;
    }) as any,
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
  readonly methods?: Record<string, any>;
}

export type FeatureInputs<T extends MachineFeatureContract> =
  T extends { readonly inputs: infer I extends Record<string, any> }
    ? I
    : EmptyObject;

export type FeatureEvents<T extends MachineFeatureContract> =
  T extends { readonly events: infer E extends Record<string, any> }
    ? E
    : EmptyObject;

export type FeatureOutputs<T extends MachineFeatureContract> =
  T extends { readonly outputs: infer O extends Record<string, any> }
    ? O
    : EmptyObject;

export type FeatureStates<T extends MachineFeatureContract> =
  T extends { readonly states: infer S extends string } ? S : string;

export type FeatureMethods<T extends MachineFeatureContract> =
  T extends { readonly methods: infer M extends Record<string, any> }
    ? [M] extends [never]
      ? any
      : M
    : any;

export type ExtractShallowAwaitingFromTransitions<
  TTransitions extends readonly any[],
> = TTransitions[number] extends infer Row
  ? Row extends readonly [any, any, AwaitingNode<infer S>, ...any[]]
    ? S
    : Row extends readonly [infer From extends string, 'DONE' | 'ERROR', ...any[]]
      ? From
      : never
  : never;

export type HasDeclaredVoidOutput<TOutputs> =
  [0] extends [1 & TOutputs]
    ? false
    : TOutputs extends object
      ? string extends keyof TOutputs
        ? false
        : keyof TOutputs extends never
          ? false
          : [VoidOutputKeys<TOutputs>] extends [never]
            ? false
            : true
      : false;

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
    TOutputs,
    HasDeclaredVoidOutput<TOutputs> extends false ? TInputs & TState : any
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
      TOutputs,
      TEvents
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
  readonly debug?: DebugLogger;
  readonly inspect?: InspectCallback<any>;
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
};

export interface MachineFeatureDefinition<
  TId extends string = string,
  TInitial extends string = string,
  TContext extends object = EmptyObject,
  TEvents extends Record<string, any> = EmptyObject,
  TTransitions extends readonly TransitionRow<any, any, any, any, any>[] = readonly TransitionRow<
    any,
    any,
    any,
    any,
    any
  >[],
  TMethods extends Record<string, any> = EmptyObject,
  TInputs extends object = EmptyObject,
  TOutputs extends Record<string, any> = EmptyObject,
> extends FSMDefinition<
    TId,
    TInitial,
    TContext,
    TEvents,
    TTransitions,
    TMethods,
    TInputs,
    TOutputs
  > {
  readonly __isMachineFeature: true;
  readonly state?: TContext;
  readonly syncContext?:
    | (() => SyncContextMap<TContext>)
    | SyncContextMap<TContext>
    | (() => Partial<TContext>);
  readonly methods?: ((store: any) => TMethods) | TMethods;
}

export function buildMachineFeatureRuntime(
  config: any,
  taskAdapter?: CustomTaskAdapter,
): any {
  const baseFsm = createFSM<any>()({
    id: config.id,
    initial: config.initial,
    context: config.state,
    transitions: config.transitions,
  });

  const fsm = Object.freeze({
    ...baseFsm,
    __isMachineFeature: true as const,
    state: config.state,
    syncContext: config.syncContext,
    methods: config.methods,
  });

  const featureRuntimeConfig: StateMachineFeatureConfig<any, any> = {
    state: config.state,
    syncContext: config.syncContext,
    methods: config.methods,
    taskAdapter: taskAdapter ?? config.taskAdapter,
    debug: config.debug,
    inspect: config.inspect,
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

  return fsm;
}

/**
 * Cohesive Sub-Machine Actor Creator ("Sandwich-Pattern"):
 * Combines Public Contract (`inputs`, `events`, `outputs`, `states`) at the top,
 * the visual Transition Matrix in the middle, and isolated Runtime Implementation
 * (`state`, `methods`) at the bottom — with zero `provideStateMachine` boilerplate!
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
    FeatureMethods<TContract>,
    FeatureOutputs<TContract>,
    HasDeclaredVoidOutput<FeatureOutputs<TContract>> extends false
      ? FeatureInputs<TContract> & TState
      : any
  >[],
  TState extends object = EmptyObject,
  TMethods extends Record<string, any> = FeatureMethods<TContract>,
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
) => MachineFeatureDefinition<
  TId,
  TInitial,
  ResolveContext<FeatureInputs<TContract> & TState, TTransitions>,
  FeatureEvents<TContract>,
  TTransitions,
  TMethods,
  FeatureInputs<TContract>,
  FeatureOutputs<TContract>
> {
  return (config: any) => buildMachineFeatureRuntime(config);
}

// ============================================================================
// Lightweight Unit-Test Harness for Sandwich Features (`createFeatureTester`)
// ============================================================================

export interface FeatureTesterOptions<TFSM extends AnyFSMDefinition> {
  readonly inputs?: Partial<ExtractInput<TFSM>> & Record<string, any>;
  readonly stateOverride?: Partial<ExtractContext<TFSM>> & Record<string, any>;
  readonly syncedContext?: Partial<ExtractContext<TFSM>> & Record<string, any>;
  readonly injector?: Injector;
  readonly debug?: DebugLogger;
  readonly inspect?: InspectCallback<TFSM>;
  readonly methods?:
    | ((
        store: InlineStoreFor<TFSM>,
      ) => Partial<ExtractMethods<TFSM>> & Record<string, (...args: any[]) => any>)
    | (Partial<ExtractMethods<TFSM>> & Record<string, (...args: any[]) => any>);
  readonly actorMethods?: Record<
    string,
    | ((store: any) => Record<string, (...args: any[]) => any>)
    | Record<string, (...args: any[]) => any>
    | undefined
  >;
}

export interface FeatureTester<TFSM extends AnyFSMDefinition> {
  readonly state: () => ExtractStates<TFSM>;
  readonly context: () => Readonly<ExtractContext<TFSM>>;
  readonly can: CanFn<TFSM>;
  readonly send: SendFn<TFSM>;
  readonly isPending: () => boolean;
  readonly isCompleted: () => boolean;
  readonly isDone: () => boolean;
  readonly finalOutcome: () => string | null;
  readonly emittedOutputs: () => ReadonlyArray<{
    readonly type: string;
    readonly payload: unknown;
  }>;
  readonly flushTasks: () => Promise<void>;
  readonly patchContext: (patch: Partial<ExtractContext<TFSM>>) => void;
  readonly getSnapshot: () => MachineSnapshot<TFSM>;
  readonly restoreSnapshot: (snapshot: MachineSnapshot<TFSM>) => void;
  readonly reset: (initialOverride?: Partial<ExtractContext<TFSM>>) => void;
  readonly destroy: () => void;
}

/**
 * Instantiates a `createMachineFeature` (or `createFSM`) in pure Vitest/Node unit tests
 * without Angular `TestBed` or `EnvironmentInjector`, mocking `inputs` and `methods` directly.
 */
export function createFeatureTester<TFSM extends AnyFSMDefinition>(
  feature: TFSM,
  options?: FeatureTesterOptions<TFSM>,
): FeatureTester<TFSM> {
  const baseConfig = defaultFeatureConfigs.get(feature);
  const inFlightPromises = new Set<Promise<unknown>>();

  const trackPromise = (p: PromiseLike<unknown>): void => {
    const tracked = Promise.resolve(p).finally(() => {
      inFlightPromises.delete(tracked);
    });
    inFlightPromises.add(tracked);
  };

  const initialCombined: Record<string, unknown> = {
    ...(options?.inputs ?? {}),
    ...(options?.syncedContext ?? {}),
    ...(options?.stateOverride ?? {}),
  };

  const emittedOutputsList: Array<{
    readonly type: string;
    readonly payload: unknown;
  }> = [];
  let recordedTerminal = false;

  const testerInjector = options?.injector ?? null;

  const testerConfig: StateMachineFeatureConfig<any, any> = {
    ...baseConfig,
    debug: options?.debug ?? baseConfig?.debug,
    inspect: options?.inspect ?? baseConfig?.inspect,
    methods: (store: any) => ({
      ...resolveMethodsConfig(baseConfig?.methods, store, testerInjector),
      ...resolveMethodsConfig(options?.methods, store, testerInjector),
    }),
  };

  const runner = createScopedMachineRunner(
    feature,
    testerConfig,
    testerInjector,
    initialCombined,
    undefined,
    () => {
      if (!recordedTerminal && runner.isDone()) {
        recordedTerminal = true;
        const outcome = runner.finalOutcome();
        if (outcome) {
          emittedOutputsList.push({
            type: outcome,
            payload: runner.hasFinalPayloadSelector()
              ? runner.finalPayload()
              : undefined,
          });
        }
      }
    },
    (output) => {
      emittedOutputsList.push(output);
    },
    options?.actorMethods,
    trackPromise,
  );

  const flushTasks = async (): Promise<void> => {
    let safety = 0;
    while ((inFlightPromises.size > 0 || runner.isPending()) && safety < 50) {
      safety++;
      if (inFlightPromises.size > 0) {
        await Promise.allSettled([...inFlightPromises]);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  };

  return {
    state: () => runner.fsmState(),
    context: () => runner.fsmContext() as Readonly<ExtractContext<TFSM>>,
    can: runner.can,
    send: runner.send,
    isPending: () => runner.isPending(),
    isCompleted: () => runner.isDone(),
    isDone: () => runner.isDone(),
    finalOutcome: () => runner.finalOutcome(),
    emittedOutputs: () => [...emittedOutputsList],
    flushTasks,
    patchContext: runner.patchContext,
    getSnapshot: runner.getSnapshot,
    restoreSnapshot: runner.restoreSnapshot,
    reset: (override) => {
      emittedOutputsList.length = 0;
      recordedTerminal = false;
      runner.reset({
        ...(initialCombined as Partial<ExtractContext<TFSM>>),
        ...(override ?? {}),
      });
    },
    destroy: runner.destroy,
  };
}
