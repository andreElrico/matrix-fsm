/**
 * @matrix-fsm/core - Pure TypeScript Machine Runner (0% Angular)
 */

import { resolveSourceIds, sourceIncludesAnyState } from './fsm.js';
import {
  isAfterNode,
  isEveryNode,
  isOutcomeNode,
  MAX_SYNC_MICROSTEPS,
  MatrixFsmInfiniteLoopError,
  singularizeEachKey,
} from './primitives.js';
import type {
  AnyFSMDefinition,
  BuiltInLifecycleEvent,
  CanFn,
  CombinatorNode,
  EachNode,
  EveryNode,
  ExtractContext,
  ExtractMethods,
  ExtractStates,
  SendFn,
  SendToChildFn,
  SubMachineRef,
  SubscribableLike,
  TransitionCallSelector,
} from './types.js';

export interface CombinatorSnapshotProgress {
  readonly settledIndices: readonly number[];
  readonly completedOutputs: Readonly<Record<string, unknown>>;
  readonly orderedOutputs: readonly unknown[];
  readonly failedIndices: readonly number[];
  readonly failedErrors: readonly unknown[];
}

export interface MachineSnapshot<TFSM extends AnyFSMDefinition = AnyFSMDefinition> {
  readonly state: ExtractStates<TFSM>;
  readonly context: Readonly<ExtractContext<TFSM>>;
  readonly stateEpoch: number;
  readonly doneOutcome?: string | null;
  readonly finalPayload?: unknown;
  readonly hasFinalPayloadSelector?: boolean;
  readonly children?: Readonly<Record<string, MachineSnapshot<any>>>;
  readonly combinatorProgress?: CombinatorSnapshotProgress;
}

