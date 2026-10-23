/**
 * @matrix-fsm/core - Core Type Definitions & Compile-Time Extractors
 * 0% Angular, 100% Pure TypeScript
 */

export type ReadonlyContext<T> = [0] extends [1 & T] ? any : Readonly<T>;

export type EmptyObject = Record<never, never>;

export type UnionToIntersection<U> = (
  U extends any ? (k: U) => void : never
) extends (k: infer I extends object) => void
  ? I
  : EmptyObject;

/**
 * Canonical named type contract for `createFSM<TContract>()({ ... })`.
 * Every facet is optional so a machine only declares what it directly uses (ISP).
 */
export interface FSMContract {
  readonly inputs?: Record<string, any>;
  readonly events?: Record<string, any>;
  readonly outputs?: Record<string, any>;
  readonly states?: string;
  readonly context?: object;
  readonly methods?: object;
  readonly input?: object;
  readonly output?: any;
}

export type ContractInput<T extends FSMContract> =
  T extends { readonly inputs: infer I extends object }
    ? [I] extends [never]
      ? EmptyObject
      : I
    : T extends { readonly input: infer I2 extends object }
      ? [I2] extends [never]
        ? EmptyObject
        : I2
      : EmptyObject;

export type ContractOutputs<T extends FSMContract> =
  T extends { readonly outputs: infer O extends Record<string, any> }
    ? [O] extends [never]
      ? EmptyObject
      : O
    : T extends { readonly output: infer O2 }
      ? [O2] extends [never]
        ? unknown
        : O2
      : EmptyObject;

export type ContractOutput<T extends FSMContract> = ContractOutputs<T>;

export type ContractEvents<T extends FSMContract> =
  T extends { readonly events: infer E extends Record<string, any> }
    ? [E] extends [never]
      ? Record<string, any>
      : E
    : Record<string, any>;

export type ContractStates<T extends FSMContract> =
  T extends { readonly states: infer S extends string }
    ? [S] extends [never]
      ? string
      : S
    : string;

export type ContractContext<T extends FSMContract> =
  T extends { readonly context: infer C extends object }
    ? [C] extends [never]
      ? EmptyObject
      : C
    : EmptyObject;

export type ContractMethods<T extends FSMContract> =
  T extends { readonly methods: infer M extends object }
    ? [M] extends [never]
      ? EmptyObject
      : M
    : EmptyObject;

export interface AwaitingNode<TState extends string = string> {
  readonly __type: 'awaiting';
  readonly state: TState;
}

export interface StayNode {
  readonly __type: 'stay';
}

export interface FinalNode<
  TOutcome extends string = string,
  TContext = any,
  TPayload = any,
