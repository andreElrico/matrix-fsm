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
 * Marks a target state in Column 3 (`TO`) or source state in Column 1 (`FROM`) as an
 * asynchronous transitional state.
 *
 * @group DSL Primitives
 * @typeParam TState - Literal state name (must end with `-ing` by ESLint convention, e.g. `'checkingLoyalty'`).
 * @param state - Name of the asynchronous `-ing` state.
 * @returns A frozen {@link AwaitingNode} descriptor used in the transition matrix.
 *
 * @remarks
 * Entering an `awaiting()` state automatically invokes the transition's `{ call: (m) => m._task }`
 * with `(payload, abortSignal, ctx)`. Leaving the state (via `CANCEL`, timeout, or completion)
 * immediately aborts the `AbortSignal`, unsubscribes RxJS `Observable`s, or interrupts Effect fibers.
 *
 * @example
 * ```ts
 * import { awaiting, createFSM } from '@matrix-fsm/core';
 *
 * export const authFSM = createFSM<{
 *   events: { SUBMIT: { email: string }; CANCEL: void };
 *   states: 'idle' | 'authenticating' | 'authenticated';
 *   methods: { _login: (p: { email: string }, signal: AbortSignal) => Promise<void> };
 * }>()({
 *   id: 'auth',
 *   initial: 'idle',
 *   transitions: [
 *     ['idle',           'SUBMIT', awaiting('authenticating'), { call: (m) => m._login }],
 *     ['authenticating', 'DONE',   'authenticated'],
 *     ['authenticating', 'CANCEL', 'idle'],
 *     ['authenticating', 'ERROR',  'idle'],
 *   ],
 * });
 * ```
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
 * Wraps a named domain outcome event (and optional payload) returned from an `awaiting()` async task
 * so the state machine routes directly via `event` instead of the generic `'DONE'` lifecycle event.
 *
 * @group DSL Primitives
 * @typeParam TEvent - Literal domain event name matched in Column 2 (`VIA`).
 * @typeParam TPayload - Optional payload forwarded to the matching transition's `call` / `guard`.
 * @param event - Domain outcome event name.
 * @returns A frozen {@link OutcomeNode} wrapping `event`.
 *
 * @remarks
 * Use `outcome()` when an async operation has multiple domain outcomes (such as `'APPROVED'` vs.
 * `'DECLINED'`) so you can branch cleanly in the 2D matrix without throwing errors for non-exceptional paths.
 *
 * @example
 * ```ts
 * import { awaiting, createFSM, outcome } from '@matrix-fsm/core';
 *
 * const checkoutFSM = createFSM<{
 *   events: { PAY: { amount: number } };
 *   states: 'ready' | 'processingPayment' | 'paid' | 'declined';
 *   methods: {
 *     _chargeCard: (p: { amount: number }) => Promise<
 *       | ReturnType<typeof outcome<'APPROVED', { txId: string }>>
 *       | ReturnType<typeof outcome<'DECLINED', { reason: string }>>
 *     >;
 *   };
 * }>()({
 *   id: 'checkout',
 *   initial: 'ready',
 *   transitions: [
 *     ['ready',             'PAY',      awaiting('processingPayment'), { call: (m) => m._chargeCard }],
 *     ['processingPayment', 'APPROVED', 'paid'],
 *     ['processingPayment', 'DECLINED', 'declined'],
 *     ['processingPayment', 'ERROR',    'declined'],
 *   ],
 * });
 * ```
 */
