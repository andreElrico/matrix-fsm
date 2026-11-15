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
  type EnvironmentProviders,
  type Provider,
  type Signal,
  type Type,
} from '@angular/core';
import {
  createWatch,
  isInNotificationPhase,
  producerUpdatesAllowed,
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
  createMachineInstance,
  each,
  every,
  finalState,
  getShortestPaths,
  invokeCallSelector,
  isAfterNode,
  isAlwaysNode,
  isAnyStateNode,
  isAwaitingNode,
  isCombinatorNode,
  isEachNode,
  isEveryNode,
  isFSMDefinition,
  isFinalNode,
  isOutcomeNode,
  isStayNode,
  isSubMachineRef,
  MAX_SYNC_MICROSTEPS,
  MatrixFsmInfiniteLoopError,
  outcome,
  race,
  resolveDebugLogger,
  resolveSourceIds,
  singularizeEachKey,
  sourceIncludesAnyState,
  stay,
  subMachine,
  toMermaid,
  transitions,
  type AfterNode,
  type AllNode,
  type AllowedSendEvents,
  type AlwaysNode,
  type AnyFSMDefinition,
  type AnyNode,
  type AnyStateNode,
  type AwaitingNode,
  type CanFn,
  type CombinatorNode,
  type CombinatorSnapshotProgress,
  type CustomTaskAdapter,
  type DebugLogger,
  type EachNode,
  type EmptyObject,
  type EveryNode,
  type ExtractAllActorEntries,
  type ExtractAllContext,
  type ExtractAllMethods,
  type ExtractAllSubMachines,
  type ExtractAwaitingNodes,
  type ExtractContext,
  type ExtractEachMap,
  type ExtractEmittedOutputs,
  type ExtractEventPayload,
  type ExtractEvents,
  type ExtractEventsMap,
  type ExtractFinalOutcomes,
  type ExtractInput,
  type ExtractInputs,
  type ExtractMethods,
  type ExtractOutput,
  type ExtractOutputKeys,
  type ExtractOutputsMap,
  type ExtractOwnAwaitingNodes,
  type ExtractOwnContext,
  type ExtractOwnMethods,
  type ExtractOwnStates,
  type ExtractShallowAwaitingFromTransitions,
  type ExtractStates,
  type ExtractTerminalOutputPayload,
  type ExtractTerminalOutputs,
  type FinalNode,
  type FSMConfig,
  type FSMContract,
  type FSMDefinition,
  type GetShortestPathsOptions,
  type InitialStateTarget,
  type InspectCallback,
  type InspectEvent,
  type MachineInstance,
  type MachineInstanceHooks,
  type MachineObserver,
  type MachineSnapshot,
  type MachineSubscription,
  type OutcomeNode,
  type OutcomesOf,
  type RaceNode,
  type ResolveContext,
  type ResolveInitialStateKey,
  type ResourceRefLike,
  type SendFn,
  type SendToChildFn,
  type ShortestPathStep,
  type StayNode,
  type SubMachineRef,
  type SubscribableLike,
  type TransitionCallSelector,
  type TransitionOptions,
  type TransitionRow,
  type ValidateContractKeys,
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
  createMachineInstance,
  each,
  every,
  finalState,
  getShortestPaths,
  isAfterNode,
  isAlwaysNode,
  isAnyStateNode,
  isAwaitingNode,
  isCombinatorNode,
  isEachNode,
  isEveryNode,
  isFSMDefinition,
  isFinalNode,
  isOutcomeNode,
  isStayNode,
  isSubMachineRef,
  MAX_SYNC_MICROSTEPS,
  MatrixFsmInfiniteLoopError,
  outcome,
  race,
  singularizeEachKey,
  stay,
  subMachine,
  toMermaid,
  transitions,
  type AfterNode,
  type AllNode,
  type AllowedSendEvents,
  type AlwaysNode,
  type AnyFSMDefinition,
  type AnyNode,
  type AnyStateNode,
  type AwaitingNode,
  type CanFn,
  type CombinatorNode,
  type CombinatorSnapshotProgress,
  type CustomTaskAdapter,
  type DebugLogger,
  type EachNode,
  type EmptyObject,
  type EveryNode,
  type ExtractAllActorEntries,
  type ExtractAllContext,
  type ExtractAllMethods,
  type ExtractAllSubMachines,
  type ExtractAwaitingNodes,
  type ExtractContext,
  type ExtractEachMap,
  type ExtractEmittedOutputs,
  type ExtractEventPayload,
  type ExtractEvents,
  type ExtractEventsMap,
  type ExtractFinalOutcomes,
  type ExtractInput,
  type ExtractInputs,
  type ExtractMethods,
  type ExtractOutput,
  type ExtractOutputKeys,
  type ExtractOutputsMap,
  type ExtractOwnAwaitingNodes,
  type ExtractOwnContext,
  type ExtractOwnMethods,
  type ExtractOwnStates,
  type ExtractShallowAwaitingFromTransitions,
  type ExtractStates,
  type ExtractTerminalOutputPayload,
  type ExtractTerminalOutputs,
  type FinalNode,
  type FSMConfig,
  type FSMContract,
  type FSMDefinition,
  type GetShortestPathsOptions,
  type InitialStateTarget,
  type InspectCallback,
  type InspectEvent,
  type MachineInstance,
  type MachineInstanceHooks,
  type MachineObserver,
  type MachineSnapshot,
  type MachineSubscription,
  type OutcomeNode,
  type OutcomesOf,
  type RaceNode,
  type ResolveContext,
  type ResolveInitialStateKey,
  type ResourceRefLike,
  type SendFn,
  type SendToChildFn,
  type ShortestPathStep,
  type StayNode,
  type SubMachineRef,
  type SubscribableLike,
  type TransitionCallSelector,
  type TransitionOptions,
  type TransitionRow,
  type ValidateContractKeys,
  type ValidateTransitionRows,
  type VoidOutputKeys,
};

/**
 * Structural interface matching RxJS `Observable<T>` without requiring `rxjs` at runtime.
 *
 * @group Contracts & Config
 */
export type Subscribable<T = unknown> = SubscribableLike<T>;

/** @internal */
export type SubMachineAwaitingNodes<TFSM extends AnyFSMDefinition> =
  ExtractAwaitingNodes<ExtractAllSubMachines<TFSM>>;

/** @internal */
export type OwnAwaitingNodes<TFSM extends AnyFSMDefinition> =
  ExtractOwnAwaitingNodes<TFSM>;

/**
 * Signal-mirroring map passed to `syncContext` inside {@link withStateMachine} or
 * {@link createMachineFeature} to keep external Angular Signals synchronized with FSM context.
 *
 * @group SignalStore Integration
 */
export type SyncContextMap<TContext extends object> = {
  readonly [K in keyof TContext]?: Signal<TContext[K]> | TContext[K];
};

/**
 * State entry/exit hook dictionary keyed by state name.
 *
 * @group SignalStore Integration
 */
export type StateLifecycleHooks<TFSM extends AnyFSMDefinition> = Partial<
  Record<ExtractStates<TFSM>, (ctx: Readonly<ExtractContext<TFSM>>) => void>
>;

/** @group Internal Type Helpers */
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

/**
 * Typed store handle passed into `methods: (store) => ({ ... })` for {@link withStateMachine}.
 *
 * @group SignalStore Integration
 */
export type InlineStoreFor<TFSM extends AnyFSMDefinition> =
  WritableStateSource<ExtractContext<TFSM>> &
    DeepSignalOf<ExtractContext<TFSM>> &
    StateMachineStoreMembers<TFSM> &
    Record<string, any>;

/**
 * Runtime configuration accepted by {@link withStateMachine} and {@link provideStateMachine}.
 *
 * @group SignalStore Integration
 */
export type StateMachineFeatureConfig<
  TFSM extends AnyFSMDefinition,
  TExplicitMethods extends Record<string, (...args: any[]) => any> = EmptyObject,
