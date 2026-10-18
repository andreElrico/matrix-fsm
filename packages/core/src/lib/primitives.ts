/**
 * @matrix-fsm/core - Matrix DSL Primitives & Markers
 */

import { createFSM } from './fsm.js';
import type {
  AnyFSMDefinition,
  AnyTransitionRow,
  AwaitingNode,
  EachNode,
  ExtractedTransitionRow,
  FinalNode,
  FSMConfig,
  FSMDefinition,
  StayNode,
  SubMachineRef,
  TransitionRow,
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

/**
 * Terminal state marker for sub-machine or workflow outcomes.
 */
export function finalState<const TOutcome extends string>(
  outcome: TOutcome,
): FinalNode<TOutcome> {
  return Object.freeze({
    __type: 'finalState' as const,
    outcome,
  });
}

/**
 * Zero-cost identity macro wrapper (`x => x`) used to extract large transition groups (> 3 rows)
 * into a variable or separate file while preserving full TypeScript context inference
 * and ESLint AST detection.
 */
export function transitions<
  const TRows extends readonly TransitionRow<any, any, any, any>[],
>(rows: TRows): TRows;
export function transitions<TContext, TMethods = any>(
  rows: readonly TransitionRow<TContext, any, any, TMethods>[],
): readonly ExtractedTransitionRow<TContext, TMethods>[];
export function transitions<TContext, TMethods = any>(): <
  const TRows extends readonly TransitionRow<TContext, any, any, TMethods>[],
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
 * Compatibility helper for wrapping a child FSM definition or config as a `SubMachineRef`.
 * Note: In Matrix-FSM V1, `createFSM` definitions can be passed directly into
 * Column 1 (`FROM`), Column 3 (`TO`), or `each()` without needing `subMachine()`.
 */
export function subMachine<
  TId extends string,
  TInitial extends string,
  TContext extends object = Record<string, any>,
  TEvents extends Record<string, any> = Record<string, any>,
  const TTransitions extends readonly AnyTransitionRow<TContext, any>[] =
    readonly AnyTransitionRow<TContext, any>[],
  TMethods = Record<string, any>,
>(
  configOrFSM:
    | FSMDefinition<TId, TInitial, TContext, TEvents, TTransitions, TMethods>
    | FSMConfig<TId, TInitial, TContext, TEvents, TTransitions, string, TMethods>,
): SubMachineRef<
  FSMDefinition<TId, TInitial, TContext, TEvents, TTransitions, TMethods>,
  TId
> {
  const machine = isFSMDefinition(configOrFSM)
    ? configOrFSM
    : createFSM(configOrFSM);
  return Object.freeze({
    __type: 'subMachine' as const,
    id: machine.id,
    machine,
  });
}

/**
 * Parallel Master/Slave Orchestration marker.
 * Spawns an isolated `childFSM` instance for each ID in `ctx[contextArrayKey]`.
 * Automatically dispatches `'ALL_DONE'` to the parent machine when all instances are done.
 */
export function each<
  const TKey extends string,
  TFSM extends AnyFSMDefinition,
>(
  contextArrayKey: TKey,
  childFSM: TFSM | SubMachineRef<TFSM, any>,
): EachNode<TKey, TFSM> {
  const machine = (
    isSubMachineRef(childFSM) ? childFSM.machine : childFSM
  ) as TFSM;
  return Object.freeze({
    __type: 'each' as const,
    id: `each:${contextArrayKey}` as const,
    key: contextArrayKey,
    machine,
  });
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

export function isStayNode(value: unknown): value is StayNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as StayNode).__type === 'stay'
  );
}

export function isFinalNode(value: unknown): value is FinalNode<string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as FinalNode).__type === 'finalState'
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