export function outcome<const TEvent extends string>(
  event: TEvent,
): OutcomeNode<TEvent, void>;
/**
 * Wraps a named domain outcome event with a typed payload returned from an `awaiting()` async task.
 *
 * @group DSL Primitives
 * @typeParam TEvent - Literal domain event name matched in Column 2 (`VIA`).
 * @typeParam TPayload - Payload type passed to the matching transition.
 * @param event - Domain outcome event name.
 * @param payload - Strongly-typed outcome payload.
 * @returns A frozen {@link OutcomeNode} containing `event` and `payload`.
 */
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
 * Self-transition target marker for Column 3 (`TO`) used for gatekeeper fallbacks and in-place updates.
 *
 * @group DSL Primitives
 * @returns The singleton frozen {@link StayNode} marker.
 *
 * @remarks
 * `stay()` keeps the machine in its current state, executes `{ call }` and `{ output }` if present,
 * and **does not** bump `stateEpoch`, trigger `onExit`/`onEnter`, or cancel running `awaiting()` tasks
 * or timers. Required as the final fallback row in guarded `[FROM, VIA]` groups and as the target of `every(ms)`.
 *
 * @example
 * ```ts
 * import { awaiting, createFSM, stay } from '@matrix-fsm/core';
 *
 * const orderFSM = createFSM<{
 *   events: { SELECT_DRINK: { name: string }; PLACE_ORDER: void };
 *   states: 'browsing' | 'checkingLoyalty';
 *   context: { drink: string | null; error: string | null };
 *   methods: {
 *     _selectDrink: (p: { name: string }) => void;
 *     _checkLoyalty: () => Promise<void>;
 *     _setMissingDrinkError: () => void;
 *   };
 * }>()({
 *   id: 'order',
 *   initial: 'browsing',
 *   transitions: [
 *     ['browsing', 'SELECT_DRINK', stay(),                      { call: (m) => m._selectDrink }],
 *     ['browsing', 'PLACE_ORDER',  awaiting('checkingLoyalty'), { guard: (ctx) => ctx.drink !== null, call: (m) => m._checkLoyalty }],
 *     ['browsing', 'PLACE_ORDER',  stay(),                      { call: (m) => m._setMissingDrinkError }],
 *   ],
 * });
 * ```
 */
export function stay(): StayNode {
  return STAY_INSTANCE;
}

const ANY_STATE_INSTANCE: AnyStateNode = Object.freeze({
  __type: 'anyState' as const,
});

/**
 * Global wildcard state marker for Column 1 (`FROM` only).
 *
 * @group DSL Primitives
 * @returns The singleton frozen {@link AnyStateNode} marker.
 *
 * @remarks
 * Evaluated in Pass 2 only after state-specific rows in Pass 1 fail to match (First-Match-Wins).
 * Enforced by `@matrix-fsm/eslint-plugin`: `anyState()` rows may only target `stay()`, `finalState()`,
 * the machine's `initial` state (global reset), or any state when `VIA` is `'ERROR'`.
 *
 * @example
 * ```ts
 * import { anyState, createFSM, stay } from '@matrix-fsm/core';
 *
 * const sessionFSM = createFSM<{
 *   events: { PING: void; LOGOUT: void };
 *   states: 'loggedOut' | 'active';
 *   methods: { _recordPing: () => void; _clearSession: () => void };
 * }>()({
 *   id: 'session',
 *   initial: 'loggedOut',
 *   transitions: [
 *     [anyState(), 'PING',   stay(),      { call: (m) => m._recordPing }],
 *     [anyState(), 'LOGOUT', 'loggedOut', { call: (m) => m._clearSession }],
 *   ],
 * });
 * ```
 */
export function anyState(): AnyStateNode {
  return ANY_STATE_INSTANCE;
}

/**
 * Marks a terminal state in Column 3 (`TO`) with the default `'DONE'` outcome.
 *
 * @group DSL Primitives
 * @returns A frozen {@link FinalNode} with outcome `'DONE'`.
 *
 * @remarks
 * When a child machine reaches `finalState()`, it tears down active timers/tasks and notifies its
 * parent machine. Use `finalState()` together with `{ output: ['EVENT', selector] }` to emit a
 * strongly-typed terminal payload, or pass a string argument (`finalState('CANCELLED')`) for a void
 * named outcome without `options.output`.
 *
 * @example
 * ```ts
 * import { awaiting, createFSM, finalState } from '@matrix-fsm/core';
 *
 * const baristaFSM = createFSM<{
 *   events: { BREW: void; CANCEL: void };
 *   states: 'queued' | 'brewing';
 *   outputs: { COFFEE_READY: { drink: string } };
 *   methods: { _brew: () => Promise<string> };
 * }>()({
 *   id: 'barista',
 *   initial: 'queued',
 *   transitions: [
 *     ['queued',  'BREW',   awaiting('brewing'), { call: (m) => m._brew }],
 *     ['brewing', 'DONE',   finalState(),        { output: ['COFFEE_READY', (_ctx, drink) => ({ drink })] }],
 *     ['brewing', 'CANCEL', finalState('CANCELLED')],
 *     ['brewing', 'ERROR',  'queued'],
 *   ],
 * });
 * ```
 */
