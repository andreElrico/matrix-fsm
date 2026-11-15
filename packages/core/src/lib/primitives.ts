/**
 * @matrix-fsm/core - Matrix DSL Primitives & Markers
 */

import { createFSM } from './fsm.js';
import type {
  AfterNode,
  AllNode,
  AlwaysNode,
  AnyFSMDefinition,
  AnyNode,
  AnyStateNode,
  AnyTransitionRow,
  AwaitingNode,
  CombinatorKind,
  CombinatorNode,
  EachNode,
  EmptyObject,
  EveryNode,
  ExtractInput,
  ExtractedTransitionRow,
  FinalNode,
  FSMConfig,
  FSMDefinition,
  JoinMachineIds,
  OutcomeNode,
  RaceNode,
  ReadonlyContext,
  ResolveTransitionsContext,
  ResolveTransitionsMethods,
  StayNode,
  SubMachineNodeId,
  SubMachineRef,
  TransitionRow,
  UnwrapSubMachineRef,
  UnwrapSubMachineTuple,
} from './types.js';

/**
 * Marks a target state in Column 3 (`TO`) as an asynchronous transitional state.
 * By convention (enforced by `@matrix-fsm/eslint-plugin`), `stateName` must end with `-ing`.
 */
export function awaiting<const TState extends string>(
  state: TState,
): AwaitingNode<TState> {
  return Object.freeze({
    __type: 'awaiting' as const,
    state,
  });
}

/**
 * Wraps a named domain outcome event (and optional payload) returned from an `awaiting()` method
 * so the state machine transitions directly via `event` instead of generic `'DONE'`.
 */
export function outcome<const TEvent extends string>(
  event: TEvent,
): OutcomeNode<TEvent, void>;
export function outcome<const TEvent extends string, TPayload>(
  event: TEvent,
  payload: TPayload,
): OutcomeNode<TEvent, TPayload>;
export function outcome<const TEvent extends string, TPayload = void>(
  event: TEvent,
  payload?: TPayload,
): OutcomeNode<TEvent, TPayload> {
  return Object.freeze({
    __type: 'outcome' as const,
    event,
    payload: payload as TPayload,
  });
}

const STAY_INSTANCE: StayNode = Object.freeze({
  __type: 'stay' as const,
});

/**
 * Used in Column 3 (`TO`) for gatekeeper fallbacks.
 * Executes `call` or `patch`, keeps the machine in the current state, and does NOT trigger
 * `onExit` / `onEnter` or interrupt running tasks.
 */
export function stay(): StayNode {
  return STAY_INSTANCE;
}

const ANY_STATE_INSTANCE: AnyStateNode = Object.freeze({
  __type: 'anyState' as const,
});

/**
 * Wildcard state marker for Column 1 (`FROM` only).
 * Matches an event from any active state as a fallback when no state-specific transition matches.
 */
export function anyState(): AnyStateNode {
  return ANY_STATE_INSTANCE;
}

/**
 * Terminal state marker for sub-machine or workflow outcomes.
 */
export function finalState(): FinalNode<'DONE', true>;
export function finalState<const TOutcome extends string>(
  outcome: TOutcome,
): FinalNode<TOutcome, false>;
export function finalState(outcome?: string): FinalNode<string, boolean> {
  const isBare = outcome === undefined;
  return Object.freeze({
    __type: 'finalState' as const,
    outcome: outcome ?? 'DONE',
    isBare,
  });
}

let nextDynamicTimerId = 0;

function normalizeTimerSelectorKey(fn: (...args: any[]) => any): string {
  return fn.toString().replace(/\s+/g, '');
}

/**
 * Declarative one-shot timer marker for Column 2 (`VIA`).
 * Automatically fires after `ms` milliseconds while in the source state (must transition out of the state; `stay()` is forbidden)
 * and cancels via `clearTimeout` immediately when the state is exited.
 */
export function after<const TMs extends number, TContext = any>(
  ms: TMs | ((ctx: ReadonlyContext<TContext>) => number),
): AfterNode<TMs, TContext> {
  const id =
    typeof ms === 'number'
      ? (`__after_${ms}__` as const)
      : (`__after_fn_${++nextDynamicTimerId}:${normalizeTimerSelectorKey(ms)}__` as const);
  return Object.freeze({
    __type: 'after' as const,
    ms,
    id,
  });
}