export interface ChildMachineEntry<TContext = Record<string, unknown>> {
  readonly id: string;
  readonly state: string;
  readonly subState?: string | null;
  readonly context: Readonly<TContext>;
  readonly isPending: boolean;
  readonly isDone: boolean;
  readonly finalOutcome: string | null;
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

export interface TaskExecutionCallbacks {
  readonly onSuccess: (output: unknown) => void;
  readonly onFailure: (error: unknown) => void;
  readonly isCancelled: () => boolean;
  readonly signal: AbortSignal;
}

/**
 * Pluggable async task execution adapter (e.g., Effect-TS Fibers, custom streams).
 */
export interface CustomTaskAdapter {
  canHandle?(result: unknown): boolean;
  execute(
    result: unknown,
    callbacks: TaskExecutionCallbacks,
  ): (() => void) | void;
}

export interface MachineObserver<TFSM extends AnyFSMDefinition = AnyFSMDefinition> {
  readonly next?: (snapshot: MachineSnapshot<TFSM>) => void;
  readonly error?: (err: unknown) => void;
  readonly complete?: () => void;
}

export type SnapshotListener<TFSM extends AnyFSMDefinition = AnyFSMDefinition> =
  | ((snapshot: MachineSnapshot<TFSM>) => void)
  | MachineObserver<TFSM>;

export type MachineSubscription = (() => void) & {
  unsubscribe(): void;
};

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
  readonly finalPayload: () => unknown;
  readonly hasFinalPayloadSelector?: () => boolean;
  readonly hasActiveTransition?: (event: string) => boolean;
  readonly childMachines: () => Readonly<
    Record<string, ReadonlyArray<ChildMachineEntry>>
  >;
  readonly can: CanFn<TFSM, BuiltInLifecycleEvent>;
  readonly send: SendFn<TFSM, BuiltInLifecycleEvent>;
  readonly sendToChild: SendToChildFn<TFSM, BuiltInLifecycleEvent>;
  readonly patchContext: (patch: Partial<ExtractContext<TFSM>>) => void;
  readonly subscribe: (listener: SnapshotListener<TFSM>) => MachineSubscription;
  readonly getSnapshot: () => MachineSnapshot<TFSM>;
  readonly restoreSnapshot: (snapshot: MachineSnapshot<TFSM>) => void;
  readonly reset: (initialOverride?: Partial<ExtractContext<TFSM>>) => void;
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

export interface MachineStateChangeInfo {
  stayed: boolean;
  isPending: boolean;
  isDone: boolean;
  finalOutcome: string | null;
  finalPayload?: unknown;
  hasFinalPayloadSelector?: boolean;
  emittedOutput?: { readonly type: string; readonly payload: unknown } | null;
  enteredSubMachine: SubMachineRef<any, any> | null;
  exitedSubMachine: SubMachineRef<any, any> | null;
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
  readonly methods?: Partial<ExtractMethods<TFSM>> &
    Record<string, (...args: any[]) => any>;
  /**
   * Optional dynamic context provider (e.g., SignalStore's live state getter).
   */
  readonly getContext?: () => ExtractContext<TFSM>;
  /**
   * Optional pluggable async task runner adapter.
   */
  readonly taskAdapter?: CustomTaskAdapter;
  /**
   * Optional callback invoked with a settlement promise whenever an async awaiting task starts.
   */
  readonly onTaskTrack?: (promise: Promise<unknown>) => void;
  /**
   * Optional callback invoked when an awaiting() task rejects and no local ERROR transition matches.
   */
  readonly onError?: (error: unknown, state: string) => void;
  /**
   * Internal flag used during snapshot restoration so initial timers/tasks/always() do not fire prematurely.
   */
  readonly skipInitialEffects?: boolean;
  readonly onStateChange?: (
    state: ExtractStates<TFSM>,
    context: Readonly<ExtractContext<TFSM>>,
    info: MachineStateChangeInfo,
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

export function extractEachItemId(
  item: unknown,
  index: number,
  usedIds: Set<string>,
): string {
  let rawId: string;
  if (typeof item === 'string' || typeof item === 'number') {
    rawId = String(item);
  } else if (
    typeof item === 'object' &&
    item !== null &&
    'id' in item &&
    (typeof (item as { id: unknown }).id === 'string' ||
      typeof (item as { id: unknown }).id === 'number')
  ) {
    rawId = String((item as { id: string | number }).id);
  } else {
    rawId = String(index);
  }
  const uniqueId = usedIds.has(rawId) ? `${rawId}:${index}` : rawId;
  usedIds.add(uniqueId);
  return uniqueId;
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
  let lastTaskSettledEpoch = -1;
  let currentContext: TContext = {
    ...fsm.context,
    ...(hooks?.context ?? {}),
    ...(hooks?.initialContext ?? {}),
  };
  let patchedOverlay: Partial<TContext> | null = null;
  let activeSubMachine: MachineInstance<any> | null = null;
  let activeSubRef: SubMachineRef<any, any> | null = null;
  let activeCombinator: {
    readonly node: CombinatorNode<any, any>;
    readonly actorRefs: readonly SubMachineRef<any, any>[];
    readonly instances: Array<MachineInstance<any> | null>;
    readonly childSettled: boolean[];
    readonly completedOutputs: Record<string, unknown>;
    readonly orderedOutputs: unknown[];
    readonly failedIndices: Set<number>;
    readonly failedErrors: unknown[];
  } | null = null;
  let activeEachPool: {
    readonly node: EachNode<any, any, any>;
    readonly instances: Map<string, MachineInstance<any>>;
    readonly orderedIds: string[];
    readonly results: Map<string, unknown>;
  } | null = null;
  const settledEachPools = new Map<
    string,
    ReadonlyArray<ChildMachineEntry>
  >();
  let doneOutcome: string | null = null;
  let donePayload: unknown = undefined;
  let doneHasFinalSelector = false;
  const activeAwaitingSelectors = new Map<
    string,
    TransitionCallSelector<any, any, TContext>
  >();
  const subscribers = new Set<(snapshot: MachineSnapshot<TFSM>) => void>();

  const eventQueue: Array<{
    event: string;
    payload: unknown;
    fromChildOutput: boolean;
    fromChildTerminal: boolean;
    sourceStateOverride?: string;
  }> = [];
  let isProcessing = false;
  let inTransitionCall = false;
  let isDestroyed = false;
  const activeTimers: Array<ReturnType<typeof setTimeout>> = [];
  const activeEveryTimers = new Map<
    string,
    {
      timerId: ReturnType<typeof setTimeout> | null;
      currentDelay: number;
      via: EveryNode<any>;
    }
  >();
  let activeTask: {
    readonly stateName: string;
    readonly entryEpoch: number;
    cancelled: boolean;
    readonly abortController: AbortController;
    teardown: (() => void) | null;
  } | null = null;
  const debugLog = resolveDebugLogger(hooks?.debug);

  const notifySubscribers = (): void => {
    if (subscribers.size === 0 || isDestroyed) {
      return;
    }
    const snap = getSnapshot();
    for (const sub of [...subscribers]) {
      sub(snap);
    }
  };

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

  const destroyActiveCombinator = (): void => {
    if (!activeCombinator) {
      return;
    }
    const combToDestroy = activeCombinator;
    activeCombinator = null;
    for (const inst of combToDestroy.instances) {
      inst?.destroy();
    }
  };

  const snapshotPoolEntries = (
    pool: NonNullable<typeof activeEachPool>,
  ): ReadonlyArray<ChildMachineEntry> =>
    pool.orderedIds
      .map((id) => {
        const inst = pool.instances.get(id);
        if (!inst) {
          return null;
        }
        return {
          id,
          state: inst.state(),
          subState: inst.subState(),
          context: inst.context() as Readonly<Record<string, unknown>>,
          isPending: inst.isPending(),
          isDone: inst.isDone(),
          finalOutcome: inst.finalOutcome(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

  const destroyActiveEachPool = (preserveSettledSnapshot = false): void => {
    if (!activeEachPool) {
      return;
    }
    const poolToDestroy = activeEachPool;
    if (preserveSettledSnapshot) {
      settledEachPools.set(
        poolToDestroy.node.key,
        snapshotPoolEntries(poolToDestroy),
      );
    } else {
      settledEachPools.delete(poolToDestroy.node.key);
    }
    activeEachPool = null;
    for (const inst of poolToDestroy.instances.values()) {
      inst.destroy();
    }
  };

  const readEffectiveContext = (): TContext => {
    if (hooks?.getContext) {
      const base = hooks.getContext();
      return patchedOverlay ? { ...base, ...patchedOverlay } : base;
    }
    return currentContext;
  };

  const scheduleOrUpdateEveryTimer = (
    stateName: string,
    entryEpoch: number,
    via: EveryNode<any>,
    forceReschedule: boolean,
  ): void => {
    const rawMs =
      typeof via.ms === 'function' ? via.ms(readEffectiveContext()) : via.ms;
    const isValidPositive =
      typeof rawMs === 'number' && Number.isFinite(rawMs) && rawMs > 0;
    if (!isValidPositive) {
      debugLog?.(
        `[MatrixFSM:${fsm.id}] Warning: every() timer in state '${stateName}' evaluated to invalid interval (${String(rawMs)}ms); timer will not fire until interval > 0.`,
      );
    }
    const delay = isValidPositive ? rawMs : 0;
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
        currentState === stateName
      ) {
        sendInternal(via.id, undefined, false, false);
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
              ? viaItem.ms(readEffectiveContext())
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
                currentState === stateName
              ) {
                sendInternal(viaItem.id, undefined, false, false);
              }
            }, rawMs);
            activeTimers.push(timerId);
          } else {
            debugLog?.(
              `[MatrixFSM:${fsm.id}] Warning: after() timer in state '${stateName}' evaluated to invalid delay (${String(rawMs)}ms); timer ignored.`,
            );
          }
        } else if (isEveryNode(viaItem) && !scheduledIds.has(viaItem.id)) {
          scheduledIds.add(viaItem.id);
          scheduleOrUpdateEveryTimer(stateName, entryEpoch, viaItem, true);
        }
      }
    }
  };