export function finalState(): FinalNode<'DONE', true>;
/**
 * Marks a terminal state in Column 3 (`TO`) with a named void outcome (`'DONE'`, `'CANCELLED'`, etc.).
 *
 * @group DSL Primitives
 * @typeParam TOutcome - Literal outcome event name dispatched to the parent machine.
 * @param outcome - Named terminal outcome event (cannot be combined with `options.output`).
 * @returns A frozen {@link FinalNode} with the specified `outcome`.
 */
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
 * Declarative one-shot timeout marker for Column 2 (`VIA`), including inside `VIA` arrays.
 *
 * @group DSL Primitives
 * @typeParam TMs - Literal millisecond delay type when static.
 * @typeParam TContext - Machine context type passed to dynamic delay selectors.
 * @param ms - Static delay in milliseconds or a pure selector `(ctx) => number`.
 * @returns A frozen {@link AfterNode} descriptor.
 *
 * @remarks
 * Arms automatically upon entering `FROM` (including `initial`), transitions to `TO` after `ms`
 * (`stay()` is forbidden by `@matrix-fsm/valid-timer-transitions`), and cancels deterministically
 * via `clearTimeout` if the state is exited before expiration.
 *
 * @example
 * ```ts
 * import { after, createFSM } from '@matrix-fsm/core';
 *
 * const toastFSM = createFSM<{
 *   events: { SHOW: void; DISMISS: void };
 *   states: 'hidden' | 'visible';
 * }>()({
 *   id: 'toast',
 *   initial: 'hidden',
 *   transitions: [
 *     ['hidden',  'SHOW',                 'visible'],
 *     ['visible', ['DISMISS', after(3000)], 'hidden'],
 *   ],
 * });
 * ```
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
 * Declarative recurring interval marker for Column 2 (`VIA`), including inside `VIA` arrays.
 *
 * @group DSL Primitives
 * @typeParam TContext - Machine context type passed to dynamic interval selectors.
 * @param ms - Static interval in milliseconds or a pure selector `(ctx) => number`.
 * @returns A frozen {@link EveryNode} descriptor.
 *
 * @remarks
 * Must always target `stay()` in Column 3 (`TO`), enforced by `@matrix-fsm/valid-timer-transitions`.
 * Adapts automatically if a transition or `patchContext()` changes the value returned by `(ctx) => ms`,
 * and clears deterministically on state exit.
 *
 * @example
 * ```ts
 * import { createFSM, every, stay } from '@matrix-fsm/core';
 *
 * const pollerFSM = createFSM<{
 *   events: { START: void; STOP: void };
 *   states: 'idle' | 'polling';
 *   context: { pollMs: number };
 *   methods: { _tick: () => void };
 * }>()({
 *   id: 'poller',
 *   initial: 'idle',
 *   transitions: [
 *     ['idle',    'START',                  'polling'],
 *     ['polling', every((c) => c.pollMs),   stay(),    { call: (m) => m._tick }],
 *     ['polling', 'STOP',                   'idle'],
 *   ],
 * });
 * ```
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
 * Eventless (epsilon) conditional transition marker for Column 2 (`VIA`).
 *
 * @group DSL Primitives
 * @returns The singleton frozen {@link AlwaysNode} descriptor.
 *
 * @remarks
 * Evaluated synchronously immediately upon entering the source state (and after `patchContext()` or
 * `syncContext` updates). Guarded against infinite synchronous loops via {@link MAX_SYNC_MICROSTEPS} (`100`),
 * throwing {@link MatrixFsmInfiniteLoopError} if exceeded.
 *
 * @example
 * ```ts
 * import { always, createFSM } from '@matrix-fsm/core';
 *
 * const gateFSM = createFSM<{
 *   events: { ENTER: void };
 *   states: 'checking' | 'vipLounge' | 'standardQueue';
 *   context: { isVip: boolean };
 * }>()({
 *   id: 'gate',
 *   initial: 'checking',
 *   transitions: [
 *     ['checking', always(), 'vipLounge',     { guard: (ctx) => ctx.isVip }],
 *     ['checking', always(), 'standardQueue'],
 *   ],
 * });
 * ```
 */
export function always(): AlwaysNode {
  return ALWAYS_INSTANCE;
}