> = {
  /**
   * Optional initial context state (enables standalone encapsulated stores in a single `withStateMachine` block).
   */
  readonly state?: ExtractContext<TFSM> | (() => ExtractContext<TFSM>);
  /**
   * Reactive Context Mirroring: syncs external Angular Signals (e.g. from global stores)
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
   * Optional pluggable task runner adapter (used for example by `createEffectMachineFeature`).
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

/**
 * Reactive snapshot entry exposed per active child actor in `store.childMachines()`.
 *
 * @group SignalStore Integration
 */
export interface ChildMachineSnapshot<TContext = any> {
  /** Child item ID (for `each()`) or actor ID/alias (for `all`/`race`/`any`). */
  readonly id: string;
  /** Current active state of the child actor. */
  readonly state: string;
  /** Nested sub-state if the child delegates to a deeper sub-machine. */
  readonly subState?: string | null;
  /** Live read-only context of the child actor. */
  readonly context: Readonly<TContext>;
  /** `true` while the child actor is in an `awaiting()` state. */
  readonly isPending: boolean;
  /** `true` once the child actor reaches `finalState()`. */
  readonly isDone: boolean;
  /** Terminal outcome name or `null`. */
  readonly finalOutcome: string | null;
}

type CleanObject<T> = [keyof T] extends [never] ? EmptyObject : T;

/**
 * Combined read-only state (`inputs & context`) of an active child actor exposed via `store.actors.<id>()`.
 *
 * @group SignalStore Integration
 */
export type ActorStateOf<TSub extends AnyFSMDefinition> = Readonly<
  CleanObject<ExtractInput<TSub>> & CleanObject<ExtractContext<TSub>>
>;

/**
 * Strongly-typed map of `Signal<ActorState | null>` keyed by sub-machine ID or `subMachine(fsm, 'alias')`.
 *
 * @group SignalStore Integration
 */
export type ActorsMapFor<TFSM extends AnyFSMDefinition> = {
  readonly [E in ExtractAllActorEntries<TFSM> as E['id']]: Signal<
    ActorStateOf<E['machine']> | null
  >;
} & Readonly<Record<string, Signal<Readonly<Record<string, any>> | null>>>;

/**
 * Signals and imperative control methods exposed on any NgRx `SignalStore` enhanced with {@link withStateMachine}.
 *
 * @group SignalStore Integration
 */
export interface StateMachineStoreMembers<TFSM extends AnyFSMDefinition> {
  /** Current active state name of the machine. */
  readonly state: Signal<ExtractStates<TFSM>>;
  /** Alias for {@link StateMachineStoreMembers.state} (handy if the store also defines a `state` property). */
  readonly fsmState: Signal<ExtractStates<TFSM>>;
  /** Monotonically incrementing counter bumped on every non-`stay()` transition. */
  readonly stateEpoch: Signal<number>;
  /** Active child state when inside a sub-machine, otherwise `null`. */
  readonly fsmSubState: Signal<string | null>;
  /** Active child context when inside a sub-machine, otherwise `null`. */
  readonly fsmSubContext: Signal<Readonly<Record<string, any>> | null>;
  /** DeepSignal view of the machine's encapsulated context state. */
  readonly fsmContext: DeepSignalOf<ExtractContext<TFSM>>;
  /** Keyed reactive signals for every 1:1 sub-machine and `all`/`race`/`any` combinator actor (`null` when inactive). */
  readonly actors: ActorsMapFor<TFSM>;
  /** `true` whenever the machine (or an active child actor) is inside an `awaiting()` state. */
  readonly isPending: Signal<boolean>;
  /** `true` when the machine has reached `finalState()`. */
  readonly isDone: Signal<boolean>;
  /** Terminal outcome name once `isDone()` is `true`, otherwise `null`. */
  readonly finalOutcome: Signal<string | null>;
  /** Terminal output payload captured when reaching `finalState()`, or `undefined`. */
  readonly finalPayload: Signal<unknown>;
  /** Live snapshots of active 1:N `each()` pools and combinator children. */
  readonly childMachines: Signal<
    Record<string, ReadonlyArray<ChildMachineSnapshot>>
  >;
  /** Purely evaluates whether `event` (with optional `payload`) would trigger a transition right now. */
  readonly can: CanFn<TFSM>;
  /** Enqueues a strongly-typed event into the Run-to-Completion FIFO event queue. */
  readonly send: SendFn<TFSM>;
  /** Sends an event directly to a specific child instance inside an active `each()` pool by item ID. */
  readonly sendToChild: SendToChildFn<TFSM>;
  /** Partially updates context and re-evaluates dynamic `every()` timers and `always()` branches. */
  readonly patchContext: (patch: Partial<ExtractContext<TFSM>>) => void;
  /** Captures a serializable snapshot of the machine and all active child actors. */
  readonly getSnapshot: () => MachineSnapshot<TFSM>;
  /** Restores state, context, and child actors from a snapshot and re-arms timers. */
  readonly restoreSnapshot: (snapshot: MachineSnapshot<TFSM>) => void;
  /** Aborts active tasks/timers and resets the machine to `initial` with initial context. */
  readonly reset: (initialOverride?: Partial<ExtractContext<TFSM>>) => void;
  /** Cleans up all active timers, tasks, watchers, and child actors (auto-wired to `DestroyRef`). */
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
  readonly actors?: Readonly<
    Record<string, Signal<Readonly<Record<string, any>> | null>>
  >;
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
  readonly __hasActiveTransition?: (event: string) => boolean;
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
  onTrackPromise?: (p: PromiseLike<unknown>) => void,
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
 * Standalone non-DI override map used ONLY when `hostInjector === null`
 * (e.g. headless `provideStateMachine(...)` + `new Store()` unit tests without `TestBed`).
 * Angular DI contexts (`TestBed`, components, SSR) NEVER consult this map, preventing cross-test/SSR leakage!
 */
const standaloneOverrideFactories = new WeakMap<
  AnyFSMDefinition,
  SubMachineSpawnFactory<any>
>();

interface PendingChildSpawnEntry {
  readonly fsm: AnyFSMDefinition;
  readonly initialOverride?: Record<string, unknown>;
  readonly onNotifyParent?: () => void;
  readonly onEmitOutput?: (output: {
    readonly type: string;
    readonly payload: unknown;
  }) => void;
  readonly onTrackPromise?: (p: PromiseLike<unknown>) => void;
  consumed: boolean;
}

const pendingChildSpawnStack: PendingChildSpawnEntry[] = [];

const resolvedMethodsBySend = new WeakMap<
  (...args: any[]) => any,
  Record<string, (...args: any[]) => any>
>();

/**
 * Returns the unique Angular `InjectionToken` associated with a pure `FSMDefinition`.
 *
 * @group Dependency Injection
 * @param fsm - Pure FSM or machine feature definition.
 * @returns Cached Angular `InjectionToken` resolving its spawn factory.
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
 *
 * @internal
 */
export function bindDefaultMachineFactory<TFSM extends AnyFSMDefinition>(
  fsm: TFSM,
  factory: SubMachineSpawnFactory<TFSM>,
): void {
  defaultMachineFactories.set(fsm, factory);
}

/**
 * Patches context state cleanly inside both full `@ngrx/signals` `SignalStore` instances
 * and scoped sub-machine runners (`methods: (store) => ({ ... })`).
 *
 * @group SignalStore Integration
 * @param store - SignalStore instance or scoped sub-actor `FeatureInlineStore`.
 * @param updaters - Partial state objects or functional updaters.
 *
 * @example
 * ```ts
 * import { createMachineFeature, patchMachineState } from '@matrix-fsm/angular';
 *
 * const counterFSM = createMachineFeature<{
 *   events: { INC: void };
 *   states: 'ready';
 * }>()({
 *   id: 'counter',
 *   initial: 'ready',
 *   transitions: [['ready', 'INC', 'ready', { call: (m) => m._inc }]],
 *   state: { count: 0 },
 *   methods: (store) => ({
 *     _inc: () => patchMachineState(store, (s) => ({ count: s.count + 1 })),
 *   }),
 * });
 * ```
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
 * Explicitly binds or overrides a pure `FSMDefinition` with an Angular `SignalStore` class or inline
 * configuration inside Angular Dependency Injection.
 *
 * @group Dependency Injection
 * @param fsm - Pure FSM definition to bind or mock.
 * @param storeClassOrConfig - `SignalStore` class or inline `StateMachineFeatureConfig` override.
 * @returns Combined Angular `EnvironmentProviders & Provider` usable in component or test `providers`.
 *
 * @example
 * ```ts
 * import { provideStateMachine } from '@matrix-fsm/angular';
 * import { baristaFSM } from './barista.feature';
 *
 * // Override a sub-actor in component or TestBed providers:
 * providers: [
 *   provideStateMachine(baristaFSM, {
 *     methods: {
 *       _brewCoffee: async () => ({ baristaNote: 'Mocked espresso', temperatureCelsius: 92 }),
 *     },
 *   }),
 * ]
 * ```
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
    onTrackPromise,
  ) => {
    if (typeof storeClassOrConfig === 'function') {
      const spawnEntry: PendingChildSpawnEntry = {
        fsm,
        initialOverride,
        onNotifyParent,
        onEmitOutput,
        onTrackPromise,
        consumed: false,
      };
      pendingChildSpawnStack.push(spawnEntry);
      let instance: any;
      try {
        instance = injector
          ? runInInjectionContext(injector, () => new storeClassOrConfig())
          : new storeClassOrConfig();
      } finally {
        const idx = pendingChildSpawnStack.lastIndexOf(spawnEntry);
        if (idx >= 0) {
          pendingChildSpawnStack.splice(idx, 1);
        }
      }
      if (!spawnEntry.consumed) {
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
      undefined,
      onTrackPromise,
    );
  };
  standaloneOverrideFactories.set(fsm, spawnFactory);
  if (!defaultMachineFactories.has(fsm)) {
    defaultMachineFactories.set(fsm, spawnFactory);
  }
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

function createUnmockedDiProxy(path = 'injectedDependency'): any {
  const fn = () => {
    throw new Error(
      `[MatrixFSM]: Unmocked Angular DI dependency '${path}' was invoked outside an injection context (e.g. in createFeatureTester). Provide a mock in \`methods\` / \`actorMethods\` or pass an \`injector\`.`,
    );
  };
  return new Proxy(fn, {
    get(_target, prop) {
      if (typeof prop === 'symbol') {
        return undefined;
      }
      return createUnmockedDiProxy(`${path}.${String(prop)}`);
    },
    apply() {
      return fn();
    },
  });
}

const UNMOCKED_DI_ARGS: readonly unknown[] = Object.freeze(
  Array.from({ length: 16 }, (_, i) => createUnmockedDiProxy(`dep${i + 1}`)),
);

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
    return input(store, ...UNMOCKED_DI_ARGS) ?? {};
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

function extractItemId(
  item: unknown,
  index: number,
  seenIds?: Set<string>,
): string {
  let candidate: string;
  if (typeof item === 'string' || typeof item === 'number') {
    candidate = String(item);
  } else if (
    typeof item === 'object' &&
    item !== null &&
    'id' in item &&
    (typeof (item as { id: unknown }).id === 'string' ||
      typeof (item as { id: unknown }).id === 'number')
  ) {
    candidate = String((item as { id: string | number }).id);
  } else {
    candidate = String(index);
  }
  if (seenIds && seenIds.has(candidate)) {
    let suffix = index;
    while (seenIds.has(`${candidate}:${suffix}`)) {
      suffix++;
    }
    return `${candidate}:${suffix}`;
  }
  return candidate;
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

function resolveCombinatorActorRefs(
  combNode: CombinatorNode<any, any>,
): readonly SubMachineRef<any, any>[] {
  return (
    combNode.actorRefs ??
    combNode.machines.map((m: AnyFSMDefinition) => ({
      __type: 'subMachine' as const,
      id: m.id,
      machine: m,
    }))
  );
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
  actorMethodsOverrides?: Record<
    string,
    | ((store: any) => Record<string, (...args: any[]) => any>)
    | Record<string, (...args: any[]) => any>
    | undefined
  >,
  onTrackPromise?: (p: PromiseLike<unknown>) => void,
  skipInitialEffects = false,
): StateMachineStoreMembers<TFSM> & {
  readonly hasFinalPayloadSelector: Signal<boolean>;
  readonly subscribe: (
    listenerOrObserver:
      | ((snapshot: MachineSnapshot<TFSM>) => void)
      | MachineObserver<TFSM>,
  ) => MachineSubscription;
  readonly __hasActiveTransition: (event: string) => boolean;
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
  const subscribers = new Set<MachineObserver<TFSM>>();

  const baseFeatureConfig = defaultFeatureConfigs.get(fsm);
  const effectiveConfig = (
    config && baseFeatureConfig && config !== baseFeatureConfig
      ? {
          ...baseFeatureConfig,
          ...config,
          methods:
            baseFeatureConfig.methods && config.methods
              ? (store: any) => ({
                  ...resolveMethodsConfig(
                    baseFeatureConfig.methods,
                    store,
                    hostInjector,
                  ),
                  ...resolveMethodsConfig(
                    config.methods,
                    store,
                    hostInjector,
                  ),
                })
              : (config.methods ?? baseFeatureConfig.methods),
        }
      : (config ?? baseFeatureConfig)
  ) as StateMachineFeatureConfig<TFSM, any> | undefined;

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

  const syncContextOption = effectiveConfig?.syncContext;
  const SyncContextMapResolved = runWithDI(() =>
    resolveFactoryOrValue(syncContextOption),
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
  const hasSelectorSyncContext =
    typeof syncContextOption === 'function' &&
    Object.keys(initialSyncedPatch).some((k) => !(k in syncedSignals));

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
  let lastTaskSettledEpoch = -1;
  const taskSettledSig = signal<number>(-1);
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

  // Reactive merged context: combines internal context, SignalStore `withState`, `syncContext` signals/selectors,
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
    if (hasSelectorSyncContext) {
      const liveSelectorObj = runWithDI(() =>
        (syncContextOption as () => Record<string, unknown>)(),
      );
      if (liveSelectorObj && typeof liveSelectorObj === 'object') {
        for (const [k, v] of Object.entries(liveSelectorObj)) {
          syncedPatch[k] = isSignal(v) ? v() : v;
        }
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

  let explicitMethods: Record<string, (...args: any[]) => any> = {};

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
  const activeTaskSig = signal<boolean>(false);
  let activeSubNode: SubMachineRuntimeNode<any> | null = null;
  let activeSubRef: SubMachineRef<any, any> | null = null;
  let activeCombinator: {
    readonly node: CombinatorNode<any, any>;
    readonly actorRefs: readonly SubMachineRef<any, any>[];
    readonly children: Array<SubMachineRuntimeNode<any> | null>;
    readonly childSettled: boolean[];
    readonly completedOutputs: Record<string, unknown>;
    readonly orderedOutputs: unknown[];
    readonly failedIndices: Set<number>;
    readonly failedErrors: unknown[];
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
    if (
      isFlushingWatches ||
      pendingWatchRuns.size === 0 ||
      !producerUpdatesAllowed() ||
      isInNotificationPhase()
    ) {
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
  const settledEachSnapshots = new Map<
    string,
    ReadonlyArray<ChildMachineSnapshot>
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
        if (node) {
          if (refId === subId || activeSubRef?.machine.id === subId) {
            return node.fsmContext() as Readonly<Record<string, any>>;
          }
          const nestedSubSig = node.actors?.[subId];
          if (nestedSubSig) {
            const nestedVal = nestedSubSig();
            if (nestedVal !== null) {
              return nestedVal;
            }
          }
        }
        if (activeCombinator && !activeCombinator.settled) {
          const idx = activeCombinator.actorRefs.findIndex(
            (r) => r.id === subId || r.machine.id === subId,
          );
          if (idx >= 0 && activeCombinator.children[idx]) {
            return activeCombinator.children[idx]!.fsmContext() as Readonly<
              Record<string, any>
            >;
          }
          for (const child of activeCombinator.children) {
            const nestedCombSig = child?.actors?.[subId];
            if (nestedCombSig) {
              const nestedVal = nestedCombSig();
              if (nestedVal !== null) {
                return nestedVal;
              }
            }
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
    activeTaskSig.set(false);
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
      if (!child) {
        continue;
      }
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
    settledEachSnapshots.clear();
  };

  let isDestroyed = false;

  const destroy = (): void => {
    isDestroyed = true;
    eventQueue.length = 0;
    onNotifyParent = undefined;
    onEmitOutput = undefined;
    for (const obs of subscribers) {
      obs.complete?.();
    }
    subscribers.clear();
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
    const currentEpoch = stateEpochSig();
    const settledEpoch = taskSettledSig();
    const hasRunningTask = activeTaskSig();
    const subState = fsmSubStateSig();
    if (activeSubNode && activeSubRef && subState) {
      return activeSubNode.isPending();
    }
    if (activeCombinator && !activeCombinator.settled) {
      for (const child of activeCombinator.children) {
        if (child?.isPending()) {
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
    if (hasRunningTask) {
      return true;
    }
    return fsm.awaitingStates.has(currentState) && settledEpoch !== currentEpoch;
  });

  const isDone = computed<boolean>(() => doneOutcomeSig() !== null);

  const spawnChildNode = (
    subFSM: AnyFSMDefinition,
    inputContext: Record<string, unknown>,
    onChildTransition?: () => void,
    onChildEmitOutput?: (output: {
      readonly type: string;
      readonly payload: unknown;
    }) => void,
    skipChildInitial = false,
  ): SubMachineRuntimeNode<any> => {
    const token = getMachineToken(subFSM);
    let factory: SubMachineSpawnFactory<any> | null = null;
    if (hostInjector) {
      try {
        factory = hostInjector.get(token, null, { optional: true });
      } catch {
        factory = null;
      }
    } else if (standaloneOverrideFactories.has(subFSM)) {
      factory = standaloneOverrideFactories.get(subFSM) ?? null;
    }
    if (!factory && defaultMachineFactories.has(subFSM)) {
      factory = defaultMachineFactories.get(subFSM) ?? null;
    }

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
        skipChildInitial,
      );
    }

    if (factory) {
      const node = factory(
        hostInjector,
        inputContext,
        onChildTransition,
        onChildEmitOutput,
        onTrackPromise,
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
      if (Object.keys(inputContext).length > 0) {
        if (typeof node.patchContext === 'function') {
          node.patchContext(inputContext);
        } else {
          node.reset(inputContext);
        }
      }
      return node;
    }

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
      skipChildInitial,
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
    activeTaskSig.set(false);
    lastTaskSettledEpoch = handle.entryEpoch;
    taskSettledSig.set(lastTaskSettledEpoch);

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
    activeTaskSig.set(false);
    lastTaskSettledEpoch = handle.entryEpoch;
    taskSettledSig.set(lastTaskSettledEpoch);

    const activeStateName = fsmStateSig();

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

    if (!fsm.hasTransitionFor(activeStateName, 'ERROR')) {
      for (const obs of subscribers) {
        obs.error?.(err);
      }
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
    activeTaskSig.set(true);

    const ctxSnapshot = getEffectiveContext();

    try {
      const result = taskFn.call(
        methodsTarget,
        eventPayload,
        abortController.signal,
        ctxSnapshot,
      );

      if (
        effectiveConfig?.taskAdapter &&
        (!effectiveConfig.taskAdapter.canHandle ||
          effectiveConfig.taskAdapter.canHandle(result))
      ) {
        let resolveTracked: (() => void) | undefined;
        if (onTrackPromise) {
          onTrackPromise(
            new Promise<void>((r) => {
              resolveTracked = r;
            }),
          );
        }
        try {
          const adapterTeardown = effectiveConfig.taskAdapter.execute(result, {
            signal: abortController.signal,
            onSuccess: (output: unknown) => {
              resolveTracked?.();
              handleTaskSuccess(handle, output);
            },
            onFailure: (err: unknown) => {
              resolveTracked?.();
              handleTaskFailure(handle, err);
            },
            isCancelled: () => handle.cancelled,
          });
          handle.teardown = () => {
            resolveTracked?.();
            if (typeof adapterTeardown === 'function') {
              adapterTeardown();
            }
          };
        } catch (adapterErr) {
          resolveTracked?.();
          throw adapterErr;
        }
        return;
      }

      if (result && typeof (result as Promise<unknown>).then === 'function') {
        const promiseResult = result as Promise<unknown>;
        onTrackPromise?.(promiseResult);
        promiseResult.then(
          (output) => handleTaskSuccess(handle, output),
          (err) => handleTaskFailure(handle, err),
        );
        return;
      }

      if (isResourceRef(result)) {
        let resolveTracked: (() => void) | undefined;
        if (onTrackPromise) {
          onTrackPromise(
            new Promise<void>((r) => {
              resolveTracked = r;
            }),
          );
        }
        const initialStatus = untracked(() => result.status());
        if (initialStatus !== 'loading' && initialStatus !== 'reloading') {
          untracked(() => result.reload());
        }
        let settled = false;
        let resourceWatch: Watch | null = null;
        const cleanupWatch = () => {
          resolveTracked?.();
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

      if (isSubscribable(result)) {
        let resolveTracked: (() => void) | undefined;
        if (onTrackPromise) {
          onTrackPromise(
            new Promise<void>((r) => {
              resolveTracked = r;
            }),
          );
        }
        let settled = false;
        let sub: { unsubscribe(): void } | (() => void) | null = null;
        const cleanupSub = () => {
          resolveTracked?.();
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

      handleTaskSuccess(handle, result);
    } catch (syncErr) {
      handleTaskFailure(handle, syncErr);
    }
  };

  const publishChildSnapshots = (): void => {
    const record: Record<string, ReadonlyArray<ChildMachineSnapshot>> = {};
    for (const [key, settledList] of settledEachSnapshots.entries()) {
      record[key] = settledList;
    }
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

  const syncEachInstances = (
    eachNode: EachNode<any, any, any>,
    inputMapped?: Record<string, unknown> | null,
    skipChildInitial = false,
  ): void => {
    const key = eachNode.key;
    settledEachSnapshots.delete(key);
    const ctx = getEffectiveContext() as Record<string, unknown>;
    const rawArray = Array.isArray(ctx[key]) ? (ctx[key] as unknown[]) : [];

    let registry = eachRegistries.get(key);
    if (!registry) {
      registry = new Map<string, SubMachineRuntimeNode<any>>();
      eachRegistries.set(key, registry);
    }

    const activeIds = new Set<string>();
    const singularKey = singularizeEachKey(key);
    const isFeatureEach = defaultFeatureConfigs.has(eachNode.machine);
    const baseEachCtx = isFeatureEach ? {} : (ctx as Record<string, unknown>);

    for (let index = 0; index < rawArray.length; index++) {
      const item = rawArray[index];
      const id = extractItemId(item, index, activeIds);
      activeIds.add(id);
      if (!registry.has(id)) {
        const mappedItemInput = eachNode.itemInputMapper
          ? eachNode.itemInputMapper(item, index, ctx)
          : null;
        const itemContext =
          typeof item === 'object' && item !== null
            ? {
                ...baseEachCtx,
                ...(singularKey ? { [singularKey]: item } : {}),
                item,
                index,
                ...(inputMapped ?? {}),
                ...(item as Record<string, unknown>),
                ...(mappedItemInput ?? {}),
              }
            : {
                ...baseEachCtx,
                ...(singularKey ? { [singularKey]: item } : {}),
                item,
                index,
                ...(inputMapped ?? {}),
                ...(mappedItemInput ?? {}),
              };
        const childRunner = spawnChildNode(
          eachNode.machine,
          itemContext,
          () => {
            publishChildSnapshots();
            checkEachAllDone(eachNode);
          },
          (emitted) => {
            if (emitted.type === '__UNHANDLED_ERROR__') {
              if (
                untracked(() => fsmStateSig()) === eachNode.id &&
                fsm.hasTransitionFor(eachNode.id, 'ERROR')
              ) {
                dispatchInternal('ERROR', emitted.payload, true, true);
              } else {
                onEmitOutput?.(emitted);
              }
              return;
            }
            if (fsm.hasTransitionFor(eachNode.id, emitted.type)) {
              dispatchInternal(emitted.type, emitted.payload, true, false);
            }
          },
          skipChildInitial,
        );
        registry.set(id, childRunner);
      }
    }

    for (const [existingId, existingChild] of [...registry.entries()]) {
      if (!activeIds.has(existingId)) {
        existingChild.destroy?.();
        registry.delete(existingId);
      }
    }

    publishChildSnapshots();
    if (!skipChildInitial) {
      checkEachAllDone(eachNode);
    }
  };

  const checkEachAllDone = (eachNode: EachNode<any, any, any>): void => {
    const registry = eachRegistries.get(eachNode.key);
    if (!registry || registry.size === 0) {
      if (untracked(() => fsmStateSig()) === eachNode.id) {
        settledEachSnapshots.set(eachNode.key, []);
        eachRegistries.delete(eachNode.key);
        publishChildSnapshots();
        if (fsm.hasTransitionFor(eachNode.id, 'ALL_DONE')) {
          dispatchInternal('ALL_DONE', [], true, true);
        } else if (fsm.hasTransitionFor(eachNode.id, 'DONE')) {
          dispatchInternal('DONE', [], true, true);
        }
      }
      return;
    }
    const instances = [...registry.values()];
    const erroredChild = instances.find(
      (inst) => inst.isDone() && inst.finalOutcome() === 'ERROR',
    );
    if (erroredChild) {
      if (
        untracked(() => fsmStateSig()) === eachNode.id &&
        fsm.hasTransitionFor(eachNode.id, 'ERROR')
      ) {
        const errPayload =
          typeof erroredChild.hasFinalPayloadSelector === 'function' &&
          erroredChild.hasFinalPayloadSelector() &&
          typeof erroredChild.finalPayload === 'function'
            ? erroredChild.finalPayload()
            : erroredChild.fsmContext();
        dispatchInternal('ERROR', errPayload, true, true);
      }
      return;
    }
    if (instances.length > 0 && instances.every((inst) => inst.isDone())) {
      if (untracked(() => fsmStateSig()) === eachNode.id) {
        const settledList: ChildMachineSnapshot[] = [];
        for (const [id, instance] of registry.entries()) {
          settledList.push({
            id,
            state: instance.fsmState(),
            subState: instance.fsmSubState(),
            context: instance.fsmContext(),
            isPending: instance.isPending(),
            isDone: instance.isDone(),
            finalOutcome: instance.finalOutcome(),
          });
        }
        const aggregatedOutputs = instances.map((inst) =>
          typeof inst.hasFinalPayloadSelector === 'function' &&
          inst.hasFinalPayloadSelector() &&
          typeof inst.finalPayload === 'function'
            ? inst.finalPayload()
            : inst.fsmContext(),
        );
        settledEachSnapshots.set(eachNode.key, settledList);
        for (const inst of instances) {
          inst.destroy?.();
        }
        eachRegistries.delete(eachNode.key);
        publishChildSnapshots();
        if (fsm.hasTransitionFor(eachNode.id, 'ALL_DONE')) {
          dispatchInternal('ALL_DONE', aggregatedOutputs, true, true);
        } else if (fsm.hasTransitionFor(eachNode.id, 'DONE')) {
          dispatchInternal('DONE', aggregatedOutputs, true, true);
        }
      }
    }
  };

  const enterSubMachineNode = (
    subRef: SubMachineRef<any, any>,
    inputMapped: Record<string, unknown> | null,
    skipChildInitial = false,
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
        if (!activeSubNode) {
          return;
        }
        checkSubNodeCompletion();
        onNotifyParent?.();
      },
      (emitted) => {
        if (!activeSubRef) {
          return;
        }
        const refId = activeSubRef.id;
        if (emitted.type === '__UNHANDLED_ERROR__') {
          destroyActiveSubNode();
          if (fsm.hasTransitionFor(refId, 'ERROR')) {
            dispatchInternal('ERROR', emitted.payload, true, true, refId);
            return;
          }
          onEmitOutput?.(emitted);
          return;
        }
        if (!fsm.hasTransitionFor(refId, emitted.type)) {
          throw new Error(
            `[MatrixFSM Error]: Sub-machine '${refId}' emitted output '${emitted.type}', but parent '${fsm.id}' has no matching transition. Prevented silent deadlock!`,
          );
        }
        dispatchInternal(emitted.type, emitted.payload, true);
      },
      skipChildInitial,
    );
    activeSubNode = childNode;
    activeSubNodeSig.set(childNode);
    syncSubNodeSignals();
    if (!skipChildInitial) {
      checkSubNodeCompletion();
    }
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
    skipChildInitial = false,
    restoredProgress?: CombinatorSnapshotProgress,
  ): void => {
    destroyActiveCombinator();
    const actorRefs = resolveCombinatorActorRefs(combNode);
    const totalActors = actorRefs.length;
    const children = new Array<SubMachineRuntimeNode<any> | null>(
      totalActors,
    ).fill(null);
    const settledSet = new Set<number>(restoredProgress?.settledIndices ?? []);
    const childSettled = Array.from({ length: totalActors }, (_, idx) =>
      settledSet.has(idx),
    );
    const completedOutputs: Record<string, unknown> = {
      ...(restoredProgress?.completedOutputs ?? {}),
    };
    const orderedOutputs: unknown[] = restoredProgress?.orderedOutputs
      ? [...restoredProgress.orderedOutputs]
      : new Array(totalActors);
    const failedIndices = new Set<number>(
      restoredProgress?.failedIndices ?? [],
    );
    const failedErrors: unknown[] = restoredProgress?.failedErrors
      ? [...restoredProgress.failedErrors]
      : new Array(totalActors);
    const combState = {
      node: combNode,
      actorRefs,
      children,
      childSettled,
      completedOutputs,
      orderedOutputs,
      failedIndices,
      failedErrors,
      settled: false,
    };
    activeCombinator = combState;
    let spawnCompleted = false;

    const settleCombinator = (preferredOutcome: string, payload: unknown) => {
      if (combState.settled || activeCombinator !== combState) {
        return;
      }
      combState.settled = true;
      const combId = combNode.id;
      destroyActiveCombinator();
      if (fsm.hasTransitionFor(combId, preferredOutcome)) {
        dispatchInternal(preferredOutcome, payload, true, true);
      } else if (fsm.hasTransitionFor(combId, 'ALL_DONE')) {
        dispatchInternal('ALL_DONE', payload, true, true);
      } else if (fsm.hasTransitionFor(combId, 'DONE')) {
        dispatchInternal('DONE', payload, true, true);
      }
    };

    const checkAllCompletion = () => {
      if (
        !combState.settled &&
        activeCombinator === combState &&
        spawnCompleted &&
        childSettled.every(Boolean)
      ) {
        const combId = combNode.id;
        if (fsm.hasTransitionFor(combId, 'ALL_DONE')) {
          settleCombinator('ALL_DONE', { ...completedOutputs });
        } else {
          settleCombinator('DONE', orderedOutputs);
        }
      }
    };

    const evaluateCombinatorProgress = (
      idx: number,
      explicitChild?: SubMachineRuntimeNode<any>,
    ) => {
      if (combState.settled || activeCombinator !== combState) {
        return;
      }
      combinatorTickSig.update((n) => n + 1);
      const child = children[idx] ?? explicitChild;
      const actorRef = actorRefs[idx];
      if (!child || !actorRef || !child.isDone() || childSettled[idx]) {
        return;
      }
      childSettled[idx] = true;
      children[idx] = null;
      const actorId = actorRef.id;
      const outcome = child.finalOutcome() ?? 'DONE';
      const childPayload = extractChildTerminalPayload(child);

      child.destroy?.();

      if (combNode.__type === 'all') {
        completedOutputs[actorId] = childPayload;
        orderedOutputs[idx] = childPayload;

        if (fsm.hasTransitionFor(actorId, outcome, { exact: true })) {
          dispatchInternal(outcome, childPayload, true, false, actorId);
          if (combState.settled || activeCombinator !== combState) {
            return;
          }
        } else if (outcome === 'ERROR') {
          settleCombinator('ERROR', childPayload);
          return;
        }

        checkAllCompletion();
      } else if (combNode.__type === 'race') {
        if (fsm.hasTransitionFor(actorId, outcome, { exact: true })) {
          combState.settled = true;
          destroyActiveCombinator();
          dispatchInternal(outcome, childPayload, true, true, actorId);
          return;
        }
        settleCombinator(outcome, childPayload);
      } else if (combNode.__type === 'any') {
        if (outcome === 'ERROR') {
          failedIndices.add(idx);
          failedErrors[idx] = childPayload;
          if (failedIndices.size === totalActors) {
            settleCombinator('ERROR', failedErrors);
          }
        } else {
          if (fsm.hasTransitionFor(actorId, outcome, { exact: true })) {
            combState.settled = true;
            destroyActiveCombinator();
            dispatchInternal(outcome, childPayload, true, true, actorId);
            return;
          }
          settleCombinator(outcome, childPayload);
        }
      }
    };

    const isActorKeyedInput = Boolean(
      inputMapped &&
        typeof inputMapped === 'object' &&
        actorRefs.some(
          (r) =>
            r.id in inputMapped &&
            typeof inputMapped[r.id] === 'object' &&
            inputMapped[r.id] !== null,
        ),
    );

    actorRefs.forEach((actorRef, idx) => {
      if (combState.settled || activeCombinator !== combState || childSettled[idx]) {
        return;
      }
      const actorId = actorRef.id;
      const childFSM = actorRef.machine;
      const isFeatureChild = defaultFeatureConfigs.has(childFSM);
      const keyedChildInput =
        inputMapped &&
        typeof inputMapped === 'object' &&
        actorId in inputMapped &&
        typeof inputMapped[actorId] === 'object' &&
        inputMapped[actorId] !== null
          ? (inputMapped[actorId] as Record<string, unknown>)
          : null;
      const mappedForChild = isActorKeyedInput
        ? (keyedChildInput ?? {})
        : { ...(inputMapped ?? {}), ...(keyedChildInput ?? {}) };
      const initialChildInput = isFeatureChild
        ? mappedForChild
        : {
            ...(getEffectiveContext() as Record<string, unknown>),
            ...mappedForChild,
          };

      const localChildBox: { current?: SubMachineRuntimeNode<any> } = {};
      const childNode = spawnChildNode(
        childFSM,
        initialChildInput,
        () => {
          evaluateCombinatorProgress(idx, localChildBox.current);
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
              if (failedIndices.size === totalActors) {
                settleCombinator('ERROR', failedErrors);
              }
            }
            return;
          }
          if (
            fsm.hasTransitionFor(actorId, emitted.type, { exact: true }) ||
            fsm.hasTransitionFor(combNode.id, emitted.type)
          ) {
            dispatchInternal(
              emitted.type,
              emitted.payload,
              true,
              false,
              fsm.hasTransitionFor(actorId, emitted.type, { exact: true })
                ? actorId
                : undefined,
            );
          }
        },
        skipChildInitial,
      );
      localChildBox.current = childNode;
      if (combState.settled || activeCombinator !== combState || childSettled[idx]) {
        childNode.destroy?.();
        return;
      }
      children[idx] = childNode;
    });

    spawnCompleted = true;
    combinatorTickSig.update((n) => n + 1);
    if (!skipChildInitial) {
      for (let i = 0; i < children.length; i++) {
        evaluateCombinatorProgress(i);
      }
      if (combNode.__type === 'all') {
        checkAllCompletion();
      }
    }
  };

  const hasActiveTransition = (event: string): boolean => {
    const currentState = untracked(() => fsmStateSig());
    if (activeSubNode && activeSubRef) {
      if (canSubNodeHandleEvent(activeSubRef, activeSubNode, event)) {
        return true;
      }
    }
    if (
      activeCombinator &&
      !activeCombinator.settled &&
      !fsm.hasTransitionFor(activeCombinator.node.id, event, { exact: true })
    ) {
      for (let i = 0; i < activeCombinator.children.length; i++) {
        const child = activeCombinator.children[i];
        const actorRef = activeCombinator.actorRefs[i];
        if (child && actorRef && !child.isDone()) {
          if (canSubNodeHandleEvent(actorRef, child, event)) {
            return true;
          }
        }
      }
    }
    const eachNode = fsm.eachNodes.get(currentState);
    if (eachNode && !fsm.hasTransitionFor(eachNode.id, event, { exact: true })) {
      const registry = eachRegistries.get(eachNode.key);
      if (registry) {
        const eachRef: SubMachineRef<any, any> = {
          __type: 'subMachine',
          id: eachNode.machine.id,
          machine: eachNode.machine,
        };
        for (const child of registry.values()) {
          if (!child.isDone() && canSubNodeHandleEvent(eachRef, child, event)) {
            return true;
          }
        }
      }
    }
    return fsm.hasTransitionFor(currentState, event);
  };

  const canSubNodeHandleEvent = (
    subRef: SubMachineRef<any, any>,
    node: SubMachineRuntimeNode<any>,
    event: string,
  ): boolean => {
    if (typeof node.__hasActiveTransition === 'function') {
      return node.__hasActiveTransition(event);
    }
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
      if (typeof via.ms === 'function') {
        debugLog?.(
          `[MatrixFSM:${fsm.id}] Paused every() timer '${via.id}' in state '${stateName}' (resolved delay: ${String(rawMs)})`,
        );
      }
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
      if (!srcIds.includes(stateName) && !sourceIncludesAnyState(from)) {
        continue;
      }
      const viaItems = Array.isArray(via) ? via : [via];
      for (const viaItem of viaItems) {
        if (isAfterNode(viaItem) && !scheduledIds.has(viaItem.id)) {
          scheduledIds.add(viaItem.id);
          const rawMs =
            typeof viaItem.ms === 'function'
              ? viaItem.ms(getEffectiveContext())
              : viaItem.ms;
          if (
            typeof rawMs === 'number' &&
            Number.isFinite(rawMs) &&
            rawMs >= 0
          ) {
            const timerId = setTimeout(() => {
              if (
                !isDestroyed &&
                stateEpoch === entryEpoch &&
                untracked(() => fsmStateSig()) === stateName
              ) {
                dispatchInternal(viaItem.id, undefined, false, false);
              }
            }, rawMs);
            activeTimers.push(timerId);
          } else {
            debugLog?.(
              `[MatrixFSM:${fsm.id}] Skipped invalid after() timer '${viaItem.id}' in state '${stateName}' (resolved delay: ${String(rawMs)})`,
            );
          }
        } else if (isEveryNode(viaItem) && !scheduledIds.has(viaItem.id)) {
          scheduledIds.add(viaItem.id);
          scheduleOrUpdateEveryTimer(stateName, entryEpoch, viaItem, true);
        }
      }
    }
  };

  const notifySubscribers = (): void => {
    if (subscribers.size === 0) {
      return;
    }
    const snap = getSnapshot();
    for (const obs of subscribers) {
      obs.next?.(snap);
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

    if (!fromChildOutput && activeSubNode && activeSubRef) {
      if (canSubNodeHandleEvent(activeSubRef, activeSubNode, event)) {
        activeSubNode.send(event, payload);
        checkSubNodeCompletion();
        notifySubscribers();
        onNotifyParent?.();
        return;
      }
    }

    if (
      !fromChildOutput &&
      activeCombinator &&
      !activeCombinator.settled &&
      !fsm.hasTransitionFor(activeCombinator.node.id, event, { exact: true })
    ) {
      let handledByAnyCombChild = false;
      const combSnap = activeCombinator;
      for (let i = 0; i < combSnap.children.length; i++) {
        const child = combSnap.children[i];
        const actorRef = combSnap.actorRefs[i];
        if (!child || !actorRef || child.isDone()) {
          continue;
        }
        if (canSubNodeHandleEvent(actorRef, child, event)) {
          handledByAnyCombChild = true;
          child.send(event, payload);
          if (combSnap.settled) {
            break;
          }
        }
      }
      if (handledByAnyCombChild) {
        combinatorTickSig.update((n) => n + 1);
        notifySubscribers();
        onNotifyParent?.();
        return;
      }
    }

    const activeEachNode = fsm.eachNodes.get(currentState);
    if (
      !fromChildOutput &&
      activeEachNode &&
      !fsm.hasTransitionFor(currentState, event, { exact: true })
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
          notifySubscribers();
          onNotifyParent?.();
          return;
        }
      }
    }

    const evaluation = fsm.evaluate(
      effectiveFromState,
      event,
      payload,
      currentCtx,
    );

    if (!evaluation.matched) {
      const everyEntry = activeEveryTimers.get(event);
      if (everyEntry) {
        scheduleOrUpdateEveryTimer(
          currentState,
          stateEpoch,
          everyEntry.via,
          true,
        );
      }
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

    if (!evaluation.stayed && activeSubNode && activeSubRef) {
      const childCurrentState = activeSubNode.fsmState();
      if (!fsm.states.has(childCurrentState)) {
        onExitHooks[childCurrentState]?.(getEffectiveContext());
      }
      destroyActiveSubNode();
    }
    if (!evaluation.stayed && activeCombinator) {
      destroyActiveCombinator();
    }

    const nextState = evaluation.nextState;
    if (!evaluation.stayed) {
      clearActiveTimers();
      cancelActiveTask();
      const exitingEach = fsm.eachNodes.get(currentState);
      if (exitingEach && nextState !== currentState) {
        const poolToCancel = eachRegistries.get(exitingEach.key);
        if (poolToCancel) {
          for (const child of poolToCancel.values()) {
            child.destroy?.();
          }
          eachRegistries.delete(exitingEach.key);
        }
        if (!fromChildTerminal) {
          settledEachSnapshots.delete(exitingEach.key);
        }
        publishChildSnapshots();
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
      notifySubscribers();
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
      const existingPool = eachRegistries.get(evaluation.enteredEach.key);
      if (existingPool) {
        for (const child of existingPool.values()) {
          child.destroy?.();
        }
        eachRegistries.delete(evaluation.enteredEach.key);
      }
      settledEachSnapshots.delete(evaluation.enteredEach.key);
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
      fsm.hasTransitionFor(nextState, '__always__') &&
      !eventQueue.some((q) => q.event === '__always__')
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

    notifySubscribers();
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
      !fsm.hasTransitionFor(activeCombinator.node.id, event, { exact: true })
    ) {
      const combSnap = activeCombinator;
      for (let i = 0; i < combSnap.children.length; i++) {
        const child = combSnap.children[i];
        const actorRef = combSnap.actorRefs[i];
        if (!child || !actorRef || child.isDone()) {
          continue;
        }
        const childHandles =
          typeof child.can === 'function'
            ? child.can(event, payload)
            : canSubNodeHandleEvent(actorRef, child, event);
        if (childHandles) {
          return true;
        }
      }
    }

    const eachNode = fsm.eachNodes.get(currentState);
    if (eachNode && !fsm.hasTransitionFor(eachNode.id, event, { exact: true })) {
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

  const send: SendFn<TFSM> = ((...args: [event: string, payload?: unknown]) => {
    flushPendingSignalWatches();
    const [event, payload] = args;
    dispatchInternal(event, payload, false, false);
  }) as SendFn<TFSM>;

  const sendToChild: SendToChildFn<TFSM> = ((
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
    notifySubscribers();
    onNotifyParent?.();
  }) as SendToChildFn<TFSM>;

  const triggerReactiveContextEffects = (): void => {
    const activeState = untracked(() => fsmStateSig());
    for (const [, entry] of activeEveryTimers.entries()) {
      scheduleOrUpdateEveryTimer(activeState, stateEpoch, entry.via, false);
    }
    const activeEach = fsm.eachNodes.get(activeState);
    if (activeEach) {
      syncEachInstances(activeEach);
    }
    if (
      untracked(() => doneOutcomeSig()) === null &&
      fsm.hasTransitionFor(activeState, '__always__') &&
      !eventQueue.some((q) => q.event === '__always__')
    ) {
      dispatchInternal('__always__', undefined, false, false);
    }
  };

  const patchContext = (patch: Partial<TContext>): void => {
    applyContextPatch(patch);
    triggerReactiveContextEffects();
    notifySubscribers();
  };

  const getSnapshot = (): MachineSnapshot<TFSM> => {
    flushPendingSignalWatches();
    const children: Record<string, MachineSnapshot<any>> = {};
    if (
      activeSubNode &&
      activeSubRef &&
      typeof activeSubNode.getSnapshot === 'function'
    ) {
      children[activeSubRef.id] = activeSubNode.getSnapshot();
    }
    let combinatorProgress: CombinatorSnapshotProgress | undefined;
    if (activeCombinator && !activeCombinator.settled) {
      activeCombinator.children.forEach((child, idx) => {
        const actorRef = activeCombinator!.actorRefs[idx];
        if (child && actorRef && typeof child.getSnapshot === 'function') {
          children[actorRef.id] = child.getSnapshot();
        }
      });
      if (
        activeCombinator.childSettled.some(Boolean) ||
        activeCombinator.failedIndices.size > 0
      ) {
        const settledIndices: number[] = [];
        activeCombinator.childSettled.forEach((isSettled, idx) => {
          if (isSettled) {
            settledIndices.push(idx);
          }
        });
        combinatorProgress = {
          settledIndices,
          completedOutputs: { ...activeCombinator.completedOutputs },
          orderedOutputs: [...activeCombinator.orderedOutputs],
          failedIndices: [...activeCombinator.failedIndices],
          failedErrors: [...activeCombinator.failedErrors],
        };
      }
    }
    for (const [key, registry] of eachRegistries.entries()) {
      for (const [itemId, child] of registry.entries()) {
        if (typeof child.getSnapshot === 'function') {
          children[`each:${key}:${itemId}`] = child.getSnapshot();
        }
      }
    }
    const currentDoneOutcome = untracked(() => doneOutcomeSig());
    return {
      state: untracked(() => fsmStateSig()) as ExtractStates<TFSM>,
      context: { ...(getEffectiveContext() as Record<string, any>) } as Readonly<
        ExtractContext<TFSM>
      >,
      stateEpoch,
      ...(currentDoneOutcome !== null
        ? {
            doneOutcome: currentDoneOutcome,
            finalPayload: untracked(() => finalPayloadSig()),
            hasFinalPayloadSelector: untracked(() =>
              hasFinalPayloadSelectorSig(),
            ),
          }
        : {}),
      ...(combinatorProgress ? { combinatorProgress } : {}),
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
    doneOutcomeSig.set(snapshot.doneOutcome ?? null);
    finalPayloadSig.set(snapshot.finalPayload);
    hasFinalPayloadSelectorSig.set(Boolean(snapshot.hasFinalPayloadSelector));
    lastTaskSettledEpoch = -1;
    taskSettledSig.set(-1);
    applyContextPatch(snapshot.context as Partial<TContext>);
    stateEpoch = Math.max(stateEpoch + 1, snapshot.stateEpoch);
    stateEpochSig.set(stateEpoch);
    const restoredState = snapshot.state as TState;
    fsmStateSig.set(restoredState);
    const subRef = fsm.subMachines.get(restoredState);
    if (subRef) {
      const childSnap = snapshot.children?.[subRef.id];
      enterSubMachineNode(
        subRef,
        snapshot.context as Record<string, unknown>,
        Boolean(childSnap),
      );
      if (
        childSnap &&
        activeSubNode &&
        typeof activeSubNode.restoreSnapshot === 'function'
      ) {
        activeSubNode.restoreSnapshot(childSnap);
        syncSubNodeSignals();
        checkSubNodeCompletion();
      }
    } else {
      fsmSubStateSig.set(null);
      fsmSubContextSig.set(null);
    }
    const combNode = fsm.combinatorNodes?.get(restoredState);
    if (combNode) {
      const hasChildSnaps = Boolean(snapshot.children);
      enterCombinatorNode(
        combNode,
        snapshot.context as Record<string, unknown>,
        hasChildSnaps,
        snapshot.combinatorProgress,
      );
      const spawnedComb = activeCombinator;
      if (spawnedComb && !spawnedComb.settled && snapshot.children) {
        spawnedComb.children.forEach(
          (child: SubMachineRuntimeNode<any> | null, idx: number) => {
            const actorRef = spawnedComb.actorRefs[idx];
            const childSnap = actorRef
              ? (snapshot.children?.[actorRef.id] ??
                snapshot.children?.[actorRef.machine.id])
              : undefined;
            if (child && childSnap && typeof child.restoreSnapshot === 'function') {
              child.restoreSnapshot(childSnap);
            }
          },
        );
        combinatorTickSig.update((n) => n + 1);
      }
    }
    const eachNode = fsm.eachNodes.get(restoredState);
    if (eachNode) {
      const hasChildSnaps = Boolean(snapshot.children);
      syncEachInstances(eachNode, null, hasChildSnaps);
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
        checkEachAllDone(eachNode);
      }
    }
    if ((snapshot.doneOutcome ?? null) === null) {
      scheduleStateTimers(restoredState);
      if (fsm.awaitingStates.has(restoredState)) {
        startAwaitingTaskIfNeeded(restoredState);
      }
      if (fsm.hasTransitionFor(restoredState, '__always__')) {
        dispatchInternal('__always__', undefined, false, false);
      }
    }
    notifySubscribers();
  };

  const enterInitialStateTopology = (): void => {
    const initSub = fsm.subMachines.get(fsm.initial);
    if (initSub) {
      enterSubMachineNode(initSub, null);
    }
    const initComb = fsm.combinatorNodes?.get(fsm.initial);
    if (initComb) {
      enterCombinatorNode(initComb, null);
    }
    const initEach = fsm.eachNodes.get(fsm.initial);
    if (initEach) {
      syncEachInstances(initEach);
    }
    scheduleStateTimers(fsm.initial);
    if (fsm.awaitingStates.has(fsm.initial)) {
      startAwaitingTaskIfNeeded(fsm.initial);
    }
    if (
      untracked(() => fsmStateSig()) === fsm.initial &&
      fsm.hasTransitionFor(fsm.initial, '__always__')
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
    eventQueue.length = 0;
    doneOutcomeSig.set(null);
    finalPayloadSig.set(undefined);
    hasFinalPayloadSelectorSig.set(false);
    lastTaskSettledEpoch = -1;
    taskSettledSig.set(-1);
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
    if (storeStateKeys.size > 0) {
      const storeResetPatch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(nextInit as Record<string, unknown>)) {
        if (storeStateKeys.has(k)) {
          storeResetPatch[k] = v;
        }
      }
      patchState(effectiveStoreSource as any, storeResetPatch);
    }
    stateEpoch++;
    stateEpochSig.set(stateEpoch);
    fsmStateSig.set(fsm.initial as TState);
    childMachinesSig.set({});
    enterInitialStateTopology();
    notifySubscribers();
  };

  const subscribe = (
    listenerOrObserver:
      | ((snapshot: MachineSnapshot<TFSM>) => void)
      | MachineObserver<TFSM>,
  ): MachineSubscription => {
    const observer: MachineObserver<TFSM> =
      typeof listenerOrObserver === 'function'
        ? { next: listenerOrObserver }
        : listenerOrObserver;
    if (!isDestroyed) {
      subscribers.add(observer);
    }
    const unsub = (() => {
      subscribers.delete(observer);
    }) as MachineSubscription;
    unsub.unsubscribe = unsub;
    return unsub;
  };

  const wrappedSignalCache = new WeakMap<
    (...args: any[]) => any,
    (...args: any[]) => any
  >();
  const wrapSignalWithWatchFlush = <T extends (...args: any[]) => any>(
    sigFn: T,
  ): T => {
    const cached = wrappedSignalCache.get(sigFn);
    if (cached) {
      return cached as T;
    }
    const wrapped = new Proxy(sigFn, {
      apply(target, thisArg, argArray) {
        flushPendingSignalWatches();
        return Reflect.apply(target, thisArg, argArray);
      },
      get(target, prop, receiver) {
        if (typeof prop === 'symbol') {
          return Reflect.get(target, prop, target);
        }
        const desc = Reflect.getOwnPropertyDescriptor(target, prop);
        const val = Reflect.get(target, prop, receiver);
        if (desc && !desc.configurable && !desc.writable) {
          return val;
        }
        if (
          typeof val === 'function' &&
          prop !== 'bind' &&
          prop !== 'call' &&
          prop !== 'apply' &&
          prop !== 'toString'
        ) {
          return wrapSignalWithWatchFlush(val as (...args: any[]) => any);
        }
        return val;
      },
    });
    wrappedSignalCache.set(sigFn, wrapped);
    return wrapped;
  };

  const fsmStateReadonly = wrapSignalWithWatchFlush(fsmStateSig.asReadonly());
  const fsmContextFlushed = wrapSignalWithWatchFlush(fsmContext);

  const runnerResult = {
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
    send,
    sendToChild,
    patchContext,
    getSnapshot,
    restoreSnapshot,
    reset,
    destroy,
    subscribe,
    __hasActiveTransition: hasActiveTransition,
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

  // Build `storeForMethods` so `methods: (store) => ...` runs ONCE with full access to
  // `patchState(store, ...)`, `store.send(...)`, `store.state()`, `store.fsmContext()`, and `store.<inputKey>()`!
  const dynamicContextPropSignals = new Map<string, Signal<unknown>>();
  const sourceRecord = effectiveStoreSource as Record<PropertyKey, any>;
  const storeForMethods = new Proxy({} as Record<PropertyKey, any>, {
    get(_dummy, prop) {
      if (typeof prop === 'symbol') {
        return Reflect.get(sourceRecord, prop, sourceRecord);
      }
      if (prop === '__fsmApplyPatch') {
        return applyContextPatch;
      }
      if (typeof prop === 'string' && prop in runnerResult) {
        return (runnerResult as Record<string, unknown>)[prop];
      }
      if (prop in sourceRecord) {
        const val = Reflect.get(sourceRecord, prop, sourceRecord);
        return typeof val === 'function' && isSignal(val)
          ? wrapSignalWithWatchFlush(val)
          : val;
      }
      if (typeof prop === 'string' && prop in explicitMethods) {
        return explicitMethods[prop];
      }
      if (typeof prop === 'string') {
        let dynSig = dynamicContextPropSignals.get(prop);
        if (!dynSig) {
          dynSig = wrapSignalWithWatchFlush(
            computed(
              () => (fsmContext() as Record<string, unknown>)[prop],
            ),
          );
          dynamicContextPropSignals.set(prop, dynSig);
        }
        return dynSig;
      }
      return undefined;
    },
    has(_dummy, prop) {
      return (
        prop in sourceRecord ||
        (typeof prop === 'string' &&
          (prop in runnerResult || prop in explicitMethods))
      );
    },
  });

  explicitMethods = resolveMethodsConfig(
    effectiveConfig?.methods,
    storeForMethods,
    hostInjector,
  ) as Record<string, (...args: any[]) => any>;
  resolvedMethodsBySend.set(send, explicitMethods);

  if (!skipInitialEffects) {
    enterInitialStateTopology();
  }

  // Register reactive watchers for `syncContext` signals so `store.<key>()`, `always()`, and `every()` stay in sync!
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
          triggerReactiveContextEffects();
          notifySubscribers();
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

  // Also support reactive selector functions in `syncContext`
  if (hasSelectorSyncContext) {
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
          currentValues[k] = isSignal(v) ? v() : v;
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
            triggerReactiveContextEffects();
            notifySubscribers();
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

  return runnerResult;
}

/**
 * `@ngrx/signals` `signalStoreFeature` that mounts a {@link createMachineFeature} or
 * {@link createFSM} definition directly onto an Angular `SignalStore`.
 *
 * @group SignalStore Integration
 * @param fsm - Machine definition (`createMachineFeature`, `createEffectMachineFeature`, or `createFSM`).
 * @param configArgs - Optional runtime overrides (`state`, `syncContext`, `methods`, `debug`, `inspect`, `onEnter`, `onExit`).
 * @returns An `@ngrx/signals` `SignalStoreFeature` adding state signals, `StateMachineStoreMembers`, and lifecycle cleanup.
 *
 * @remarks
 * Automatically wires Angular `DestroyRef` cleanup so timers, `AbortSignal`s, RxJS subscriptions,
 * Effect fibers, and child actors terminate cleanly when the host component or service is destroyed.
 *
 * @example
 * ```ts
 * import { Injectable } from '@angular/core';
 * import { signalStore } from '@ngrx/signals';
 * import { withStateMachine } from '@matrix-fsm/angular';
 * import { coffeeShopFSM } from './coffee-shop.machine';
 *
 * @Injectable()
 * export class CoffeeShopStore extends signalStore(
 *   withStateMachine(coffeeShopFSM),
 * ) {}
 * ```
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
      ? {
          ...baseFeatureConfig,
          ...(explicitConfig ?? {}),
          methods:
            baseFeatureConfig.methods && explicitConfig?.methods
              ? (store: any) => ({
                  ...resolveMethodsConfig(baseFeatureConfig.methods, store, null),
                  ...resolveMethodsConfig(explicitConfig.methods, store, null),
                })
              : (explicitConfig?.methods ?? baseFeatureConfig.methods),
        }
      : explicitConfig
  ) as StateMachineFeatureConfig<TFSM, any> | undefined;

  // Register a default spawn factory ONLY if `fsm` does not already have one
  // (prevents overriding a shared `createMachineFeature`'s default factory globally!).
  if (!defaultMachineFactories.has(fsm)) {
    bindDefaultMachineFactory(
      fsm,
      (
        injector,
        initialOverride,
        onNotifyParent,
        onEmitOutput,
        onTrackPromise,
      ) =>
        createScopedMachineRunner(
          fsm,
          explicitConfig,
          injector,
          initialOverride,
          undefined,
          onNotifyParent,
          onEmitOutput,
          undefined,
          onTrackPromise,
        ),
    );
  }

  const features: SignalStoreFeature<any, any>[] = [];

  if (config?.state !== undefined) {
    features.push(
      withState(() => resolveFactoryOrValue(config.state) as object),
    );
  } else if ((fsm as { readonly __isMachineFeature?: boolean }).__isMachineFeature) {
    features.push(withState(() => ({ ...(fsm.context ?? {}) })));
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

        let pendingSpawn: PendingChildSpawnEntry | undefined;
        for (let i = pendingChildSpawnStack.length - 1; i >= 0; i--) {
          const candidate = pendingChildSpawnStack[i];
          if (candidate.fsm === fsm && !candidate.consumed) {
            candidate.consumed = true;
            pendingSpawn = candidate;
            break;
          }
        }

        const runner = createScopedMachineRunner(
          fsm,
          explicitConfig,
          hostInjector,
          pendingSpawn?.initialOverride,
          store as Record<string, any>,
          pendingSpawn?.onNotifyParent,
          pendingSpawn?.onEmitOutput,
          undefined,
          pendingSpawn?.onTrackPromise,
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

  if (config?.methods) {
    features.push(
      withMethods((store) => ({
        ...(resolvedMethodsBySend.get((store as any).send) ?? {}),
      })),
    );
  }

  features.push(
    ((innerStore: any) => {
      const flushFn = innerStore?.props?.__flushPendingWatches;
      if (typeof flushFn === 'function' && innerStore?.stateSignals) {
        const wrapSubSignal = (sigFn: any): any =>
          typeof sigFn === 'function'
            ? new Proxy(sigFn, {
                apply(target, thisArg, argArray) {
                  flushFn();
                  return Reflect.apply(target, thisArg, argArray);
                },
                get(target, prop, receiver) {
                  if (typeof prop === 'symbol') {
                    return Reflect.get(target, prop, target);
                  }
                  const desc = Reflect.getOwnPropertyDescriptor(target, prop);
                  const val = Reflect.get(target, prop, receiver);
                  if (desc && !desc.configurable && !desc.writable) {
                    return val;
                  }
                  if (
                    typeof val === 'function' &&
                    prop !== 'bind' &&
                    prop !== 'call' &&
                    prop !== 'apply' &&
                    prop !== 'toString'
                  ) {
                    return wrapSubSignal(val);
                  }
                  return val;
                },
              })
            : sigFn;

        const wrappedStateSignals: Record<PropertyKey, any> = {};
        for (const key of Reflect.ownKeys(innerStore.stateSignals)) {
          wrappedStateSignals[key] = wrapSubSignal(
            innerStore.stateSignals[key],
          );
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

/**
 * Named type contract for {@link createMachineFeature} and `createEffectMachineFeature`.
 *
 * @group Machine Builders
 */
export interface MachineFeatureContract {
  /** Strongly-typed inputs passed from a parent machine or `each()` item mapper. */
  readonly inputs?: Record<string, any>;
  /** Event payload map (`{ EVENT_NAME: PayloadType | void }`). */
  readonly events?: Record<string, any>;
  /** Named intermediate or terminal outputs emitted to parent machines. */
  readonly outputs?: Record<string, any>;
  /** Union of allowed state string literals. */
  readonly states?: string;
  /** Optional method interface contract enforced on `methods`. */
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

export type ResolveValidatedMethods<TMethods> =
  [0] extends [1 & TMethods] ? EmptyObject : TMethods;

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

export type FeatureInlineStore<
  TContext extends object,
  TStates extends string = string,
  TEvents extends Record<string, any> = Record<string, any>,
> = WritableStateSource<TContext> &
  DeepSignalOf<TContext> & {
    readonly state: Signal<TStates>;
    readonly fsmState: Signal<TStates>;
    readonly stateEpoch: Signal<number>;
    readonly fsmSubState: Signal<string | null>;
    readonly fsmSubContext: Signal<Readonly<Record<string, any>> | null>;
    readonly fsmContext: DeepSignalOf<TContext>;
    readonly isPending: Signal<boolean>;
    readonly isDone: Signal<boolean>;
    readonly finalOutcome: Signal<string | null>;
    readonly finalPayload: Signal<unknown>;
    readonly patchContext: (patch: Partial<TContext>) => void;
    readonly send: (
      event: Extract<keyof TEvents, string> | (string & {}),
      payload?: any,
    ) => void;
  } & Record<string, any>;

export type MachineFeatureConfig<
  TId extends string,
  TInitial extends InitialStateTarget<TDeclaredStates>,
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
    TInputs & TState
  >[],
  TValidatedMethods = ResolveValidatedMethods<NoInfer<TMethods>>,
> = {
  readonly id: TId;
  readonly initial: TInitial;
  readonly transitions: TTransitions &
    ValidateTransitionRows<
      TTransitions,
      NoInfer<TInputs & TState>,
      Extract<keyof TEvents, string>,
      TValidatedMethods,
      TOutputs,
      TEvents,
      ResolveInitialStateKey<TInitial>
    >;
  readonly state?: TState;
  readonly syncContext?:
    | (() => SyncContextMap<NoInfer<TInputs & TState>>)
    | SyncContextMap<NoInfer<TInputs & TState>>;
  readonly methods?:
    | ((
        store: FeatureInlineStore<
          NoInfer<TInputs & TState>,
          TDeclaredStates,
          TEvents
        >,
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

/**
 * Internal runtime builder shared by {@link createMachineFeature} and `createEffectMachineFeature`.
 *
 * @internal
 */
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
    (
      injector,
      initialOverride,
      onNotifyParent,
      onEmitOutput,
      onTrackPromise,
    ) =>
      createScopedMachineRunner(
        fsm,
        featureRuntimeConfig,
        injector,
        initialOverride,
        undefined,
        onNotifyParent,
        onEmitOutput,
        undefined,
        onTrackPromise,
      ),
  );

  return fsm;
}

/**
 * Canonical "Sandwich Pattern" machine builder combining:
 * 1. **Public Contract** (`inputs`, `events`, `outputs`, `states`) at the top,
 * 2. **Pure 2D Transition Matrix** (`id`, `initial`, `transitions`) in the middle (`0%` DI), and
 * 3. **Encapsulated Runtime** (`state`, `syncContext`, `methods`, `onEnter`, `onExit`) at the bottom.
 *
 * @group Machine Builders
 * @typeParam TContract - Optional {@link MachineFeatureContract} declaring public inputs, events, outputs, and states.
 * @returns Curried builder returning a {@link MachineFeatureDefinition} usable both as a root SignalStore feature and as an isolated sub-actor.
 *
 * @example
 * ```ts
 * import { inject } from '@angular/core';
 * import { patchState } from '@ngrx/signals';
 * import { awaiting, createMachineFeature, finalState } from '@matrix-fsm/angular';
 * import { CoffeeShopApiService } from './coffee-shop-api.service';
 *
 * export const baristaFSM = createMachineFeature<{
 *   inputs: { selectedDrink: { id: string; name: string } };
 *   events: { START_BREWING: void; RETRY_BREW: void };
 *   outputs: { COFFEE_READY: { drinkName: string } };
 *   states: 'ticketQueued' | 'brewingCoffee' | 'maintenance';
 * }>()({
 *   id: 'barista',
 *   initial: 'ticketQueued',
 *   transitions: [
 *     ['ticketQueued',  'START_BREWING', awaiting('brewingCoffee'), { call: (m) => m._brewCoffee }],
 *     ['brewingCoffee', 'DONE',          finalState(),              { output: ['COFFEE_READY', (ctx) => ({ drinkName: ctx.selectedDrink.name })] }],
 *     ['brewingCoffee', 'ERROR',         'maintenance',             { call: (m) => m._setBrewError }],
 *     ['maintenance',   'RETRY_BREW',    awaiting('brewingCoffee'), { call: (m) => m._brewCoffee }],
 *   ],
 *   state: { brewError: null as string | null },
 *   methods: (store, api = inject(CoffeeShopApiService)) => ({
 *     _brewCoffee: (_p: void, signal: AbortSignal, ctx) => api.brewCoffee(ctx.selectedDrink, signal),
 *     _setBrewError: (err: Error) => patchState(store, { brewError: err.message }),
 *   }),
 * });
 * ```
 */
export function createMachineFeature<
  TContract extends MachineFeatureContract = EmptyObject,
>(): <
  const TId extends string,
  const TInitial extends InitialStateTarget<FeatureStates<TContract>>,
  const TTransitions extends readonly TransitionRow<
    FeatureInputs<TContract> & TState,
    Extract<keyof FeatureEvents<TContract>, string>,
    FeatureStates<TContract>,
    FeatureMethods<TContract>,
    FeatureOutputs<TContract>,
    FeatureInputs<TContract> & TState
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
  > &
    ValidateContractKeys<TContract, keyof MachineFeatureContract>,
) => MachineFeatureDefinition<
  TId,
  ResolveInitialStateKey<TInitial>,
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

/**
 * Configuration options for {@link createFeatureTester}.
 *
 * @group Testing
 */
export interface FeatureTesterOptions<TFSM extends AnyFSMDefinition> {
  /** Mocked `inputs` passed into the machine feature. */
  readonly inputs?: Partial<ExtractInput<TFSM>> & Record<string, any>;
  /** Partial initial `state` overrides merged after `inputs` and `syncedContext`. */
  readonly stateOverride?: Partial<ExtractContext<TFSM>> & Record<string, any>;
  /** Initial values simulating `syncContext` external signal inputs. */
  readonly syncedContext?: Partial<ExtractContext<TFSM>> & Record<string, any>;
  /** Optional Angular `Injector` when testing features that invoke `inject()` in `methods`. */
  readonly injector?: Injector;
  /** Optional debug logger override. */
  readonly debug?: DebugLogger;
  /** Optional transition inspection callback. */
  readonly inspect?: InspectCallback<TFSM>;
  /** Partial method overrides (for example, mocking async API calls in unit tests). */
  readonly methods?:
    | ((
        store: InlineStoreFor<TFSM>,
      ) => Partial<ExtractMethods<TFSM>> & Record<string, (...args: any[]) => any>)
    | (Partial<ExtractMethods<TFSM>> & Record<string, (...args: any[]) => any>);
  /** Optional method overrides keyed by child actor ID or alias. */
  readonly actorMethods?: Record<
    string,
    | ((store: any) => Record<string, (...args: any[]) => any>)
    | Record<string, (...args: any[]) => any>
    | undefined
  >;
}

/**
 * Lightweight unit-test harness returned by {@link createFeatureTester}.
 *
 * @group Testing
 */
export interface FeatureTester<TFSM extends AnyFSMDefinition> {
  /** Current active state name. */
  readonly state: () => ExtractStates<TFSM>;
  /** Active child state name if inside a sub-machine, otherwise `null`. */
  readonly subState: () => string | null;
  /** Active child context if inside a sub-machine, otherwise `null`. */
  readonly subContext: () => Readonly<Record<string, any>> | null;
  /** Current read-only machine context. */
  readonly context: () => Readonly<ExtractContext<TFSM>>;
  /** Live child actor signals keyed by actor ID or alias. */
  readonly actors: ActorsMapFor<TFSM>;
  /** Live snapshots of active `each()` and combinator child pools. */
  readonly childMachines: () => Record<
    string,
    ReadonlyArray<ChildMachineSnapshot>
  >;
  /** Purely checks whether `event` would match a transition in the current state. */
  readonly can: CanFn<TFSM>;
  /** Dispatches an event into the Run-to-Completion FIFO queue. */
  readonly send: SendFn<TFSM>;
  /** Sends an event directly to a child instance inside an active `each()` pool. */
  readonly sendToChild: SendToChildFn<TFSM>;
  /** `true` while inside an `awaiting()` state or active pending child actor. */
  readonly isPending: () => boolean;
  /** Alias for {@link FeatureTester.isDone}. */
  readonly isCompleted: () => boolean;
  /** `true` once the machine reaches `finalState()`. */
  readonly isDone: () => boolean;
  /** Terminal outcome name or `null`. */
  readonly finalOutcome: () => string | null;
  /** Terminal payload captured at `finalState()`. */
  readonly finalPayload: () => unknown;
  /** Chronological array of all intermediate and terminal `{ type, payload }` outputs emitted so far. */
  readonly emittedOutputs: () => ReadonlyArray<{
    readonly type: string;
    readonly payload: unknown;
  }>;
  /** Awaits all currently tracked in-flight `awaiting()` promises, Observables, and Effect fibers. */
  readonly flushTasks: () => Promise<void>;
  /** Partially updates context during tests (also simulating `syncContext` updates). */
  readonly patchContext: (patch: Partial<ExtractContext<TFSM>>) => void;
  /** Captures a serializable snapshot. */
  readonly getSnapshot: () => MachineSnapshot<TFSM>;
  /** Restores a previously captured snapshot. */
  readonly restoreSnapshot: (snapshot: MachineSnapshot<TFSM>) => void;
  /** Subscribes to snapshot updates. */
  readonly subscribe: (
    listenerOrObserver:
      | ((snapshot: MachineSnapshot<TFSM>) => void)
      | MachineObserver<TFSM>,
  ) => MachineSubscription;
  /** Resets the tester back to `initial`. */
  readonly reset: (initialOverride?: Partial<ExtractContext<TFSM>>) => void;
  /** Tears down all active timers, tasks, and child actors. */
  readonly destroy: () => void;
}

/**
 * Instantiates a {@link createMachineFeature}, `createEffectMachineFeature`, or `createFSM`
 * in pure Vitest/Node unit tests (`< 5ms`, zero Angular `TestBed`), mocking `inputs` and `methods` directly.
 *
 * @group Testing
 * @param feature - Machine feature or pure FSM definition under test.
 * @param options - Optional mocked `inputs`, `methods`, `stateOverride`, and `actorMethods`.
 * @returns A {@link FeatureTester} with `send()`, `flushTasks()`, `emittedOutputs()`, and `finalPayload()`.
 *
 * @example
 * ```ts
 * import { createFeatureTester } from '@matrix-fsm/angular';
 * import { baristaFSM } from './barista.feature';
 *
 * const tester = createFeatureTester(baristaFSM, {
 *   inputs: { selectedDrink: { id: 'espresso', name: 'Double Espresso' } },
 *   methods: { _brewCoffee: async () => 'crema' },
 * });
 *
 * tester.send('START_BREWING');
 * await tester.flushTasks();
 * console.log(tester.isDone(), tester.emittedOutputs());
 * ```
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

  const runnerBox: {
    current?: ReturnType<typeof createScopedMachineRunner<TFSM>>;
  } = {};
  const checkAndRecordTerminal = (
    r: ReturnType<typeof createScopedMachineRunner<TFSM>> | undefined,
  ) => {
    if (!r || recordedTerminal || !r.isDone()) {
      return;
    }
    recordedTerminal = true;
    const outcome = r.finalOutcome();
    if (outcome) {
      emittedOutputsList.push({
        type: outcome,
        payload: r.hasFinalPayloadSelector() ? r.finalPayload() : undefined,
      });
    }
  };

  const runner = createScopedMachineRunner<TFSM>(
    feature,
    testerConfig,
    testerInjector,
    initialCombined,
    undefined,
    () => {
      checkAndRecordTerminal(runnerBox.current);
    },
    (output) => {
      emittedOutputsList.push(output);
    },
    options?.actorMethods,
    trackPromise,
  );
  runnerBox.current = runner;
  checkAndRecordTerminal(runner);

  const flushTasks = async (): Promise<void> => {
    let safety = 0;
    while (safety < 50) {
      safety++;
      if (inFlightPromises.size > 0) {
        await Promise.allSettled([...inFlightPromises]);
        await Promise.resolve();
        continue;
      }
      await Promise.resolve();
      if (inFlightPromises.size === 0) {
        break;
      }
    }
  };

  return {
    state: () => runner.fsmState(),
    subState: () => runner.fsmSubState(),
    subContext: () => runner.fsmSubContext(),
    context: () => runner.fsmContext() as Readonly<ExtractContext<TFSM>>,
    actors: runner.actors,
    childMachines: () => runner.childMachines(),
    can: runner.can,
    send: runner.send,
    sendToChild: runner.sendToChild,
    isPending: () => runner.isPending(),
    isCompleted: () => runner.isDone(),
    isDone: () => runner.isDone(),
    finalOutcome: () => runner.finalOutcome(),
    finalPayload: () => runner.finalPayload(),
    emittedOutputs: () => [...emittedOutputsList],
    flushTasks,
    patchContext: runner.patchContext,
    getSnapshot: runner.getSnapshot,
    restoreSnapshot: (snapshot) => {
      runner.restoreSnapshot(snapshot);
      recordedTerminal = runner.isDone();
    },
    subscribe: runner.subscribe,
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