  const filterChildHooks = <T extends Record<string, any> | undefined>(
    hookMap: T,
  ): T => {
    if (!hookMap) {
      return undefined as unknown as T;
    }
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(hookMap)) {
      if (!fsm.states.has(k)) {
        filtered[k] = v;
      }
    }
    return filtered as T;
  };

  const isPending = (): boolean => {
    if (activeSubMachine) {
      return activeSubMachine.isPending();
    }
    if (activeCombinator) {
      return activeCombinator.instances.some((inst) =>
        Boolean(inst?.isPending()),
      );
    }
    if (activeEachPool) {
      return [...activeEachPool.instances.values()].some((inst) =>
        inst.isPending(),
      );
    }
    if (activeTask !== null) {
      return true;
    }
    if (lastTaskSettledEpoch === stateEpoch) {
      return false;
    }
    return fsm.awaitingStates.has(currentState);
  };

  const isDone = (): boolean => doneOutcome !== null;

  const hasActiveTransition = (event: string): boolean => {
    if (activeSubMachine) {
      if (activeSubMachine.hasActiveTransition?.(event)) {
        return true;
      }
    }
    if (
      activeCombinator &&
      !fsm.hasTransitionFor(activeCombinator.node.id, event, { exact: true })
    ) {
      if (
        activeCombinator.instances.some(
          (inst) =>
            inst !== null &&
            !inst.isDone() &&
            Boolean(inst.hasActiveTransition?.(event)),
        )
      ) {
        return true;
      }
    }
    if (
      activeEachPool &&
      !fsm.hasTransitionFor(activeEachPool.node.id, event, { exact: true })
    ) {
      if (
        [...activeEachPool.instances.values()].some(
          (inst) =>
            !inst.isDone() && Boolean(inst.hasActiveTransition?.(event)),
        )
      ) {
        return true;
      }
    }
    return fsm.hasTransitionFor(currentState, event);
  };

  const enterSubMachineIfNeeded = (
    subRef: SubMachineRef<any, any> | null,
    inputMapped?: Record<string, unknown> | null,
    skipChildInitialEffects = false,
  ) => {
    if (!subRef) {
      return;
    }
    activeSubRef = subRef;
    let settledDuringSpawn = false;
    let spawnedInstance: MachineInstance<any> | null = null;

    const handleChildDone = (
      outcome: string,
      outputPayload: unknown,
    ): void => {
      if (settledDuringSpawn) {
        return;
      }
      settledDuringSpawn = true;
      const refToExit = activeSubRef;
      const subToDestroy = activeSubMachine ?? spawnedInstance;
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
    };

    spawnedInstance = createMachineInstance(subRef.machine, {
      initialContext: {
        ...readEffectiveContext(),
        ...(inputMapped ?? {}),
      },
      methods: hooks?.methods,
      debug: hooks?.debug,
      taskAdapter: hooks?.taskAdapter,
      onTaskTrack: hooks?.onTaskTrack,
      skipInitialEffects: skipChildInitialEffects,
      onEnter: filterChildHooks(hooks?.onEnter) as any,
      onExit: filterChildHooks(hooks?.onExit) as any,
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
          handleChildDone(outcome, outputPayload);
        }
      },
    });

    if (!settledDuringSpawn && activeSubRef === subRef) {
      activeSubMachine = spawnedInstance;
      if (spawnedInstance.isDone()) {
        const outcome = spawnedInstance.finalOutcome() ?? 'DONE';
        const hasSel = Boolean(spawnedInstance.hasFinalPayloadSelector?.());
        const outputPayload = hasSel
          ? spawnedInstance.finalPayload()
          : spawnedInstance.context();
        handleChildDone(outcome, outputPayload);
      }
    } else if (settledDuringSpawn) {
      spawnedInstance.destroy();
    }
  };

  const resolveCombinatorActorRefs = (
    combNode: CombinatorNode<any, any>,
  ): readonly SubMachineRef<any, any>[] =>
    combNode.actorRefs ??
    combNode.machines.map((m: AnyFSMDefinition) => ({
      __type: 'subMachine' as const,
      id: m.id,
      machine: m,
    }));

  const enterCombinatorIfNeeded = (
    combNode: CombinatorNode<any, any> | null | undefined,
    inputMapped?: Record<string, unknown> | null,
    skipChildInitialEffects = false,
    restoredProgress?: CombinatorSnapshotProgress,
  ) => {
    if (!combNode) {
      return;
    }
    destroyActiveCombinator();
    const actorRefs = resolveCombinatorActorRefs(combNode);
    const totalActors = actorRefs.length;
    const instances = new Array<MachineInstance<any> | null>(totalActors).fill(
      null,
    );
    const childSettled = new Array<boolean>(totalActors).fill(false);
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
    if (restoredProgress?.settledIndices) {
      for (const idx of restoredProgress.settledIndices) {
        if (idx >= 0 && idx < totalActors) {
          childSettled[idx] = true;
        }
      }
    }

    const activeCombState = {
      node: combNode,
      actorRefs,
      instances,
      childSettled,
      completedOutputs,
      orderedOutputs,
      failedIndices,
      failedErrors,
    };
    activeCombinator = activeCombState;
    let spawnCompleted = false;

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

    const checkAllCompletion = (): void => {
      if (
        activeCombinator === activeCombState &&
        spawnCompleted &&
        childSettled.every(Boolean)
      ) {
        const combId = combNode.id;
        if (fsm.hasTransitionFor(combId, 'ALL_DONE')) {
          dispatchCombinatorExit('ALL_DONE', { ...completedOutputs });
        } else {
          dispatchCombinatorExit('DONE', orderedOutputs);
        }
      }
    };

    const isActorKeyedInput = Boolean(
      inputMapped &&
        typeof inputMapped === 'object' &&
        actorRefs.some(
          (ref) =>
            ref.id in inputMapped &&
            typeof inputMapped[ref.id] === 'object' &&
            inputMapped[ref.id] !== null,
        ),
    );

    const settleActorAtIndex = (
      idx: number,
      actorId: string,
      outcome: string,
      childPayload: unknown,
      childRefInstance: MachineInstance<any> | null,
    ): void => {
      if (activeCombinator !== activeCombState || childSettled[idx]) {
        return;
      }
      childSettled[idx] = true;
      const instToDestroy = instances[idx] ?? childRefInstance;
      instances[idx] = null;
      instToDestroy?.destroy();

      if (combNode.__type === 'all') {
        completedOutputs[actorId] = childPayload;
        orderedOutputs[idx] = childPayload;

        if (fsm.hasTransitionFor(actorId, outcome, { exact: true })) {
          sendInternal(outcome, childPayload, true, false, actorId);
          if (activeCombinator !== activeCombState) {
            return;
          }
        } else if (outcome === 'ERROR') {
          dispatchCombinatorExit('ERROR', childPayload);
          return;
        }

        checkAllCompletion();
      } else if (combNode.__type === 'race') {
        if (fsm.hasTransitionFor(actorId, outcome, { exact: true })) {
          destroyActiveCombinator();
          sendInternal(outcome, childPayload, true, true, actorId);
          return;
        }
        dispatchCombinatorExit(outcome, childPayload);
      } else if (combNode.__type === 'any') {
        if (outcome === 'ERROR') {
          failedIndices.add(idx);
          failedErrors[idx] = childPayload;
          if (failedIndices.size === totalActors) {
            dispatchCombinatorExit('ERROR', failedErrors);
          }
        } else {
          if (fsm.hasTransitionFor(actorId, outcome, { exact: true })) {
            destroyActiveCombinator();
            sendInternal(outcome, childPayload, true, true, actorId);
            return;
          }
          dispatchCombinatorExit(outcome, childPayload);
        }
      }
    };

    actorRefs.forEach((actorRef, idx) => {
      if (activeCombinator !== activeCombState || childSettled[idx]) {
        return;
      }
      const actorId = actorRef.id;
      const childMachine = actorRef.machine;
      const keyedChildInput =
        inputMapped &&
        typeof inputMapped === 'object' &&
        actorId in inputMapped &&
        typeof inputMapped[actorId] === 'object' &&
        inputMapped[actorId] !== null
          ? (inputMapped[actorId] as Record<string, unknown>)
          : null;

      let localChildRef: MachineInstance<any> | null = null;
      const childInst = createMachineInstance(childMachine, {
        initialContext: {
          ...readEffectiveContext(),
          ...(isActorKeyedInput
            ? (keyedChildInput ?? {})
            : { ...(inputMapped ?? {}), ...(keyedChildInput ?? {}) }),
        },
        methods: hooks?.methods,
        debug: hooks?.debug,
        taskAdapter: hooks?.taskAdapter,
        onTaskTrack: hooks?.onTaskTrack,
        skipInitialEffects: skipChildInitialEffects,
        onEnter: filterChildHooks(hooks?.onEnter) as any,
        onExit: filterChildHooks(hooks?.onExit) as any,
        onStateChange: (_childState, childCtx, childInfo) => {
          if (activeCombinator !== activeCombState) {
            return;
          }
          if (!childInfo.isDone && childInfo.emittedOutput) {
            const outType = childInfo.emittedOutput.type;
            const outPayload = childInfo.emittedOutput.payload;
            if (
              fsm.hasTransitionFor(actorId, outType, { exact: true }) ||
              fsm.hasTransitionFor(combNode.id, outType)
            ) {
              sendInternal(
                outType,
                outPayload,
                true,
                false,
                fsm.hasTransitionFor(actorId, outType, { exact: true })
                  ? actorId
                  : undefined,
              );
            }
          }
          if (!childInfo.isDone || childSettled[idx]) {
            return;
          }
          const outcome = childInfo.finalOutcome ?? 'DONE';
          const childPayload = childInfo.hasFinalPayloadSelector
            ? childInfo.finalPayload
            : childCtx;
          settleActorAtIndex(
            idx,
            actorId,
            outcome,
            childPayload,
            localChildRef,
          );
        },
      });
      localChildRef = childInst;

      if (activeCombinator !== activeCombState || childSettled[idx]) {
        childInst.destroy();
        return;
      }
      instances[idx] = childInst;
      if (childInst.isDone()) {
        const outcome = childInst.finalOutcome() ?? 'DONE';
        const hasSel = Boolean(childInst.hasFinalPayloadSelector?.());
        const childPayload = hasSel
          ? childInst.finalPayload()
          : childInst.context();
        settleActorAtIndex(idx, actorId, outcome, childPayload, childInst);
      }
    });

    spawnCompleted = true;
    if (!skipChildInitialEffects && combNode.__type === 'all') {
      checkAllCompletion();
    }
  };

  const enterEachIfNeeded = (
    eachNode: EachNode<any, any, any> | null | undefined,
    inputMapped?: Record<string, unknown> | null,
    skipChildInitialEffects = false,
  ) => {
    if (!eachNode) {
      return;
    }
    destroyActiveEachPool(false);
    const key = eachNode.key;
    settledEachPools.delete(key);
    const ctx = readEffectiveContext() as Record<string, unknown>;
    const rawArray = Array.isArray(ctx[key]) ? (ctx[key] as unknown[]) : [];

    if (rawArray.length === 0) {
      settledEachPools.set(key, []);
      if (!skipChildInitialEffects) {
        if (fsm.hasTransitionFor(eachNode.id, 'ALL_DONE')) {
          sendInternal('ALL_DONE', [], true, true);
        } else if (fsm.hasTransitionFor(eachNode.id, 'DONE')) {
          sendInternal('DONE', [], true, true);
        }
      }
      return;
    }

    const instances = new Map<string, MachineInstance<any>>();
    const orderedIds: string[] = [];
    const usedIds = new Set<string>();
    const results = new Map<string, unknown>();
    const poolState = {
      node: eachNode,
      instances,
      orderedIds,
      results,
    };
    activeEachPool = poolState;
    let spawnFinished = false;

    const singularKey = singularizeEachKey(key);

    const checkPoolCompletion = () => {
      if (activeEachPool !== poolState || !spawnFinished) {
        return;
      }
      if (
        instances.size === orderedIds.length &&
        [...instances.values()].every((inst) => inst.isDone())
      ) {
        const orderedResults = orderedIds.map((id) => results.get(id));
        destroyActiveEachPool(true);
        if (fsm.hasTransitionFor(eachNode.id, 'ALL_DONE')) {
          sendInternal('ALL_DONE', orderedResults, true, true);
        } else if (fsm.hasTransitionFor(eachNode.id, 'DONE')) {
          sendInternal('DONE', orderedResults, true, true);
        }
      }
    };

    rawArray.forEach((item, index) => {
      if (activeEachPool !== poolState) {
        return;
      }
      const id = extractEachItemId(item, index, usedIds);
      orderedIds.push(id);

      const mappedFromEach =
        typeof eachNode.itemInputMapper === 'function'
          ? eachNode.itemInputMapper(item, index, ctx)
          : null;

      const itemContext = mappedFromEach
        ? {
            ...ctx,
            item,
            index,
            ...(inputMapped ?? {}),
            ...mappedFromEach,
          }
        : typeof item === 'object' && item !== null
          ? {
              ...ctx,
              ...(singularKey ? { [singularKey]: item } : {}),
              item,
              index,
              ...(inputMapped ?? {}),
              ...(item as Record<string, unknown>),
            }
          : {
              ...ctx,
              ...(singularKey ? { [singularKey]: item } : {}),
              item,
              index,
              ...(inputMapped ?? {}),
              itemId: id,
            };

      const childInst = createMachineInstance(eachNode.machine, {
        initialContext: itemContext,
        methods: hooks?.methods,
        debug: hooks?.debug,
        taskAdapter: hooks?.taskAdapter,
        onTaskTrack: hooks?.onTaskTrack,
        skipInitialEffects: skipChildInitialEffects,
        onEnter: filterChildHooks(hooks?.onEnter) as any,
        onExit: filterChildHooks(hooks?.onExit) as any,
        onStateChange: (_childState, childCtx, childInfo) => {
          if (activeEachPool !== poolState) {
            return;
          }
          if (!childInfo.isDone && childInfo.emittedOutput) {
            const outType = childInfo.emittedOutput.type;
            const outPayload = childInfo.emittedOutput.payload;
            if (fsm.hasTransitionFor(eachNode.id, outType)) {
              sendInternal(outType, outPayload, true, false);
            }
          }
          if (childInfo.isDone) {
            const outcome = childInfo.finalOutcome ?? 'DONE';
            const childPayload = childInfo.hasFinalPayloadSelector
              ? childInfo.finalPayload
              : childCtx;
            if (outcome === 'ERROR') {
              destroyActiveEachPool(false);
              if (fsm.hasTransitionFor(eachNode.id, 'ERROR')) {
                sendInternal('ERROR', childPayload, true, true);
              }
              return;
            }
            results.set(id, childPayload);
            checkPoolCompletion();
          }
        },
      });
      if (activeEachPool !== poolState) {
        childInst.destroy();
        return;
      }
      instances.set(id, childInst);
      if (childInst.isDone()) {
        const hasSel = Boolean(childInst.hasFinalPayloadSelector?.());
        const resolvedPay = hasSel
          ? childInst.finalPayload()
          : childInst.context();
        if (childInst.finalOutcome() === 'ERROR') {
          destroyActiveEachPool(false);
          if (fsm.hasTransitionFor(eachNode.id, 'ERROR')) {
            sendInternal('ERROR', resolvedPay, true, true);
          }
          return;
        }
        results.set(id, resolvedPay);
      }
    });

    spawnFinished = true;
    if (!skipChildInitialEffects) {
      checkPoolCompletion();
    }
  };

  const enqueueAlwaysIfNeeded = (): void => {
    if (isDone() || !fsm.hasTransitionFor(currentState, '__always__')) {
      return;
    }
    if (eventQueue.some((item) => item.event === '__always__')) {
      return;
    }
    eventQueue.unshift({
      event: '__always__',
      payload: undefined,
      fromChildOutput: false,
      fromChildTerminal: false,
    });
  };

  const processOneEvent = (
    event: string,
    payload?: unknown,
    fromChildOutput = false,
    fromChildTerminal = false,
    sourceStateOverride?: string,
  ): void => {
    // 1. Cooperative Cancel / Child Event Priority across unlimited hierarchy depth
    if (!fromChildOutput && activeSubMachine && activeSubRef) {
      if (
        activeSubMachine.hasActiveTransition?.(event) ??
        activeSubRef.machine.hasTransitionFor(activeSubMachine.state(), event)
      ) {
        activeSubMachine.patchContext(readEffectiveContext());
        activeSubMachine.send(event as any, payload as any);
        return;
      }
    }

    if (
      !fromChildOutput &&
      activeCombinator &&
      !fsm.hasTransitionFor(activeCombinator.node.id, event, { exact: true })
    ) {
      let handledByAny = false;
      const combSnap = activeCombinator;
      for (let i = 0; i < combSnap.instances.length; i++) {
        const inst = combSnap.instances[i];
        const childMach = combSnap.actorRefs[i]?.machine;
        if (
          inst &&
          !inst.isDone() &&
          (inst.hasActiveTransition?.(event) ??
            Boolean(childMach?.hasTransitionFor(inst.state(), event)))
        ) {
          handledByAny = true;
          inst.patchContext(readEffectiveContext());
          inst.send(event as any, payload as any);
        }
      }
      if (handledByAny) {
        return;
      }
    }

    if (
      !fromChildOutput &&
      activeEachPool &&
      !fsm.hasTransitionFor(activeEachPool.node.id, event, { exact: true })
    ) {
      let handledByAny = false;
      const poolSnap = activeEachPool;
      const poolChildMach = poolSnap.node.machine;
      for (const inst of poolSnap.instances.values()) {
        if (
          !inst.isDone() &&
          (inst.hasActiveTransition?.(event) ??
            poolChildMach.hasTransitionFor(inst.state(), event))
        ) {
          handledByAny = true;
          inst.send(event as any, payload as any);
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

    if (!evaluation.stayed && activeSubMachine && activeSubRef) {
      const subState = activeSubMachine.state();
      activeSubMachine.destroy();
      activeSubMachine = null;
      activeSubRef = null;
      if (!fsm.states.has(subState)) {
        hooks?.onExit?.[subState]?.(readEffectiveContext());
      }
    }
    if (!evaluation.stayed && activeCombinator) {
      destroyActiveCombinator();
    }
    if (!evaluation.stayed && activeEachPool) {
      destroyActiveEachPool(fromChildTerminal);
    }

    if (!evaluation.stayed) {
      clearActiveTimers();
      cancelActiveTask();
      hooks?.onExit?.[prevState]?.(readEffectiveContext());
      currentState = evaluation.nextState;
      stateEpoch++;
    }

    currentContext = evaluation.nextContext;

    const isEnteringAwaiting = !evaluation.stayed && evaluation.isAwaiting;

    if (evaluation.callSelector && !isEnteringAwaiting) {
      const prevExternalCtx =
        hooks?.getContext && patchedOverlay ? { ...hooks.getContext() } : null;
      inTransitionCall = true;
      try {
        invokeCallSelector(
          evaluation.callSelector,
          hooks?.methods as Record<string, any> | undefined,
          payload,
          readEffectiveContext(),
        );
      } finally {
        inTransitionCall = false;
      }
      if (hooks?.getContext) {
        const nextExternalCtx = hooks.getContext();
        if (prevExternalCtx && patchedOverlay) {
          const nextOverlay = { ...patchedOverlay } as Record<string, unknown>;
          for (const k of Object.keys(nextOverlay)) {
            if (
              (nextExternalCtx as Record<string, unknown>)[k] !==
              (prevExternalCtx as Record<string, unknown>)[k]
            ) {
              delete nextOverlay[k];
            }
          }
          patchedOverlay =
            Object.keys(nextOverlay).length > 0
              ? (nextOverlay as Partial<TContext>)
              : null;
        }
        currentContext = nextExternalCtx;
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
      for (const [everyId, entry] of activeEveryTimers.entries()) {
        scheduleOrUpdateEveryTimer(
          currentState,
          stateEpoch,
          entry.via,
          event === everyId,
        );
      }
      enqueueAlwaysIfNeeded();
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
      notifySubscribers();
      return;
    }

    if (evaluation.finalOutcome !== null) {
      doneOutcome = evaluation.finalOutcome;
      doneHasFinalSelector = Boolean(evaluation.hasFinalPayloadSelector);
      donePayload = doneHasFinalSelector ? resolvedFinalPayload : undefined;
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

    if (evaluation.enteredEach) {
      enterEachIfNeeded(evaluation.enteredEach, resolvedInputMapped);
    }

    hooks?.onEnter?.[currentState]?.(readEffectiveContext());
    scheduleStateTimers(currentState);
    if (isEnteringAwaiting) {
      const resolvedCallSel =
        evaluation.callSelector ??
        fsm.awaitingCallSelectors?.get(currentState) ??
        null;
      if (resolvedCallSel) {
        activeAwaitingSelectors.set(currentState, resolvedCallSel);
      }
      startAwaitingCallIfNeeded(currentState, resolvedCallSel, payload);
    }
    enqueueAlwaysIfNeeded();
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
    notifySubscribers();
  };

  const handleAwaitingSuccess = (
    handle: NonNullable<typeof activeTask>,
    result: unknown,
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
    lastTaskSettledEpoch = handle.entryEpoch;
    if (isOutcomeNode(result)) {
      sendInternal(result.event, result.payload, false, false);
    } else {
      sendInternal('DONE', result, false, false);
    }
  };

  const handleAwaitingFailure = (
    handle: NonNullable<typeof activeTask>,
    err: unknown,
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
    lastTaskSettledEpoch = handle.entryEpoch;
    if (typeof err === 'object' && err !== null) {
      if (
        '_tag' in err &&
        typeof (err as { _tag: unknown })._tag === 'string'
      ) {
        const tag = (err as { _tag: string })._tag;
        if (fsm.hasTransitionFor(currentState, tag)) {
          sendInternal(tag, err, false, false);
          return;
        }
      }
      if (
        'name' in err &&
        typeof (err as { name: unknown }).name === 'string' &&
        (err as { name: string }).name !== 'Error'
      ) {
        const errName = (err as { name: string }).name;
        if (fsm.hasTransitionFor(currentState, errName)) {
          sendInternal(errName, err, false, false);
          return;
        }
      }
    }
    if (!fsm.hasTransitionFor(currentState, 'ERROR')) {
      debugLog?.(
        `[MatrixFSM:${fsm.id}] Unhandled awaiting() error in state '${currentState}'`,
        err,
      );
      hooks?.onError?.(err, currentState);
      if (hooks?.onStateChange) {
        doneOutcome = 'ERROR';
        donePayload = err;
        doneHasFinalSelector = true;
        hooks.onStateChange(currentState, readEffectiveContext(), {
          stayed: false,
          isPending: false,
          isDone: true,
          finalOutcome: 'ERROR',
          finalPayload: err,
          hasFinalPayloadSelector: true,
          emittedOutput: null,
          enteredSubMachine: null,
          exitedSubMachine: null,
        });
        notifySubscribers();
        return;
      }
    }
    sendInternal('ERROR', err, false, false);
  };

  const startAwaitingCallIfNeeded = (
    stateName: string,
    callSelector: TransitionCallSelector<any, any, TContext> | null,
    eventPayload: unknown,
  ): void => {
    const methodsTarget = hooks?.methods as Record<string, any> | undefined;
    if (!callSelector || !methodsTarget) {
      return;
    }
    const fn =
      typeof callSelector === 'function'
        ? callSelector(methodsTarget)
        : methodsTarget[callSelector];
    if (typeof fn !== 'function') {
      return;
    }
    cancelActiveTask();
    const abortController = new AbortController();
    const handle = {
      stateName,
      entryEpoch: stateEpoch,
      cancelled: false,
      abortController,
      teardown: null as (() => void) | null,
    };
    activeTask = handle;

    let resolveTracker: (() => void) | null = null;
    const ensureTracker = (): (() => void) => {
      if (!resolveTracker && hooks?.onTaskTrack) {
        const p = new Promise<void>((res) => {
          resolveTracker = res;
        });
        hooks.onTaskTrack(p);
      }
      return () => {
        resolveTracker?.();
        resolveTracker = null;
      };
    };

    try {
      const ret = fn.call(
        methodsTarget,
        eventPayload,
        abortController.signal,
        readEffectiveContext(),
      );

      if (
        hooks?.taskAdapter &&
        (!hooks.taskAdapter.canHandle || hooks.taskAdapter.canHandle(ret))
      ) {
        const settleTrack = ensureTracker();
        const customTeardown = hooks.taskAdapter.execute(ret, {
          signal: abortController.signal,
          isCancelled: () =>
            isDestroyed ||
            handle.cancelled ||
            abortController.signal.aborted ||
            stateEpoch !== handle.entryEpoch ||
            activeTask !== handle,
          onSuccess: (val) => {
            try {
              handleAwaitingSuccess(handle, val);
            } finally {
              settleTrack();
            }
          },
          onFailure: (err) => {
            try {
              handleAwaitingFailure(handle, err);
            } finally {
              settleTrack();
            }
          },
        });
        if (typeof customTeardown === 'function') {
          handle.teardown = () => {
            customTeardown();
            settleTrack();
          };
        } else {
          handle.teardown = settleTrack;
        }
        return;
      }

      if (ret && typeof (ret as PromiseLike<unknown>).then === 'function') {
        const settleTrack = ensureTracker();
        handle.teardown = settleTrack;
        (ret as PromiseLike<unknown>).then(
          (val) => {
            try {
              handleAwaitingSuccess(handle, val);
            } finally {
              settleTrack();
            }
          },
          (err) => {
            try {
              handleAwaitingFailure(handle, err);
            } finally {
              settleTrack();
            }
          },
        );
        return;
      }
      if (
        ret &&
        typeof (ret as SubscribableLike<unknown>).subscribe === 'function'
      ) {
        let settled = false;
        let sub: { unsubscribe(): void } | (() => void) | null = null;
        const settleTrack = ensureTracker();
        const cleanupSub = () => {
          settleTrack();
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
        sub = (ret as SubscribableLike<unknown>).subscribe({
          next: (val) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanupSub();
            handle.teardown = null;
            handleAwaitingSuccess(handle, val);
          },
          error: (err) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanupSub();
            handle.teardown = null;
            handleAwaitingFailure(handle, err);
          },
          complete: () => {
            if (settled) {
              return;
            }
            settled = true;
            cleanupSub();
            handle.teardown = null;
            handleAwaitingSuccess(handle, undefined);
          },
        });
        if (settled) {
          cleanupSub();
        }
        return;
      }
      handleAwaitingSuccess(handle, ret);
    } catch (syncErr) {
      handleAwaitingFailure(handle, syncErr);
    }
  };

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

  const can = ((event: string, payload?: unknown): boolean => {
    if (isDestroyed) {
      return false;
    }
    if (activeSubMachine && activeSubRef) {
      if (activeSubMachine.can(event as any, payload as any)) {
        return true;
      }
    }
    if (
      activeCombinator &&
      !fsm.hasTransitionFor(activeCombinator.node.id, event, { exact: true })
    ) {
      if (
        activeCombinator.instances.some(
          (inst) =>
            inst !== null &&
            !inst.isDone() &&
            inst.can(event as any, payload as any),
        )
      ) {
        return true;
      }
    }
    if (
      activeEachPool &&
      !fsm.hasTransitionFor(activeEachPool.node.id, event, { exact: true })
    ) {
      if (
        [...activeEachPool.instances.values()].some(
          (inst) => !inst.isDone() && inst.can(event as any, payload as any),
        )
      ) {
        return true;
      }
    }
    const evalResult = fsm.evaluate(
      currentState,
      event,
      payload,
      readEffectiveContext(),
    );
    return evalResult.matched && !evalResult.isNoOpStay;
  }) as CanFn<TFSM, BuiltInLifecycleEvent>;

  const send = ((event: string, payload?: unknown): void => {
    sendInternal(event, payload, false, false);
  }) as SendFn<TFSM, BuiltInLifecycleEvent>;

  const sendToChild = ((
    key: string,
    itemId: string,
    event: string,
    payload?: unknown,
  ): void => {
    if (isDestroyed) {
      return;
    }
    if (activeEachPool && activeEachPool.node.key === key) {
      const target = activeEachPool.instances.get(itemId);
      if (target && !target.isDone()) {
        target.send(event as any, payload as any);
      }
      return;
    }
    if (activeSubMachine) {
      activeSubMachine.sendToChild(
        key as any,
        itemId,
        event as any,
        payload as any,
      );
    }
  }) as SendToChildFn<TFSM, BuiltInLifecycleEvent>;

  const childMachines = (): Readonly<
    Record<string, ReadonlyArray<ChildMachineEntry>>
  > => {
    const out: Record<string, ReadonlyArray<ChildMachineEntry>> = {};
    for (const [k, entries] of settledEachPools.entries()) {
      out[k] = entries;
    }
    if (activeEachPool) {
      out[activeEachPool.node.key] = snapshotPoolEntries(activeEachPool);
    }
    if (activeCombinator) {
      const comb = activeCombinator;
      out[comb.node.id] = comb.actorRefs.map((ref, idx) => {
        const inst = comb.instances[idx];
        if (inst) {
          return {
            id: ref.id,
            state: inst.state(),
            subState: inst.subState(),
            context: inst.context() as Readonly<Record<string, unknown>>,
            isPending: inst.isPending(),
            isDone: inst.isDone(),
            finalOutcome: inst.finalOutcome(),
          };
        }
        return {
          id: ref.id,
          state: ref.machine.initial,
          subState: null,
          context: (ref.machine.context ?? {}) as Readonly<
            Record<string, unknown>
          >,
          isPending: false,
          isDone: Boolean(comb.childSettled[idx]),
          finalOutcome: comb.childSettled[idx] ? 'DONE' : null,
        };
      });
    }
    return out;
  };

  const patchContext = (patch: Partial<TContext>): void => {
    patchedOverlay = { ...(patchedOverlay ?? {}), ...patch };
    currentContext = { ...currentContext, ...patch };
    if (activeSubMachine) {
      activeSubMachine.patchContext(patch as Record<string, unknown>);
    }
    for (const [, entry] of activeEveryTimers.entries()) {
      scheduleOrUpdateEveryTimer(currentState, stateEpoch, entry.via, false);
    }
    if (!inTransitionCall && !isProcessing) {
      if (!isDone() && fsm.hasTransitionFor(currentState, '__always__')) {
        sendInternal('__always__', undefined, false, false);
      }
      notifySubscribers();
    }
  };

  const subscribe = (
    listenerOrObserver: SnapshotListener<TFSM>,
  ): MachineSubscription => {
    const fn =
      typeof listenerOrObserver === 'function'
        ? listenerOrObserver
        : typeof listenerOrObserver?.next === 'function'
          ? (snap: MachineSnapshot<TFSM>) => listenerOrObserver.next!(snap)
          : null;
    if (!fn) {
      const noopSub = (() => {
        /* no-op */
      }) as MachineSubscription;
      noopSub.unsubscribe = noopSub;
      return noopSub;
    }
    subscribers.add(fn);
    const unsub = (() => {
      subscribers.delete(fn);
    }) as MachineSubscription;
    unsub.unsubscribe = unsub;
    return unsub;
  };

  const destroy = (): void => {
    isDestroyed = true;
    clearActiveTimers();
    cancelActiveTask();
    eventQueue.length = 0;
    isProcessing = false;
    if (activeSubMachine) {
      activeSubMachine.destroy();
      activeSubMachine = null;
      activeSubRef = null;
    }
    destroyActiveCombinator();
    destroyActiveEachPool(false);
    settledEachPools.clear();
    subscribers.clear();
  };

  const getSnapshot = (): MachineSnapshot<TFSM> => {
    const children: Record<string, MachineSnapshot<any>> = {};
    if (activeSubMachine && activeSubRef) {
      children[activeSubRef.id] = activeSubMachine.getSnapshot();
    }
    let combinatorProgress: CombinatorSnapshotProgress | undefined;
    if (activeCombinator) {
      const settledIndices: number[] = [];
      activeCombinator.actorRefs.forEach((actorRef, idx) => {
        if (activeCombinator!.childSettled[idx]) {
          settledIndices.push(idx);
        }
        const child = activeCombinator!.instances[idx];
        if (child) {
          children[actorRef.id] = child.getSnapshot();
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
    if (activeEachPool) {
      for (const [itemId, childInst] of activeEachPool.instances.entries()) {
        children[`${activeEachPool.node.id}:${itemId}`] =
          childInst.getSnapshot();
      }
    }
    return {
      state: currentState,
      context: { ...readEffectiveContext() },
      stateEpoch,
      ...(doneOutcome !== null
        ? {
            doneOutcome,
            finalPayload: donePayload,
            hasFinalPayloadSelector: doneHasFinalSelector,
          }
        : {}),
      ...(Object.keys(children).length > 0 ? { children } : {}),
      ...(combinatorProgress ? { combinatorProgress } : {}),
    };
  };

  const enterInitialOrRestoredTopology = (
    forRestore: boolean,
    snapshot?: MachineSnapshot<TFSM>,
  ): void => {
    const subRef = fsm.subMachines.get(currentState);
    if (subRef) {
      enterSubMachineIfNeeded(subRef, currentContext, forRestore);
      if (forRestore && snapshot?.children?.[subRef.id] && activeSubMachine) {
        activeSubMachine.restoreSnapshot(snapshot.children[subRef.id]);
      }
    }
    const combNode = fsm.combinatorNodes?.get(currentState);
    if (combNode) {
      enterCombinatorIfNeeded(
        combNode,
        currentContext,
        forRestore,
        snapshot?.combinatorProgress,
      );
      if (forRestore && activeCombinator && snapshot?.children) {
        activeCombinator.actorRefs.forEach((actorRef, idx) => {
          const childInst = activeCombinator?.instances[idx];
          const childSnap =
            snapshot.children?.[actorRef.id] ??
            snapshot.children?.[actorRef.machine.id];
          if (childSnap && childInst) {
            childInst.restoreSnapshot(childSnap);
          }
        });
      }
    }
    const eachNode = fsm.eachNodes.get(currentState);
    if (eachNode) {
      enterEachIfNeeded(eachNode, currentContext, forRestore);
      if (forRestore && activeEachPool && snapshot?.children) {
        for (const [itemId, childInst] of activeEachPool.instances.entries()) {
          const childSnap =
            snapshot.children[`${eachNode.id}:${itemId}`] ??
            snapshot.children[itemId];
          if (childSnap) {
            childInst.restoreSnapshot(childSnap);
          }
        }
      }
    }
    if (isDone()) {
      return;
    }
    scheduleStateTimers(currentState);
    if (fsm.awaitingStates.has(currentState)) {
      const sel =
        activeAwaitingSelectors.get(currentState) ??
        fsm.awaitingCallSelectors?.get(currentState) ??
        null;
      startAwaitingCallIfNeeded(currentState, sel, undefined);
    }
    if (!isDone() && fsm.hasTransitionFor(currentState, '__always__')) {
      sendInternal('__always__', undefined, false, false);
    }
  };

  const restoreSnapshot = (snapshot: MachineSnapshot<TFSM>): void => {
    isDestroyed = false;
    clearActiveTimers();
    cancelActiveTask();
    eventQueue.length = 0;
    if (activeSubMachine) {
      activeSubMachine.destroy();
      activeSubMachine = null;
      activeSubRef = null;
    }
    destroyActiveCombinator();
    destroyActiveEachPool(false);
    settledEachPools.clear();
    doneOutcome = snapshot.doneOutcome ?? null;
    donePayload = snapshot.finalPayload;
    doneHasFinalSelector = Boolean(snapshot.hasFinalPayloadSelector);
    currentState = snapshot.state;
    patchedOverlay = null;
    currentContext = {
      ...fsm.context,
      ...(snapshot.context as TContext),
    };
    stateEpoch = Math.max(stateEpoch + 1, snapshot.stateEpoch);
    lastTaskSettledEpoch = -1;
    enterInitialOrRestoredTopology(true, snapshot);
    notifySubscribers();
  };

  const reset = (initialOverride?: Partial<TContext>): void => {
    const savedSubscribers = [...subscribers];
    destroy();
    for (const s of savedSubscribers) {
      subscribers.add(s);
    }
    isDestroyed = false;
    doneOutcome = null;
    donePayload = undefined;
    doneHasFinalSelector = false;
    patchedOverlay = null;
    activeAwaitingSelectors.clear();
    currentState = fsm.initial as TState;
    stateEpoch++;
    lastTaskSettledEpoch = -1;
    currentContext = {
      ...fsm.context,
      ...(hooks?.context ?? {}),
      ...(hooks?.initialContext ?? {}),
      ...(initialOverride ?? {}),
    };
    enterInitialOrRestoredTopology(false);
    notifySubscribers();
  };

  if (!hooks?.skipInitialEffects) {
    enterInitialOrRestoredTopology(false);
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
    hasFinalPayloadSelector: () => doneHasFinalSelector,
    hasActiveTransition,
    childMachines,
    can,
    send,
    sendToChild,
    patchContext,
    subscribe,
    getSnapshot,
    restoreSnapshot,
    reset,
    destroy,
  };
}
