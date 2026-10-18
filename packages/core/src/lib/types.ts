/**
 * @matrix-fsm/core - Core Type Definitions & Compile-Time Extractors
 * 0% Angular, 100% Pure TypeScript
 */

export type ReadonlyContext<T> = [0] extends [1 & T] ? any : Readonly<T>;

export interface AwaitingNode<TState extends string = string> {
  readonly __type: 'awaiting';
  readonly state: TState;
}

export interface StayNode {
  readonly __type: 'stay';
}

export interface FinalNode<TOutcome extends string = string> {
  readonly __type: 'finalState';
  readonly outcome: TOutcome;
}

export interface SubMachineRef<
  TFSM extends AnyFSMDefinition = AnyFSMDefinition,
  TId extends string = string,
> {
  readonly __type: 'subMachine';
  readonly id: TId;
  readonly machine: TFSM;
}

export interface EachNode<
  TKey extends string = string,
  TFSM extends AnyFSMDefinition = AnyFSMDefinition,
> {
  readonly __type: 'each';
  readonly id: `each:${TKey}`;
  readonly key: TKey;
  readonly machine: TFSM;
}

/**
 * Branded marker used when `transitions<TContext>([...])` is called with an explicit
 * single type parameter so spreading into `createFSM` never widens literal state/event unions to `string`.
 * Uses contravariant `__contextFn` so `ExtractedMarker<AuthContext>` is assignable to `TransitionFrom`
 * even when `context` uses `satisfies AuthContext`.
 */
export interface ExtractedMarker<TContext = any> {
  readonly __extractedBrand: unique symbol;
  readonly __contextFn?: (ctx: TContext) => void;
}

export type PatchResult<TContext> = [0] extends [1 & TContext]
  ? Record<string, any>
  : {
      readonly [K in keyof TContext]?: unknown;
    };

export interface TransitionOptions<TContext = any, TPayload = any> {
  readonly guard?: (
    ctx: ReadonlyContext<TContext>,
    eventPayload?: TPayload,
  ) => boolean;
  readonly patch?: (
    ctx: ReadonlyContext<TContext>,
    eventPayload?: TPayload,
  ) => PatchResult<TContext>;
}

export type TransitionFrom<
  TState extends string = string,
  TContext = any,
> =
  | TState
  | SubMachineRef<any, any>
  | EachNode<any, any>
  | ExtractedMarker<TContext>;

export type BuiltInLifecycleEvent = 'DONE' | 'ERROR' | 'ALL_DONE';

export type TransitionVia<
  TEvent extends string = string,
  TContext = any,
> =
  | TEvent
  | BuiltInLifecycleEvent
  | (string & {})
  | ExtractedMarker<TContext>;

export type TransitionTo<
  TState extends string = string,
  TContext = any,
> =
  | TState
  | AwaitingNode<string>
  | StayNode
  | FinalNode<string>
  | SubMachineRef<any, any>
  | EachNode<any, any>
  | ExtractedMarker<TContext>;

export type TransitionRow<
  TContext = any,
  TEvent extends string = string,
  TState extends string = string,
> = readonly [
  from: TransitionFrom<TState, TContext>,
  via: TransitionVia<TEvent, TContext>,
  to: TransitionTo<TState, TContext>,
  options?: TransitionOptions<TContext, any>,
];

export type ExtractedTransitionRow<TContext = any> = readonly [
  from: ExtractedMarker<TContext>,
  via: ExtractedMarker<TContext>,
  to: ExtractedMarker<TContext>,
  options?: TransitionOptions<TContext, any>,
];

export type AnyTransitionRow<TContext = any> = TransitionRow<
  TContext,
  any,
  any
>;

export interface FSMConfig<
  TId extends string,
  TInitial extends string,
  TContext extends object,
  TEvents extends Record<string, any>,
  TTransitions extends readonly AnyTransitionRow<TContext>[],
> {
  readonly id: TId;
  readonly initial: TInitial;
  readonly context: TContext;
  readonly events?: TEvents;
  readonly transitions: TTransitions;
}