/**
 * Maximum consecutive synchronous `always()` microsteps permitted per event dispatch before
 * throwing {@link MatrixFsmInfiniteLoopError}.
 *
 * @group Constants & Errors
 */
export const MAX_SYNC_MICROSTEPS = 100 as const;

/**
 * Error thrown when synchronous `always()` transitions exceed {@link MAX_SYNC_MICROSTEPS}.
 *
 * @group Constants & Errors
 */
export class MatrixFsmInfiniteLoopError extends Error {
  /**
   * Creates an infinite loop diagnostic error for a machine and state.
   *
   * @param machineId - Identifier of the offending state machine.
   * @param state - State name where the cycle was detected.
   * @param maxSteps - Maximum microstep threshold exceeded (defaults to {@link MAX_SYNC_MICROSTEPS}).
   */
  constructor(machineId: string, state: string, maxSteps = MAX_SYNC_MICROSTEPS) {
    super(
      `[MatrixFSM Error]: Infinite synchronous always() loop detected in machine '${machineId}' at state '${state}' (exceeded MAX_SYNC_MICROSTEPS = ${maxSteps}).`,
    );
    this.name = 'MatrixFsmInfiniteLoopError';
  }
}

/**
 * Zero-cost identity macro (`x => x`) for extracting large `[FROM, VIA]` transition groups
 * (`> 3` rows, i.e., at least 4 rows) into a reusable variable while preserving narrow TypeScript
 * literal inference and ESLint AST checks.
 *
 * @group DSL Primitives
 * @param rows - Tuple array of transition rows.
 * @returns The exact `rows` array unchanged at runtime.
 *
 * @remarks
 * Enforced by `@matrix-fsm/complete-extracted-groups`: do not extract groups with 3 or fewer rows,
 * and never split a single `[FROM, VIA]` group across extracted variables and inline rows.
 *
 * @example
 * ```ts
 * import { createFSM, stay, transitions } from '@matrix-fsm/core';
 *
 * interface OrderContract {
 *   events: { APPLY_COUPON: { code: string } };
 *   states: 'cart';
 *   methods: {
 *     _applyVip: () => void;
 *     _applyStudent: () => void;
 *     _applyWelcome: () => void;
 *     _rejectCoupon: () => void;
 *   };
 * }
 *
 * const couponRows = transitions<OrderContract>()([
 *   ['cart', 'APPLY_COUPON', stay(), { guard: (_c, e) => e.code === 'VIP',     call: (m) => m._applyVip }],
 *   ['cart', 'APPLY_COUPON', stay(), { guard: (_c, e) => e.code === 'STUDENT', call: (m) => m._applyStudent }],
 *   ['cart', 'APPLY_COUPON', stay(), { guard: (_c, e) => e.code === 'WELCOME', call: (m) => m._applyWelcome }],
 *   ['cart', 'APPLY_COUPON', stay(), { call: (m) => m._rejectCoupon }],
 * ]);
 *
 * export const cartFSM = createFSM<OrderContract>()({
 *   id: 'cart',
 *   initial: 'cart',
 *   transitions: [...couponRows],
 * });
 * ```
 */
export function transitions<
  const TRows extends readonly TransitionRow<any, any, any, any>[],
>(rows: TRows): TRows;
/**
 * Extracts transition rows typed against a `FSMContract`, machine definition, or context type.
 *
 * @group DSL Primitives
 */
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
/**
 * Curried `transitions<TContract>()(rows)` form for full literal tuple preservation.
 *
 * @group DSL Primitives
 */
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
 * Wraps or aliases a child FSM definition (or `createMachineFeature` definition) as a {@link SubMachineRef}.
 *
 * @group Actor Combinators
 * @param fsmOrRef - Child machine definition or existing `SubMachineRef`.
 * @returns A frozen {@link SubMachineRef} using the machine's `id`.
 *
 * @remarks
 * Any `createFSM` or `createMachineFeature` can also be placed **directly** in Column 1 (`FROM`) or
 * Column 3 (`TO`). Use `subMachine(childFSM, 'alias')` when mounting multiple isolated instances of
 * the same child machine in a parent matrix or inside `all()`, `race()`, or `any()` without ID collisions.
 *
 * @example
 * ```ts
 * import { all, createFSM, finalState, subMachine } from '@matrix-fsm/core';
 *
 * const workerFSM = createFSM<{ events: { DONE: void }; states: 'working' }>()({
 *   id: 'worker',
 *   initial: 'working',
 *   transitions: [['working', 'DONE', finalState()]],
 * });
 *
 * const supervisorFSM = createFSM<{ events: { START: void }; states: 'idle' | 'done' }>()({
 *   id: 'supervisor',
 *   initial: 'idle',
 *   transitions: [
 *     ['idle', 'START', all(subMachine(workerFSM, 'primary'), subMachine(workerFSM, 'backup'))],
 *     [all(subMachine(workerFSM, 'primary'), subMachine(workerFSM, 'backup')), 'ALL_DONE', 'done'],
 *   ],
 * });
 * ```
 */