/**
 * Declarative recurring interval marker for Column 2 (`VIA`).
 * Must be paired with `stay()` in Column 3 (`TO`).
 * Continuously fires every `ms` milliseconds while in the source state, adapts immediately when a `stay()` transition mutates the interval duration, and cancels on state exit.
 */
export function every<TContext = any>(
  ms: number | ((ctx: ReadonlyContext<TContext>) => number),
): EveryNode<TContext> {
  const id =
    typeof ms === 'number'
      ? (`__every_${ms}__` as const)
      : (`__every_fn_${++nextDynamicTimerId}:${normalizeTimerSelectorKey(ms)}__` as const);
  return Object.freeze({
    __type: 'every' as const,
    ms,
    id,
  });
}

const ALWAYS_INSTANCE: AlwaysNode = Object.freeze({
  __type: 'always' as const,
  id: '__always__' as const,
});

/**
 * Eventless (transient) conditional branching marker for Column 2 (`VIA`).
 * Evaluated synchronously immediately upon entering the source state in Column 1.
 */
export function always(): AlwaysNode {
  return ALWAYS_INSTANCE;
}

export const MAX_SYNC_MICROSTEPS = 100 as const;

export class MatrixFsmInfiniteLoopError extends Error {
  constructor(machineId: string, state: string, maxSteps = MAX_SYNC_MICROSTEPS) {
    super(
      `[MatrixFSM Error]: Infinite synchronous always() loop detected in machine '${machineId}' at state '${state}' (exceeded MAX_SYNC_MICROSTEPS = ${maxSteps}).`,
    );
    this.name = 'MatrixFsmInfiniteLoopError';
  }
}

/**
 * Zero-cost identity macro wrapper (`x => x`) used to extract large transition groups (> 3 rows)
 * into a variable or separate file while preserving full TypeScript context/method inference
 * and ESLint AST detection.
 */
export function transitions<
  const TRows extends readonly TransitionRow<any, any, any, any>[],
>(rows: TRows): TRows;
export function transitions<TContractOrContext, TMethods = never>(
  rows: readonly TransitionRow<
    ResolveTransitionsContext<TContractOrContext, TMethods>,
    any,
    any,
    ResolveTransitionsMethods<TContractOrContext, TMethods>
  >[],
): readonly ExtractedTransitionRow<
  ResolveTransitionsContext<TContractOrContext, TMethods>,
  ResolveTransitionsMethods<TContractOrContext, TMethods>
>[];
export function transitions<TContractOrContext, TMethods = never>(): <
  const TRows extends readonly TransitionRow<
    ResolveTransitionsContext<TContractOrContext, TMethods>,
    any,
    any,
    ResolveTransitionsMethods<TContractOrContext, TMethods>
  >[],
>(
  rows: TRows,
) => TRows;
export function transitions(rows?: unknown): unknown {
  if (rows === undefined) {
    return <T>(r: T): T => r;
  }
  return rows;
}

/**
 * Wraps or aliases a child FSM definition, feature, or config as a `SubMachineRef`.
 * Pass an optional `aliasId` second argument (`subMachine(dialogFSM, 'confirmDelete')`)
 * to mount the same reusable sub-machine multiple times in a parent matrix or combinator without ID collisions.
 */
export function subMachine<
  TRef extends AnyFSMDefinition | SubMachineRef<any, any>,
>(
  fsmOrRef: TRef,
): SubMachineRef<UnwrapSubMachineRef<TRef>, SubMachineNodeId<TRef>>;
export function subMachine<
  TRef extends AnyFSMDefinition | SubMachineRef<any, any>,
  const TAliasId extends string,
>(
  fsmOrRef: TRef,
  aliasId: TAliasId,
): SubMachineRef<UnwrapSubMachineRef<TRef>, TAliasId>;
export function subMachine<
  TId extends string,
  TInitial extends string,
  TContext extends object = EmptyObject,
  TEvents extends Record<string, any> = Record<string, any>,
  const TTransitions extends readonly AnyTransitionRow<TContext, any>[] =
    readonly AnyTransitionRow<TContext, any>[],
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
): SubMachineRef<
  FSMDefinition<TId, TInitial, TContext, TEvents, TTransitions, TMethods>,
  TId