export interface TransitionEvaluation<
  TState extends string = string,
  TContext extends object = Record<string, unknown>,
> {
  readonly matched: boolean;
  readonly from: string;
  readonly via: string;
  readonly nextState: TState;
  readonly nextContext: TContext;
  readonly patchApplied: Partial<TContext> | null;
  readonly stayed: boolean;
  readonly isAwaiting: boolean;
  readonly finalOutcome: string | null;
  readonly enteredSubMachine: SubMachineRef<any, any> | null;
  readonly exitedSubMachine: SubMachineRef<any, any> | null;
  readonly enteredEach: EachNode<any, any> | null;
}

export interface FSMDefinition<
  TId extends string = string,
  TInitial extends string = string,
  TContext extends object = any,
  TEvents extends Record<string, any> = Record<string, any>,
  TTransitions extends readonly AnyTransitionRow<any>[] = readonly AnyTransitionRow<any>[],
> {
  readonly id: TId;
  readonly initial: TInitial;
  readonly context: TContext;
  readonly events: TEvents;
  readonly transitions: TTransitions;
  readonly states: ReadonlySet<string>;
  readonly awaitingStates: ReadonlySet<string>;
  readonly subMachines: ReadonlyMap<string, SubMachineRef<any, any>>;
  readonly eachNodes: ReadonlyMap<string, EachNode<any, any>>;
  evaluate(
    currentState: string,
    event: string,
    payload: unknown,
    currentContext: Readonly<TContext>,
  ): TransitionEvaluation<
    ExtractStatesFromConfig<TInitial, TTransitions>,
    TContext
  >;
  hasTransitionFor(state: string, event: string): boolean;
}

export type AnyFSMDefinition = FSMDefinition<any, any, any, any, any>;

// ============================================================================
// Type-Level Extractors
// ============================================================================

type UnwrapReadonly<T> = T extends Readonly<infer U> ? U : T;

type ExtractContextFromRow<Row> =
  Row extends readonly [ExtractedMarker<infer C>, ...any[]]
    ? C extends object
      ? C
      : never
    : Row extends readonly [any, any, SubMachineRef<FSMDefinition<any, any, infer C, any, any>, any>, ...any[]]
      ? [0] extends [1 & C]
        ? never
        : C extends object
          ? C
          : never
      : Row extends readonly [any, any, any, { readonly guard: (ctx: infer C, ...args: any[]) => boolean }]
        ? [0] extends [1 & C]
          ? never
          : UnwrapReadonly<C> extends object
            ? UnwrapReadonly<C>
            : never
        : never;

type ExtractContextFromTransitions<TTransitions extends readonly any[]> =
  TTransitions[number] extends infer Row
    ? ExtractContextFromRow<Row>
    : never;

export type ResolveContext<
  TContext extends object,
  TTransitions extends readonly any[],
> = [ExtractContextFromTransitions<TTransitions>] extends [never]
  ? TContext
  : ExtractContextFromTransitions<TTransitions>;

type ExtractFromTarget<T> = T extends ExtractedMarker<any>
  ? never
  : T extends AwaitingNode<infer S>
    ? S
    : T extends FinalNode<infer O>
      ? O
      : T extends SubMachineRef<any, infer Id>
        ? Id
        : T extends EachNode<infer K, any>
          ? `each:${K}`
          : T extends StayNode
            ? never
            : T extends string
              ? T
              : never;

type ExtractFromSource<T> = T extends ExtractedMarker<any>
  ? never
  : T extends SubMachineRef<any, infer Id>
    ? Id
    : T extends EachNode<infer K, any>
      ? `each:${K}`
      : T extends string
        ? T
        : never;

export type ExtractStatesFromConfig<
  TInitial extends string,
  TTransitions extends readonly AnyTransitionRow<any>[],
> =
  | TInitial
  | ExtractFromSource<TTransitions[number][0]>
  | ExtractFromTarget<TTransitions[number][2]>;

export type ExtractStates<TFSM> =
  TFSM extends FSMDefinition<
    any,
    infer TInitial,
    any,
    any,
    infer TTransitions
  >
    ? ExtractStatesFromConfig<TInitial, TTransitions>
    : never;