export function subMachine<
  TRef extends AnyFSMDefinition | SubMachineRef<any, any>,
>(
  fsmOrRef: TRef,
): SubMachineRef<UnwrapSubMachineRef<TRef>, SubMachineNodeId<TRef>>;
/**
 * Wraps a child FSM definition with a unique `aliasId` so multiple instances can coexist in the
 * same parent machine or combinator.
 *
 * @group Actor Combinators
 * @param fsmOrRef - Child machine definition or existing `SubMachineRef`.
 * @param aliasId - Unique actor key used in `store.actors[aliasId]` and snapshots.
 * @returns A frozen {@link SubMachineRef} keyed by `aliasId`.
 */
export function subMachine<
  TRef extends AnyFSMDefinition | SubMachineRef<any, any>,
  const TAliasId extends string,
>(
  fsmOrRef: TRef,
  aliasId: TAliasId,
): SubMachineRef<UnwrapSubMachineRef<TRef>, TAliasId>;
/**
 * Wraps an inline {@link FSMConfig} object directly as a {@link SubMachineRef}.
 *
 * @group Actor Combinators
 */
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
/**
 * Wraps an inline {@link FSMConfig} object as a {@link SubMachineRef} with a custom `aliasId`.
 *
 * @group Actor Combinators
 */
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
 * `'categories'` -> `'category'`, `'addresses'` -> `'address'`), returning `null` for non-plural keys.
 *
 * @internal
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
 * Parallel 1:N Master/Slave actor orchestration marker for Column 3 (`TO`) and Column 1 (`FROM`).
 *
 * @group Actor Combinators
 * @typeParam TKey - Key of the array property in parent context (`ctx[contextArrayKey]`).
 * @typeParam TFSM - Child machine definition spawned for each array item.
 * @param contextArrayKey - Context property holding the array of items to process in parallel.
 * @param childFSM - Child FSM definition (or `SubMachineRef`) instantiated once per item.
 * @returns A frozen {@link EachNode} descriptor.
 *
 * @remarks
 * Spawns an isolated `childFSM` instance for every element in `ctx[contextArrayKey]`, auto-injecting
 * `{ item, index, [singularKey]: item }` (for example `batchOrders` -> `batchOrder`), and dispatches
 * `'ALL_DONE'` (or `'DONE'`) with the ordered array of child terminal payloads once all finish.
 *
 * @example
 * ```ts
 * import { createFSM, each, finalState } from '@matrix-fsm/core';
 *
 * const drinkFSM = createFSM<{
 *   inputs: { drink: { name: string } };
 *   events: { BREWED: void };
 *   states: 'brewing';
 * }>()({
 *   id: 'drink',
 *   initial: 'brewing',
 *   transitions: [['brewing', 'BREWED', finalState()]],
 * });
 *
 * const trayFSM = createFSM<{
 *   events: { START_BATCH: void };
 *   states: 'idle' | 'served';
 *   context: { drinks: Array<{ name: string }> };
 * }>()({
 *   id: 'tray',
 *   initial: 'idle',
 *   transitions: [
 *     ['idle',                   'START_BATCH', each('drinks', drinkFSM)],
 *     [each('drinks', drinkFSM), 'ALL_DONE',    'served'],
 *   ],
 * });
 * ```
 */
export function each<
  const TKey extends string,
  TFSM extends AnyFSMDefinition,