>;
export function subMachine<
  TId extends string,
  TInitial extends string,
  const TAliasId extends string,
  TContext extends object = EmptyObject,
  TEvents extends Record<string, any> = Record<string, any>,
  const TTransitions extends readonly AnyTransitionRow<TContext, any>[] =
    readonly AnyTransitionRow<TContext, any>[],
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
  aliasId: TAliasId,
): SubMachineRef<
  FSMDefinition<TId, TInitial, TContext, TEvents, TTransitions, TMethods>,
  TAliasId
>;
export function subMachine(
  configOrFSM: unknown,
  aliasId?: string,
): SubMachineRef<AnyFSMDefinition, string> {
  const machine = isSubMachineRef(configOrFSM)
    ? configOrFSM.machine
    : isFSMDefinition(configOrFSM)
      ? configOrFSM
      : createFSM()(configOrFSM as any);
  const resolvedId =
    aliasId ??
    (isSubMachineRef(configOrFSM) ? configOrFSM.id : machine.id);
  return Object.freeze({
    __type: 'subMachine' as const,
    id: resolvedId,
    machine,
  });
}

/**
 * Converts a plural collection key into its singular property name (`'drinks'` -> `'drink'`,
 * `'categories'` -> `'category'`, `'addresses'` -> `'address'`), returning `null` for non-plural keys (`'status'`).
 */
export function singularizeEachKey(key: string): string | null {
  if (key.length <= 1 || /(?:series|species)$/i.test(key)) {
    return null;
  }
  if (key.endsWith('ies') && key.length > 3) {
    return `${key.slice(0, -3)}y`;
  }
  if (/(?:ss|x|ch|sh|us)es$/.test(key)) {
    return key.slice(0, -2);
  }
  if (/(?:ss|us|is)$/.test(key)) {
    return null;
  }
  if (key.endsWith('s')) {
    return key.slice(0, -1);
  }
  return null;
}

/**
 * Parallel Master/Slave Orchestration marker.
 * Spawns an isolated `childFSM` instance for each item in `ctx[contextArrayKey]`.
 * Accepts an optional `itemInputMapper: (item, index, ctx) => childInputs` third parameter.
 * Automatically dispatches `'ALL_DONE'` to the parent machine when all instances are done.
 */
export function each<
  const TKey extends string,
  TFSM extends AnyFSMDefinition,
>(
  contextArrayKey: TKey,
  childFSM: TFSM | SubMachineRef<TFSM, any>,
): EachNode<TKey, TFSM, false>;
export function each<
  const TKey extends string,
  TFSM extends AnyFSMDefinition,
  TItem = any,
  TParentContext = any,
>(
  contextArrayKey: TKey,
  childFSM: TFSM | SubMachineRef<TFSM, any>,
  itemInputMapper: (
    item: TItem,
    index: number,
    ctx: ReadonlyContext<TParentContext>,
  ) => ExtractInput<TFSM>,
): EachNode<TKey, TFSM, true>;
export function each<
  const TKey extends string,
  TFSM extends AnyFSMDefinition,
>(
  contextArrayKey: TKey,
  childFSM: TFSM | SubMachineRef<TFSM, any>,
  itemInputMapper?: (
    item: any,
    index: number,
    ctx: any,
  ) => Record<string, unknown>,
): EachNode<TKey, TFSM, boolean> {
  const machine = (
    isSubMachineRef(childFSM) ? childFSM.machine : childFSM
  ) as TFSM;
  return Object.freeze({
    __type: 'each' as const,
    id: `each:${contextArrayKey}` as const,
    key: contextArrayKey,
    machine,
    ...(typeof itemInputMapper === 'function' ? { itemInputMapper } : {}),
  });
}

function createCombinator<
  TKind extends CombinatorKind,
  const TMachines extends readonly (AnyFSMDefinition | SubMachineRef<any, any>)[],
>(
  kind: TKind,
  args: TMachines | readonly [TMachines],
): CombinatorNode<TKind, TMachines> {
  const rawList = (
    args.length === 1 && Array.isArray(args[0]) ? args[0] : args
  ) as readonly (AnyFSMDefinition | SubMachineRef<any, any>)[];
  const actorRefs = rawList.map((m) =>
    isSubMachineRef(m)
      ? m
      : Object.freeze({
          __type: 'subMachine' as const,
          id: m.id,
          machine: m,
        }),
  );
  const machines = actorRefs.map(
    (ref) => ref.machine,
  ) as unknown as UnwrapSubMachineTuple<TMachines>;
  const joinedIds = actorRefs.map((ref) => ref.id).join(',');
  return Object.freeze({
    __type: kind,
    id: `${kind}:${joinedIds}` as `${TKind}:${JoinMachineIds<TMachines>}`,
    machines: Object.freeze([...machines]) as unknown as UnwrapSubMachineTuple<TMachines>,
    actorRefs: Object.freeze(actorRefs),
  });
}