> {
  readonly __type: 'finalState';
  readonly outcome: TOutcome;
  readonly __context?: TContext;
  payloadSelector?(ctx: ReadonlyContext<TContext>): TPayload;
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
 * Branded marker used when `transitions<...>([...])` is called with explicit
 * type parameters so spreading into `createFSM` never widens literal state/event unions to `string`.
 */
export interface ExtractedMarker<TContext = any, TMethods = any> {
  readonly __extractedBrand: unique symbol;
  readonly __contextFn?: (ctx: TContext, methods: TMethods) => void;
}

export type PatchResult<TContext> = [0] extends [1 & TContext]
  ? Record<string, any>
  : {
      readonly [K in keyof TContext]?: unknown;
    };

export type TransitionMethod<TPayload = any, TContext = any> = (
  payload: TPayload,
  ctx: ReadonlyContext<TContext>,
) => void;

export type TransitionCallSelector<
  TMethods = Record<string, any>,
  TPayload = any,
  TContext = any,
> =
  | ((
      methods: TMethods,
    ) =>
      | ((payload: TPayload, ctx: ReadonlyContext<TContext>) => void)
      | undefined)
  | Extract<keyof TMethods, string>;

export type AllowedOutputKey<TOutputs> =
  [0] extends [1 & TOutputs]
    ? string
    : TOutputs extends object
      ? string extends keyof TOutputs
        ? string
        : keyof TOutputs extends never
          ? string
          : Extract<keyof TOutputs, string>
      : string;

export interface TransitionOptions<
  TContext = any,
  TPayload = any,
  TMethods = any,
  TInput = any,
  TOutputs = EmptyObject,
> {
  readonly guard?: (
    ctx: ReadonlyContext<TContext>,
    eventPayload: TPayload,
  ) => boolean;
  /**
   * Store method selector invoked synchronously when this transition fires.
   * Example: `{ call: (m) => m._selectDrink }`
   */
  readonly call?: TransitionCallSelector<TMethods, TPayload, TContext>;
  /**
   * Pure context reducer function returning a partial context patch.
   */
  readonly patch?: (
    ctx: ReadonlyContext<TContext>,
    eventPayload: TPayload,
  ) => PatchResult<TContext>;
  /**
   * Explicit input mapper when transitioning into a sub-machine or `each()` pool.
   * Example: `{ input: (ctx) => ({ selectedDrink: ctx.selectedDrink }) }`
   */
  readonly input?: (
    ctx: ReadonlyContext<TContext>,
    eventPayload: TPayload,
  ) => TInput;
  /**
   * Emits an intermediate output event to the parent machine while keeping the sub-actor alive.
   * Example: `{ emit: 'CUPS_LOW' }`
   */
  readonly emit?:
    | AllowedOutputKey<TOutputs>
    | {
        readonly type: AllowedOutputKey<TOutputs>;
        readonly payload: (
          ctx: ReadonlyContext<TContext>,
          eventPayload: TPayload,
        ) => any;
      };
}

export type TransitionOptionsWithRequiredInput<
  TContext = any,
  TPayload = any,
  TMethods = any,
  TInput = any,
  TOutputs = EmptyObject,
> = TransitionOptions<TContext, TPayload, TMethods, TInput, TOutputs> & {
  readonly input: (
    ctx: ReadonlyContext<TContext>,
    eventPayload: TPayload,
  ) => TInput;
};

export type TransitionFrom<
  TState extends string = string,
  TContext = any,
  TMethods = any,
> =
  | TState
  | AnyFSMDefinition
  | SubMachineRef<any, any>
  | EachNode<any, any>
  | ExtractedMarker<TContext, TMethods>;

export type BuiltInLifecycleEvent = 'DONE' | 'ERROR' | 'ALL_DONE';

export type TransitionVia<
  TEvent extends string = string,
  TContext = any,
  TMethods = any,
> =
  | TEvent
  | BuiltInLifecycleEvent
  | ExtractedMarker<TContext, TMethods>;

export type TransitionTo<
  TState extends string = string,
  TContext = any,
  TMethods = any,
  TOutputs = EmptyObject,
> =
  | TState
  | AwaitingNode<TState>
  | StayNode
  | FinalNode<AllowedOutputKey<TOutputs>, TContext, any>
  | AnyFSMDefinition
  | SubMachineRef<any, any>
  | EachNode<any, any>
  | ExtractedMarker<TContext, TMethods>;

export type TransitionRow<
  TContext = any,
  TEvent extends string = string,
  TState extends string = string,
  TMethods = any,
  TOutputs = EmptyObject,
> =
  | readonly [
      from: TState | EachNode<any, any> | ExtractedMarker<TContext, TMethods>,
      via: TransitionVia<TEvent, TContext, TMethods>,
      to: TransitionTo<TState, TContext, TMethods, TOutputs>,
      options?: TransitionOptions<TContext, any, TMethods, any, TOutputs>,
    ]
  | readonly [
      from: AnyFSMDefinition | SubMachineRef<any, any>,
      via: string,
      to: TransitionTo<TState, TContext, TMethods, TOutputs>,
      options?: TransitionOptions<TContext, any, TMethods, any, TOutputs>,
    ];

export type ExtractedTransitionRow<
  TContext = any,
  TMethods = any,
> = readonly [
  from: ExtractedMarker<TContext, TMethods>,
  via: ExtractedMarker<TContext, TMethods>,
  to: ExtractedMarker<TContext, TMethods>,
  options?: TransitionOptions<TContext, any, TMethods>,
];

export type AnyTransitionRow<
  TContext = any,
  TMethods = any,
> = TransitionRow<TContext, any, any, TMethods, any>;

export interface FSMConfig<
  TId extends string,
  TInitial extends TStates,
  TContext extends object = EmptyObject,
  TEvents extends Record<string, any> = Record<string, any>,
  TTransitions extends readonly AnyTransitionRow<TContext, any>[] =
    readonly AnyTransitionRow<TContext, any>[],
  TStates extends string = string,
  TMethods = EmptyObject,
> {
  readonly id: TId;
  readonly initial: TInitial;
  readonly context?: TContext;
  readonly events?: TEvents;
  readonly transitions: TTransitions;
}

export interface TransitionEvaluation<
  TState extends string = string,
  TContext extends object = Record<string, unknown>,
  TMethods = any,
> {
  readonly matched: boolean;
  readonly from: string;
  readonly via: string;
  readonly nextState: TState;
  readonly nextContext: TContext;
  readonly patchApplied: Partial<TContext> | null;
  readonly callSelector: TransitionCallSelector<TMethods, any, TContext> | null;
  readonly inputMapped: Record<string, unknown> | null;
  readonly stayed: boolean;
  readonly isAwaiting: boolean;
  readonly finalOutcome: string | null;
  readonly finalPayload?: unknown;
  readonly hasFinalPayloadSelector?: boolean;
  readonly emittedOutput?: {
    readonly type: string;
    readonly payload: unknown;
  } | null;
  readonly enteredSubMachine: SubMachineRef<any, any> | null;
  readonly exitedSubMachine: SubMachineRef<any, any> | null;
  readonly enteredEach: EachNode<any, any> | null;
}

export interface FSMDefinition<
  TId extends string = string,
  TInitial extends string = string,
  TContext extends object = any,
  TEvents extends Record<string, any> = Record<string, any>,
  TTransitions extends readonly AnyTransitionRow<any, any>[] =
    readonly AnyTransitionRow<any, any>[],
  TMethods = any,
  TInput extends object = EmptyObject,
  TOutput = unknown,
> {
  readonly id: TId;
  readonly initial: TInitial;
  readonly context: TContext;
  readonly events: TEvents;
  readonly transitions: TTransitions;
  readonly __methodsBrand?: TMethods;
  readonly __inputBrand?: TInput;
  readonly __outputBrand?: TOutput;
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
    TContext,
    TMethods
  >;
  hasTransitionFor(state: string, event: string): boolean;
}

export type AnyFSMDefinition = FSMDefinition<
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any
>;

// ============================================================================
// Type-Level Extractors & Validators
// ============================================================================

type UnwrapReadonly<T> = T extends Readonly<infer U> ? U : T;

type IsConcreteFSM<T> =
  [0] extends [1 & T]
    ? false
    : T extends FSMDefinition<infer TId, any, any, any, any, any, any, any>
      ? [0] extends [1 & TId]
        ? false
        : string extends TId
          ? false
          : true
      : false;

type IsSubMachineNode<T> =
  [0] extends [1 & T]
    ? false
    : T extends SubMachineRef<any, any>
      ? true
      : IsConcreteFSM<T>;

type IsDefaultOrUntypedObject<T> =
  [0] extends [1 & T]
    ? true
    : T extends object
      ? string extends keyof T
        ? true
        : keyof T extends never
          ? true
          : false
      : true;

type FilterConcreteObjects<U> = U extends any
  ? IsDefaultOrUntypedObject<U> extends true
    ? never
    : U
  : never;

export type MergeExtractedObjects<U, TFallback = EmptyObject> =
  [FilterConcreteObjects<U>] extends [never]
    ? TFallback
    : UnionToIntersection<FilterConcreteObjects<U>>;

type ExtractContextFromRow<Row> =
  Row extends readonly [ExtractedMarker<infer C, any>, ...any[]]
    ? IsDefaultOrUntypedObject<C> extends true
      ? never
      : C extends object
        ? C
        : never
    : Row extends readonly [
          any,
          any,
          any,
          { readonly guard: (ctx: infer C, ...args: any[]) => boolean },
        ]
      ? [0] extends [1 & C]
        ? never
        : IsDefaultOrUntypedObject<UnwrapReadonly<C>> extends true
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
> = IsDefaultOrUntypedObject<TContext> extends false
  ? TContext
  : [ExtractContextFromTransitions<TTransitions>] extends [never]
    ? EmptyObject
    : MergeExtractedObjects<ExtractContextFromTransitions<TTransitions>, EmptyObject>;

export type SubMachineNodeId<T> =
  [0] extends [1 & T]
    ? never
    : T extends SubMachineRef<any, infer Id>
      ? Id
      : T extends FSMDefinition<infer Id, any, any, any, any, any, any, any>
        ? Id
        : never;

export type ExtractOutputsMap<TFSM> =
  TFSM extends FSMDefinition<any, any, any, any, any, any, any, infer TOutput>
    ? IsDefaultOrUntypedObject<TOutput> extends true
      ? EmptyObject
      : TOutput extends Record<string, any>
        ? TOutput
        : EmptyObject
    : TFSM extends SubMachineRef<infer Inner, any>
      ? ExtractOutputsMap<Inner>
      : EmptyObject;

export type ExtractOutputKeys<TFSM> = Extract<
  keyof ExtractOutputsMap<TFSM>,
  string
>;

type HandledEventsForSubMachineId<
  TSubId extends string,
  TTransitions extends readonly any[],
> = [0] extends [1 & TTransitions]
  ? never
  : TTransitions[number] extends infer Row
    ? Row extends readonly [infer RFrom, infer RVia extends string, ...any[]]
      ? SubMachineNodeId<RFrom> extends TSubId
        ? [SubMachineNodeId<RFrom>] extends [never]
          ? never
          : RVia
        : RFrom extends TSubId
          ? RVia
          : never
      : never
    : never;

export type MissingSubMachineOutputs<
  To,
  TTransitions extends readonly any[],
> = IsSubMachineNode<To> extends true
  ? Exclude<
      ExtractOutputKeys<To>,
      HandledEventsForSubMachineId<SubMachineNodeId<To>, TTransitions>
    >
  : never;

export type ValidateSubMachineOutputs<
  To,
  TTransitions extends readonly any[],
> = [MissingSubMachineOutputs<To, TTransitions>] extends [never]
  ? To
  : {
      readonly __error: 'Unhandled sub-machine outputs in parent transitions';
      readonly missingOutputs: MissingSubMachineOutputs<To, TTransitions>;
    };

type HasRequiredSubMachineInput<To> =
  IsSubMachineNode<To> extends true
    ? IsDefaultOrUntypedObject<ExtractInput<To>> extends false
      ? true
      : false
    : false;

type AllowedSubInput<To> =
  IsSubMachineNode<To> extends true
    ? IsDefaultOrUntypedObject<ExtractInput<To>> extends false
      ? ExtractInput<To>
      : any
    : any;

type AllowedSubMachineVia<From, TEvent extends string> =
  | ([ExtractFinalOutcomes<From> | ExtractOutputKeys<From>] extends [never]
      ? 'DONE'
      : ExtractFinalOutcomes<From> | ExtractOutputKeys<From>)
  | 'ERROR'
  | TEvent;

type ResolveSubMachineOutputPayload<From, Via> =
  Via extends keyof ExtractOutputsMap<From>
    ? [ExtractOutputsMap<From>[Via]] extends [void | undefined]
      ? any
      : ExtractOutputsMap<From>[Via]
    : any;

type ValidateRowOptions<
  Rest extends readonly any[],
  TContext,
  TPayload,
  TMethods,
  To,
  TOutputs,
> = HasRequiredSubMachineInput<To> extends true
  ? [
      options: TransitionOptionsWithRequiredInput<
        TContext,
        TPayload,
        TMethods,
        ExtractInput<To>,
        TOutputs
      >,
    ]
  : Rest extends readonly [any]
    ? [
        options?: TransitionOptions<
          TContext,
          TPayload,
          TMethods,
          AllowedSubInput<To>,
          TOutputs
        >,
      ]
    : [];

/**
 * Validates each row of a `transitions` array:
 * 1. When `TO` is a sub-machine with declared `inputs`, requires `{ input: (ctx) => SubInputs }`.
 * 2. When `TO` is a sub-machine with declared `outputs`, enforces compile-time output exhaustiveness (`ValidateSubMachineOutputs`).
 * 3. When `FROM` is a concrete sub-machine (`baristaFSM`), strictly restricts `VIA` to
 *    `ExtractFinalOutcomes<From> | ExtractOutputKeys<From> | 'DONE' | 'ERROR' | TEvent`
 *    and types `call: (m) => m._handler` with the exact payload declared in `outputs[OutputKey]`.
 */
export type ValidateTransitionRows<
  TTransitions extends readonly any[],
  TContext = any,
  TEvent extends string = string,
  TMethods = any,
  TOutputs = EmptyObject,
> = {
  readonly [K in keyof TTransitions]: TTransitions[K] extends readonly [
    infer From,
    infer Via,
    infer To,
    ...(infer Rest),
  ]
    ? IsSubMachineNode<From> extends true
      ? readonly [
          from: From,
          via: AllowedSubMachineVia<From, TEvent>,
          to: ValidateSubMachineOutputs<To, TTransitions>,
          ...ValidateRowOptions<
            Rest,
            TContext,
            ResolveSubMachineOutputPayload<From, Via>,
            TMethods,
            To,
            TOutputs
          >,
        ]
      : IsSubMachineNode<To> extends true
        ? readonly [
            from: From,
            via: Via,
            to: ValidateSubMachineOutputs<To, TTransitions>,
            ...ValidateRowOptions<
              Rest,
              TContext,
              any,
              TMethods,
              To,
              TOutputs
            >,
          ]
        : TTransitions[K]
    : TTransitions[K];
};

type ExtractFromTarget<T> = T extends ExtractedMarker<any, any>
  ? never
  : T extends AwaitingNode<infer S>
    ? S
    : T extends FinalNode<any, any, any>
      ? never
      : T extends SubMachineRef<any, infer Id>
        ? Id
        : IsConcreteFSM<T> extends true
          ? T extends FSMDefinition<infer Id, any, any, any, any, any, any, any>
            ? Id
            : never
          : T extends EachNode<infer K, any>
            ? `each:${K}`
            : T extends StayNode
              ? never
              : T extends string
                ? T
                : never;

type ExtractFromSource<T> = T extends ExtractedMarker<any, any>
  ? never
  : T extends SubMachineRef<any, infer Id>
    ? Id
    : IsConcreteFSM<T> extends true
      ? T extends FSMDefinition<infer Id, any, any, any, any, any, any, any>
        ? Id
        : never
      : T extends EachNode<infer K, any>
        ? `each:${K}`
        : T extends string
          ? T
          : never;

export type ExtractStatesFromConfig<
  TInitial extends string,
  TTransitions extends readonly AnyTransitionRow<any, any>[],
> =
  | TInitial
  | ExtractFromSource<TTransitions[number][0]>
  | ExtractFromTarget<TTransitions[number][2]>;

type ExtractSubMachineFromNode<Node> =
  [0] extends [1 & Node]
    ? never
    : Node extends SubMachineRef<infer Sub, any>
      ? IsConcreteFSM<Sub> extends true
        ? Sub
        : never
      : IsConcreteFSM<Node> extends true
        ? Node
        : Node extends EachNode<any, infer EachSub>
          ? IsConcreteFSM<EachSub> extends true
            ? EachSub
            : never
          : never;

type ExtractDirectSubMachinesFromTransitions<
  TTransitions extends readonly AnyTransitionRow<any, any>[],
> = [0] extends [1 & TTransitions]
  ? never
  : TTransitions[number] extends infer Row
    ? [0] extends [1 & Row]
      ? never
      : Row extends readonly [infer From, any, infer To, ...any[]]
        ? ExtractSubMachineFromNode<From> | ExtractSubMachineFromNode<To>
        : never
    : never;

type ExtractDirectSubMachines<TFSM> =
  TFSM extends FSMDefinition<any, any, any, any, infer TTransitions, any, any, any>
    ? ExtractDirectSubMachinesFromTransitions<TTransitions>
    : never;

export type ExtractAllSubMachines<TFSM> =
  | ExtractDirectSubMachines<TFSM>
  | ExtractDirectSubMachines<ExtractDirectSubMachines<TFSM>>;

export type ExtractOwnStates<TFSM> =
  TFSM extends FSMDefinition<
    any,
    infer TInitial,
    any,
    any,
    infer TTransitions,
    any,
    any,
    any
  >
    ? ExtractStatesFromConfig<TInitial, TTransitions>
    : never;

export type ExtractStates<TFSM> =
  | ExtractOwnStates<TFSM>
  | ExtractOwnStates<ExtractAllSubMachines<TFSM>>;

export type ExtractOwnContext<TFSM> =
  TFSM extends FSMDefinition<any, any, infer TContext, any, any, any, any, any>
    ? TContext
    : EmptyObject;

/**
 * Extracts the machine's own encapsulated context (Scope Invariant: child contexts do NOT leak into parent!).
 */
export type ExtractContext<TFSM> =
  TFSM extends FSMDefinition<any, any, infer TContext, any, any, any, any, any>
    ? [0] extends [1 & TContext]
      ? Record<string, any>
      : IsDefaultOrUntypedObject<TContext> extends true
        ? EmptyObject
        : TContext
    : EmptyObject;

export type ExtractAllContext<TFSM> =
  TFSM extends FSMDefinition<any, any, infer TContext, any, any, any, any, any>
    ? [0] extends [1 & TContext]
      ? Record<string, any>
      : MergeExtractedObjects<
          ExtractOwnContext<TFSM> | ExtractOwnContext<ExtractAllSubMachines<TFSM>>,
          EmptyObject
        >
    : EmptyObject;

export type ExtractOwnMethods<TFSM> =
  TFSM extends FSMDefinition<any, any, any, any, any, infer TMethods, any, any>
    ? TMethods
    : EmptyObject;

/**
 * Extracts the machine's own methods (Scope Invariant: child private methods do NOT leak into parent!).
 */
export type ExtractMethods<TFSM> = MergeExtractedObjects<
  ExtractOwnMethods<TFSM>,
  EmptyObject
>;

export type ExtractAllMethods<TFSM> = MergeExtractedObjects<
  ExtractOwnMethods<TFSM> | ExtractOwnMethods<ExtractAllSubMachines<TFSM>>,
  EmptyObject
>;

export type ExtractInput<TFSM> =
  TFSM extends FSMDefinition<any, any, any, any, any, any, infer TInput, any>
    ? TInput
    : TFSM extends SubMachineRef<infer Inner, any>
      ? ExtractInput<Inner>
      : EmptyObject;

export type ExtractOutput<TFSM> =
  TFSM extends FSMDefinition<any, any, any, any, any, any, any, infer TOutput>
    ? TOutput
    : TFSM extends SubMachineRef<infer Inner, any>
      ? ExtractOutput<Inner>
      : unknown;

export type ExtractEventsMap<TFSM> =
  TFSM extends FSMDefinition<any, any, any, infer TEvents, any, any, any, any>
    ? TEvents
    : Record<string, any>;

export type ExtractFinalOutcomesFromTransitions<
  TTransitions extends readonly AnyTransitionRow<any, any>[],
> = TTransitions[number] extends infer Row
  ? Row extends readonly [any, any, FinalNode<infer O, any, any>, ...any[]]
    ? O
    : never
  : never;

/**
 * Extracts all `finalState('OUTCOME_NAME')` string literals from an FSM definition.
 */
export type ExtractFinalOutcomes<TFSM> =
  TFSM extends FSMDefinition<any, any, any, any, infer TTransitions, any, any, any>
    ? ExtractFinalOutcomesFromTransitions<TTransitions>
    : TFSM extends SubMachineRef<infer Inner, any>
      ? ExtractFinalOutcomes<Inner>
      : never;

export type OutcomesOf<TFSM> = ExtractFinalOutcomes<TFSM>;

type ExtractRowEvent<Row> =
  Row extends readonly [infer From, infer Via, ...any[]]
    ? Via extends ExtractedMarker<any, any>
      ? never
      : Via extends string
        ? IsSubMachineNode<From> extends true
          ? Exclude<
              Via,
              BuiltInLifecycleEvent | ExtractFinalOutcomes<From> | ExtractOutputKeys<From>
            >
          : Exclude<Via, BuiltInLifecycleEvent>
        : never
    : never;

type ExtractShallowEvents<TFSM> =
  TFSM extends FSMDefinition<
    any,
    any,
    any,
    infer TEvents,
    infer TTransitions,
    any,
    any,
    any
  >
    ?
        | (string extends keyof TEvents
            ? never
            : Extract<keyof TEvents, string>)
        | ExtractRowEvent<TTransitions[number]>
    : never;

export type ExtractEvents<TFSM> =
  | ExtractShallowEvents<TFSM>
  | ExtractShallowEvents<ExtractAllSubMachines<TFSM>>;

export type ExtractEventPayload<
  TFSM,
  TEvent extends string,
> = TFSM extends FSMDefinition<any, any, any, infer TEvents, any, any, any, any>
  ? TEvent extends keyof TEvents
    ? string extends keyof TEvents
      ? unknown
      : TEvents[TEvent]
    : ExtractAllSubMachines<TFSM> extends infer Sub
      ? [Sub] extends [never]
        ? unknown
        : Sub extends FSMDefinition<any, any, any, infer TSubEvents, any, any, any, any>
          ? TEvent extends keyof TSubEvents
            ? string extends keyof TSubEvents
              ? unknown
              : TSubEvents[TEvent]
            : never
          : never
      : unknown
  : unknown;

/**
 * Extracts all `awaiting('stateName')` states from an FSM definition (including nested child machines).
 * Detects both direct `AwaitingNode<S>` in Column 3 AND states in Column 1 that
 * transition via `'DONE'` or `'ERROR'` (so extracted `transitions<...>([...])` groups
 * still preserve compile-time task enforcement).
 */
type ExtractDirectAwaiting<
  TTransitions extends readonly AnyTransitionRow<any, any>[],
> = [0] extends [1 & TTransitions]
  ? never
  : TTransitions[number] extends infer Row
    ? Row extends readonly [any, any, AwaitingNode<infer S>, ...any[]]
      ? string extends S
        ? never
        : S
      : never
    : never;

type ExtractDoneSourceStates<
  TTransitions extends readonly AnyTransitionRow<any, any>[],
> = [0] extends [1 & TTransitions]
  ? never
  : TTransitions[number] extends infer Row
    ? Row extends readonly [infer From, 'DONE' | 'ERROR', ...any[]]
      ? From extends ExtractedMarker<any, any>
        ? never
        : From extends SubMachineRef<any, any>
          ? never
          : From extends FSMDefinition<any, any, any, any, any, any, any, any>
            ? never
            : From extends EachNode<any, any>
              ? never
              : From extends string
                ? string extends From
                  ? never
                  : From
                : never
      : never
    : never;

type ExtractShallowAwaitingFromTransitions<
  TTransitions extends readonly AnyTransitionRow<any, any>[],
> =
  | ExtractDirectAwaiting<TTransitions>
  | ExtractDoneSourceStates<TTransitions>;

type ExtractShallowAwaiting<TFSM> =
  TFSM extends FSMDefinition<any, any, any, any, infer TTransitions, any, any, any>
    ? ExtractShallowAwaitingFromTransitions<TTransitions>
    : never;

export type ExtractOwnAwaitingNodes<TFSM> = ExtractShallowAwaiting<TFSM>;

export type ExtractAwaitingNodesFromTransitions<
  TTransitions extends readonly AnyTransitionRow<any, any>[],
> =
  | ExtractShallowAwaitingFromTransitions<TTransitions>
  | ExtractShallowAwaiting<ExtractDirectSubMachinesFromTransitions<TTransitions>>;

export type ExtractAwaitingNodes<TFSM> =
  | ExtractShallowAwaiting<TFSM>
  | ExtractShallowAwaiting<ExtractAllSubMachines<TFSM>>;

/**
 * Enforces that every own `awaiting('x')` state in the FSM has a corresponding
 * task implementation in the SignalStore's `tasks` block.
 */
export type RequiredTasksMap<
  TFSM extends AnyFSMDefinition,
  TTaskResult = Promise<Partial<ExtractContext<TFSM>> | void>,
> = {
  readonly [K in ExtractOwnAwaitingNodes<TFSM>]: (
    ctx: Readonly<ExtractContext<TFSM>>,
    signal: AbortSignal,
  ) => TTaskResult;
};

// ============================================================================
// `transitions<...>()` Target Resolution Helpers
// ============================================================================

type IsFSMContractShape<T> =
  [0] extends [1 & T]
    ? false
    : T extends AnyFSMDefinition
      ? false
      : T extends object
        ? keyof T extends never
          ? true
          : Exclude<
                keyof T,
                | 'events'
                | 'states'
                | 'context'
                | 'methods'
                | 'input'
                | 'output'
                | 'inputs'
                | 'outputs'
              > extends never
            ? true
            : false
        : false;

export type ResolveTransitionsContext<T, TMethods = never> =
  [TMethods] extends [never]
    ? T extends AnyFSMDefinition
      ? ExtractContext<T>
      : IsFSMContractShape<T> extends true
        ? ContractContext<T & FSMContract>
        : T
    : T;

export type ResolveTransitionsMethods<T, TMethods = never> =
  [TMethods] extends [never]
    ? T extends AnyFSMDefinition
      ? ExtractMethods<T>
      : IsFSMContractShape<T> extends true
        ? ContractMethods<T & FSMContract>
        : Record<string, any>
    : TMethods;