>(
  contextArrayKey: TKey,
  childFSM: TFSM | SubMachineRef<TFSM, any>,
): EachNode<TKey, TFSM, false>;
/**
 * Parallel 1:N actor orchestration marker with an explicit `itemInputMapper`.
 *
 * @group Actor Combinators
 * @param contextArrayKey - Context property holding the array of items.
 * @param childFSM - Child FSM definition instantiated per item.
 * @param itemInputMapper - Maps `(item, index, ctx)` to strongly-typed child `inputs`.
 * @returns A frozen {@link EachNode} descriptor.
 */
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
 * `Promise.all`-style parallel actor combinator for Column 3 (`TO`) and Column 1 (`FROM`).
 *
 * @group Actor Combinators
 * @param machines - Child FSM definitions (or aliased `subMachine(...)` refs) to run concurrently.
 * @returns A frozen {@link AllNode} combinator descriptor.
 *
 * @remarks
 * Spawns all actors simultaneously, dispatches `'ALL_DONE'` with `{ [actorId]: payload }` when every
 * child reaches `finalState()`, and fail-fast aborts all remaining actors if any child fails with `'ERROR'`.
 *
 * @example
 * ```ts
 * import { all, createFSM, finalState } from '@matrix-fsm/core';
 *
 * const espressoFSM = createFSM<{ events: { OK: void }; states: 'pulling' }>()({
 *   id: 'espresso',
 *   initial: 'pulling',
 *   transitions: [['pulling', 'OK', finalState()]],
 * });
 * const milkFSM = createFSM<{ events: { OK: void }; states: 'steaming' }>()({
 *   id: 'milk',
 *   initial: 'steaming',
 *   transitions: [['steaming', 'OK', finalState()]],
 * });
 *
 * const latteFSM = createFSM<{ events: { BREW: void }; states: 'idle' | 'ready' | 'failed' }>()({
 *   id: 'latte',
 *   initial: 'idle',
 *   transitions: [
 *     ['idle',                   'BREW',     all(espressoFSM, milkFSM)],
 *     [all(espressoFSM, milkFSM), 'ALL_DONE', 'ready'],
 *     [all(espressoFSM, milkFSM), 'ERROR',    'failed'],
 *   ],
 * });
 * ```
 */
export function all<
  const TMachines extends readonly (AnyFSMDefinition | SubMachineRef<any, any>)[],
>(
  ...machines: TMachines
): AllNode<TMachines>;
/**
 * `Promise.all`-style parallel actor combinator accepting an array of child machines.
 *
 * @group Actor Combinators
 */
export function all<
  const TMachines extends readonly (AnyFSMDefinition | SubMachineRef<any, any>)[],
>(
  machines: TMachines,
): AllNode<TMachines>;
export function all(...args: any[]): AllNode<any> {
  return createCombinator('all', args as any);
}

/**
 * `Promise.race`-style parallel actor combinator for Column 3 (`TO`) and Column 1 (`FROM`).
 *
 * @group Actor Combinators
 * @param machines - Competing child FSM definitions (or aliased `subMachine(...)` refs).
 * @returns A frozen {@link RaceNode} combinator descriptor.
 *
 * @remarks
 * Spawns all actors simultaneously; as soon as the first actor reaches `finalState()`, its outcome
 * is forwarded to the parent and all losing actors are immediately aborted in the same tick.
 *
 * @example
 * ```ts
 * import { after, createFSM, finalState, race } from '@matrix-fsm/core';
 *
 * const fetchFSM = createFSM<{ events: { OK: void }; states: 'fetching' }>()({
 *   id: 'fetch',
 *   initial: 'fetching',
 *   transitions: [['fetching', 'OK', finalState()]],
 * });
 * const timeoutFSM = createFSM<{ events: never; states: 'waiting' }>()({
 *   id: 'timeout',
 *   initial: 'waiting',
 *   transitions: [['waiting', after(2000), finalState('TIMED_OUT')]],
 * });
 *
 * const guardedFetchFSM = createFSM<{ events: { START: void }; states: 'idle' | 'loaded' | 'timedOut' }>()({
 *   id: 'guardedFetch',
 *   initial: 'idle',
 *   transitions: [
 *     ['idle',                       'START',     race(fetchFSM, timeoutFSM)],
 *     [race(fetchFSM, timeoutFSM),   'DONE',      'loaded'],
 *     [race(fetchFSM, timeoutFSM),   'TIMED_OUT', 'timedOut'],
 *   ],
 * });
 * ```
 */