export type ExtractContext<TFSM> =
  TFSM extends FSMDefinition<any, any, infer TContext, any, any>
    ? TContext
    : never;

export type ExtractEventsMap<TFSM> =
  TFSM extends FSMDefinition<any, any, any, infer TEvents, any>
    ? TEvents
    : Record<string, any>;

type ExtractSubMachinesFromTransitions<
  TTransitions extends readonly AnyTransitionRow<any>[],
> = TTransitions[number] extends infer Row
  ? Row extends readonly [infer From, any, infer To, ...any[]]
    ?
        | (From extends SubMachineRef<infer Sub1, any> ? Sub1 : never)
        | (To extends SubMachineRef<infer Sub2, any> ? Sub2 : never)
    : never
  : never;

export type ExtractEvents<TFSM> =
  TFSM extends FSMDefinition<any, any, any, infer TEvents, infer TTransitions>
    ?
        | Extract<keyof TEvents, string>
        | Exclude<
            TTransitions[number][1] extends infer V
              ? V extends ExtractedMarker<any>
                ? never
                : V extends string
                  ? V
                  : never
              : never,
            BuiltInLifecycleEvent
          >
        | ExtractEvents<ExtractSubMachinesFromTransitions<TTransitions>>
    : never;

export type ExtractEventPayload<
  TFSM,
  TEvent extends string,
> = TFSM extends FSMDefinition<any, any, any, infer TEvents, infer TTransitions>
  ? TEvent extends keyof TEvents
    ? TEvents[TEvent]
    : ExtractSubMachinesFromTransitions<TTransitions> extends infer Sub
      ? [Sub] extends [never]
        ? unknown
        : Sub extends FSMDefinition<any, any, any, infer TSubEvents, any>
          ? TEvent extends keyof TSubEvents
            ? TSubEvents[TEvent]
            : unknown
          : unknown
      : unknown
  : unknown;

/**
 * Extracts all `awaiting('stateName')` states from an FSM definition (including nested `subMachine`s).
 * Detects both direct `AwaitingNode<S>` in Column 3 AND states in Column 1 that
 * transition via `'DONE'` or `'ERROR'` (so extracted `transitions<TContext>([...])` groups
 * still preserve compile-time task enforcement).
 */
type ExtractDirectAwaiting<TTransitions extends readonly AnyTransitionRow<any>[]> =
  TTransitions[number] extends infer Row
    ? Row extends readonly [any, any, AwaitingNode<infer S>, ...any[]]
      ? S
      : never
    : never;

type ExtractDoneSourceStates<TTransitions extends readonly AnyTransitionRow<any>[]> =
  TTransitions[number] extends infer Row
    ? Row extends readonly [infer From, 'DONE' | 'ERROR', ...any[]]
      ? From extends ExtractedMarker<any>
        ? never
        : From extends SubMachineRef<any, any>
          ? never
          : From extends EachNode<any, any>
            ? never
            : From extends string
              ? From
              : never
      : never
    : never;

export type ExtractAwaitingNodesFromTransitions<
  TTransitions extends readonly AnyTransitionRow<any>[],
> =
  | ExtractDirectAwaiting<TTransitions>
  | ExtractDoneSourceStates<TTransitions>
  | ExtractAwaitingNodes<ExtractSubMachinesFromTransitions<TTransitions>>;

export type ExtractAwaitingNodes<TFSM> =
  TFSM extends FSMDefinition<any, any, any, any, infer TTransitions>
    ? ExtractAwaitingNodesFromTransitions<TTransitions>
    : never;

/**
 * Enforces that every `awaiting('x')` state in the FSM has a corresponding
 * task implementation in the SignalStore's `tasks` block.
 */
export type RequiredTasksMap<
  TFSM extends AnyFSMDefinition,
  TTaskResult = Promise<Partial<ExtractContext<TFSM>> | void>,
> = {
  readonly [K in ExtractAwaitingNodes<TFSM>]: (
    ctx: Readonly<ExtractContext<TFSM>>,
    signal: AbortSignal,
  ) => TTaskResult;
};