/**
 * Promise.all-style Actor Combinator.
 * Spawns all actors simultaneously, dispatches `'ALL_DONE'` when all actors reach `finalState()`,
 * and immediately aborts all actors if the parent interrupts or any actor fails with an unhandled error.
 */
export function all<
  const TMachines extends readonly (AnyFSMDefinition | SubMachineRef<any, any>)[],
>(
  ...machines: TMachines
): AllNode<TMachines>;
export function all<
  const TMachines extends readonly (AnyFSMDefinition | SubMachineRef<any, any>)[],
>(
  machines: TMachines,
): AllNode<TMachines>;
export function all(...args: any[]): AllNode<any> {
  return createCombinator('all', args as any);
}

/**
 * Promise.race-style Actor Combinator.
 * Spawns all actors simultaneously; as soon as the first actor reaches `finalState()`,
 * immediately aborts all remaining actors in the same tick.
 */
export function race<
  const TMachines extends readonly (AnyFSMDefinition | SubMachineRef<any, any>)[],
>(
  ...machines: TMachines
): RaceNode<TMachines>;
export function race<
  const TMachines extends readonly (AnyFSMDefinition | SubMachineRef<any, any>)[],
>(
  machines: TMachines,
): RaceNode<TMachines>;
export function race(...args: any[]): RaceNode<any> {
  return createCombinator('race', args as any);
}

/**
 * Promise.any-style Actor Combinator.
 * Spawns all actors simultaneously; resolves on the first actor reaching a non-error `finalState()`
 * (aborting the remaining actors), and only dispatches `'ERROR'` if all actors fail.
 */
export function any<
  const TMachines extends readonly (AnyFSMDefinition | SubMachineRef<any, any>)[],
>(
  ...machines: TMachines
): AnyNode<TMachines>;
export function any<
  const TMachines extends readonly (AnyFSMDefinition | SubMachineRef<any, any>)[],
>(
  machines: TMachines,
): AnyNode<TMachines>;
export function any(...args: any[]): AnyNode<any> {
  return createCombinator('any', args as any);
}

// ============================================================================
// Runtime Type Guards
// ============================================================================

export function isAwaitingNode(value: unknown): value is AwaitingNode<string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as AwaitingNode).__type === 'awaiting'
  );
}

export function isOutcomeNode(
  value: unknown,
): value is OutcomeNode<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as OutcomeNode).__type === 'outcome' &&
    typeof (value as OutcomeNode).event === 'string'
  );
}

export function isStayNode(value: unknown): value is StayNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as StayNode).__type === 'stay'
  );
}

export function isAnyStateNode(value: unknown): value is AnyStateNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as AnyStateNode).__type === 'anyState'
  );
}

export function isFinalNode(value: unknown): value is FinalNode<string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as FinalNode).__type === 'finalState'
  );
}

export function isAfterNode(value: unknown): value is AfterNode<number, any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as AfterNode).__type === 'after'
  );
}

export function isEveryNode(value: unknown): value is EveryNode<any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as EveryNode).__type === 'every'
  );
}

export function isAlwaysNode(value: unknown): value is AlwaysNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as AlwaysNode).__type === 'always'
  );
}

export function isSubMachineRef(
  value: unknown,
): value is SubMachineRef<AnyFSMDefinition, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as SubMachineRef).__type === 'subMachine'
  );
}

export function isEachNode(
  value: unknown,
): value is EachNode<string, AnyFSMDefinition> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as EachNode).__type === 'each'
  );
}

export function isCombinatorNode(
  value: unknown,
): value is CombinatorNode<CombinatorKind, readonly AnyFSMDefinition[]> {
  return (
    typeof value === 'object' &&
    value !== null &&
    ((value as CombinatorNode).__type === 'all' ||
      (value as CombinatorNode).__type === 'race' ||
      (value as CombinatorNode).__type === 'any')
  );
}

export function isFSMDefinition(value: unknown): value is AnyFSMDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'initial' in value &&
    'transitions' in value &&
    typeof (value as AnyFSMDefinition).evaluate === 'function'
  );
}