export function race<
  const TMachines extends readonly (AnyFSMDefinition | SubMachineRef<any, any>)[],
>(
  ...machines: TMachines
): RaceNode<TMachines>;
/**
 * `Promise.race`-style parallel actor combinator accepting an array of child machines.
 *
 * @group Actor Combinators
 */
export function race<
  const TMachines extends readonly (AnyFSMDefinition | SubMachineRef<any, any>)[],
>(
  machines: TMachines,
): RaceNode<TMachines>;
export function race(...args: any[]): RaceNode<any> {
  return createCombinator('race', args as any);
}

/**
 * `Promise.any`-style parallel actor combinator for Column 3 (`TO`) and Column 1 (`FROM`).
 *
 * @group Actor Combinators
 * @param machines - Redundant child FSM definitions (or aliased `subMachine(...)` refs).
 * @returns A frozen {@link AnyNode} combinator descriptor.
 *
 * @remarks
 * Spawns all actors simultaneously; resolves on the first child reaching a non-`'ERROR'` `finalState()`
 * (aborting remaining actors) and only dispatches `'ERROR'` if every child fails.
 */
export function any<
  const TMachines extends readonly (AnyFSMDefinition | SubMachineRef<any, any>)[],
>(
  ...machines: TMachines
): AnyNode<TMachines>;
/**
 * `Promise.any`-style parallel actor combinator accepting an array of child machines.
 *
 * @group Actor Combinators
 */
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

/**
 * Type guard checking whether `value` is an {@link AwaitingNode} created by {@link awaiting}.
 *
 * @group Runtime Type Guards
 */
export function isAwaitingNode(value: unknown): value is AwaitingNode<string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as AwaitingNode).__type === 'awaiting'
  );
}

/**
 * Type guard checking whether `value` is an {@link OutcomeNode} created by {@link outcome}.
 *
 * @group Runtime Type Guards
 */
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

/**
 * Type guard checking whether `value` is a {@link StayNode} created by {@link stay}.
 *
 * @group Runtime Type Guards
 */
export function isStayNode(value: unknown): value is StayNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as StayNode).__type === 'stay'
  );
}

/**
 * Type guard checking whether `value` is an {@link AnyStateNode} created by {@link anyState}.
 *
 * @group Runtime Type Guards
 */
export function isAnyStateNode(value: unknown): value is AnyStateNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as AnyStateNode).__type === 'anyState'
  );
}

/**
 * Type guard checking whether `value` is a {@link FinalNode} created by {@link finalState}.
 *
 * @group Runtime Type Guards
 */
export function isFinalNode(value: unknown): value is FinalNode<string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as FinalNode).__type === 'finalState'
  );
}

/**
 * Type guard checking whether `value` is an {@link AfterNode} created by {@link after}.
 *
 * @group Runtime Type Guards
 */
export function isAfterNode(value: unknown): value is AfterNode<number, any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as AfterNode).__type === 'after'
  );
}

/**
 * Type guard checking whether `value` is an {@link EveryNode} created by {@link every}.
 *
 * @group Runtime Type Guards
 */
export function isEveryNode(value: unknown): value is EveryNode<any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as EveryNode).__type === 'every'
  );
}

/**
 * Type guard checking whether `value` is an {@link AlwaysNode} created by {@link always}.
 *
 * @group Runtime Type Guards
 */
export function isAlwaysNode(value: unknown): value is AlwaysNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as AlwaysNode).__type === 'always'
  );
}

/**
 * Type guard checking whether `value` is a {@link SubMachineRef} created by {@link subMachine}.
 *
 * @group Runtime Type Guards
 */
export function isSubMachineRef(
  value: unknown,
): value is SubMachineRef<AnyFSMDefinition, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as SubMachineRef).__type === 'subMachine'
  );
}

/**
 * Type guard checking whether `value` is an {@link EachNode} created by {@link each}.
 *
 * @group Runtime Type Guards
 */
export function isEachNode(
  value: unknown,
): value is EachNode<string, AnyFSMDefinition> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as EachNode).__type === 'each'
  );
}

/**
 * Type guard checking whether `value` is a {@link CombinatorNode} (`all`, `race`, or `any`).
 *
 * @group Runtime Type Guards
 */
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

/**
 * Type guard checking whether `value` is a compiled {@link FSMDefinition}.
 *
 * @group Runtime Type Guards
 */
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
