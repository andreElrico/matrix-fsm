# `@matrix-fsm` — Flat 2D Matrix State Machines for TypeScript & Angular SignalStore

`@matrix-fsm` is a type-safe, zero-JSON-hell Finite State Machine (FSM) and Actor orchestration architecture for TypeScript and `@ngrx/signals` (`SignalStore`), backed by compile-time graph validation and 15 AST/Graph ESLint rules.

Instead of deeply nested JSON statecharts, every machine is a **visual, column-aligned 2D transition table**:

```ts
/* FROM                 VIA               TO                            OPTIONS */
['customerBrowsing',    'SELECT_DRINK',   stay(),                       { call: (m) => m._selectDrink }],
['customerBrowsing',    'PLACE_ORDER',    awaiting('checkingLoyalty'),  { guard: hasSelectedDrink, call: (m) => m._checkLoyalty }],
['customerBrowsing',    'PLACE_ORDER',    stay(),                       { call: (m) => m._setMissingDrinkError }],
```

---

## Packages

| Package | Description |
| :--- | :--- |
| **`@matrix-fsm/core`** | Pure TypeScript (`0%` Angular) 4-column tuple DSL (`[FROM, VIA, TO, OPTIONS?]`), FIFO Run-to-Completion runner (`createMachineInstance`), Mermaid diagram exporter (`toMermaid`), BFS path analyzer (`getShortestPaths`), and recursive compile-time type extractors. |
| **`@matrix-fsm/angular`** | First-class `@ngrx/signals` integration (`createMachineFeature`, `withStateMachine`, `provideStateMachine`, `createFeatureTester`) with native `Promise` + `AbortSignal`, RxJS `Observable`, and Angular `ResourceRef` support. |
| **`@matrix-fsm/angular/effect`** | Optional secondary entrypoint (`createEffectMachineFeature`, `runEffect`) for Effect-TS `Effect.Effect<A, E>` fibers with automatic fiber interruption and `Data.TaggedError` (`_tag`) routing. |
| **`@matrix-fsm/router`** | Two-way URL synchronization (`withRouteMachine`) between SignalStore state machines and routes. |
| **`@matrix-fsm/eslint-plugin`** | 15 static AST & graph-conservation ESLint rules (including `eslint --fix` auto-alignment for 2D transition tables). |

---

## Public API Reference

### 1. Matrix DSL Primitives & Operators (`@matrix-fsm/core` & `@matrix-fsm/angular`)

Every transition row follows the 4-column tuple signature:
`[FROM, VIA, TO, OPTIONS?]`

| Operator / Function | Column | Signature | Description |
| :--- | :---: | :--- | :--- |
| **`stay()`** | `TO` (Col 3) | `stay(): StayNode` | Keeps the machine in its current state (`TO = FROM`), executes `call` / `output`, and **does not** trigger `onExit`/`onEnter` or cancel in-flight `awaiting()` tasks or timers. Mandatory for gatekeeper fallbacks and `every()` intervals. |
| **`awaiting(state)`** | `TO` (Col 3) / `FROM` (Col 1) | `awaiting(state: TState): AwaitingNode<TState>` | Marks `state` (must end with `-ing` by convention) as an asynchronous state. Entering it invokes `{ call: (m) => m._asyncTask }` with `(payload, abortSignal, ctx)` and automatically dispatches `'DONE'`, `'ERROR'`, an `outcome(...)` event, or a custom `Error.name` / `_tag` event upon completion. Leaving the state aborts `abortSignal` / unsubscribes RxJS / interrupts Effect fibers immediately. |
| **`outcome(event, payload?)`** | Task Return | `outcome(event: TEvent, payload?: TPayload): OutcomeNode<TEvent, TPayload>` | Returned from an `awaiting()` method to transition directly via a domain event name (`event`) instead of generic `'DONE'`. |
| **`anyState()`** | `FROM` (Col 1) | `anyState(): AnyStateNode` | Global wildcard source state. Evaluated in Pass 2 if no state-specific transition matched in Pass 1 (First-Match-Wins). |
| **`finalState(outcome?)`** | `TO` (Col 3) | `finalState(outcome?: TOutcome): FinalNode<TOutcome>` | Marks a terminal state (`'DONE'` by default, or a named void outcome like `finalState('CANCELLED')`). When a sub-machine reaches `finalState()`, it tears down and dispatches the outcome (or `{ output: ['EVENT', selector] }`) to its parent machine. |
| **`after(ms)`** | `VIA` (Col 2) | `after(ms: number \| ((ctx) => number)): AfterNode` | Declarative one-shot timeout. Starts automatically on entering `FROM` (including `initial`), transitions to `TO` (`stay()` is forbidden) after `ms`, and cleans up via `clearTimeout` on state exit. |
| **`every(ms)`** | `VIA` (Col 2) | `every(ms: number \| ((ctx) => number)): EveryNode` | Declarative recurring interval timer. Must target `stay()` in Column 3. Fires every `ms` while in `FROM`, dynamically adapts if `ctx` changes the duration, and clears on state exit. |
| **`always()`** | `VIA` (Col 2) | `always(): AlwaysNode` | Eventless (epsilon) synchronous transition evaluated immediately upon entering `FROM`. Protected against infinite loops via `MAX_SYNC_MICROSTEPS` (`100`). |
| **`each(key, childFSM)`** | `TO` (Col 3) / `FROM` (Col 1) | `each(contextArrayKey: TKey, childFSM: TFSM): EachNode<TKey, TFSM>` | Parallel 1:N Master/Slave orchestration. Spawns an isolated `childFSM` instance for every item in `ctx[key]` (passing the item into child context). Dispatches `'ALL_DONE'` (or `'DONE'`) with the ordered array of child results when all instances reach `finalState()`. |
| **`all(...machines)`** | `TO` (Col 3) / `FROM` (Col 1) | `all(...machines: TFSM[]): AllNode<TFSM>` | `Promise.all`-style parallel actor combinator. Spawns all child machines simultaneously, dispatches `'ALL_DONE'` with `{ [id]: payload }` when all succeed, and fail-fast aborts all remaining actors if any child terminates with `'ERROR'`. |
| **`race(...machines)`** | `TO` (Col 3) / `FROM` (Col 1) | `race(...machines: TFSM[]): RaceNode<TFSM>` | `Promise.race`-style parallel actor combinator. Spawns all child machines simultaneously; the first child to reach `finalState()` wins and immediately aborts all losers in the same tick. |
| **`any(...machines)`** | `TO` (Col 3) / `FROM` (Col 1) | `any(...machines: TFSM[]): AnyNode<TFSM>` | `Promise.any`-style parallel actor combinator. Resolves on the first child reaching a non-`'ERROR'` `finalState()` (aborting the rest) and only dispatches `'ERROR'` if every child fails. |
| **`transitions(rows)`** | Helper | `transitions<TContract>()(rows)` / `transitions(rows)` | Zero-cost identity helper (`x => x`) to extract large `[FROM, VIA]` groups (`> 3` rows, i.e. at least 4 rows) into a separate variable while preserving narrow literal types and ESLint checking. |
| **`subMachine(fsm)`** | `TO` / `FROM` | `subMachine(configOrFSM): SubMachineRef` | Optional wrapper for sub-machines. Note: Any `createFSM` or `createMachineFeature` definition can be placed **directly** in Column 1 (`FROM`) or Column 3 (`TO`) without `subMachine()`. |

---

### 2. Transition `OPTIONS` (Column 4)

The optional 4th tuple element `{ guard, call, input, output }` configures transition behavior:

```ts
interface TransitionOptions<TContext, TPayload, TMethods, TInput, TOutputs> {
  /** Pure synchronous predicate (0% DI). First row whose guard returns true wins. */
  readonly guard?: (ctx: Readonly<TContext>, eventPayload: TPayload) => boolean;

  /**
   * Single method selector on the store/feature `methods` map: `(m) => m._methodName`.
   * - On normal or `stay()` rows: executes synchronously `(payload, ctx) => void`.
   * - On `awaiting('...ing')` rows: starts the async task `(payload, signal: AbortSignal, ctx) => Promise | Observable | ResourceRef | Effect`.
   */
  readonly call?: (methods: TMethods) => Function;

  /** Maps parent `(ctx, eventPayload)` to strongly-typed `inputs` when entering a Sub-FSM, `each()`, or combinator. */
  readonly input?: (ctx: Readonly<TContext>, eventPayload: TPayload) => TInput;

  /**
   * Emits a strongly-typed intermediate or terminal output event to the parent machine.
   * Void shorthand: `'HEARTBEAT'` or `['HEARTBEAT']`.
   * With payload selector: `['COFFEE_READY', (ctx, eventPayload) => ({ drinkName: ctx.selectedDrink.name })]`.
   */
  readonly output?: keyof TOutputs | readonly [keyof TOutputs, ((ctx: Readonly<TContext>, eventPayload: TPayload) => any)?];
}
```

---

### 3. Machine Builders, SignalStore Features & Test Harness

#### `createMachineFeature<TContract>()(config)` (`@matrix-fsm/angular`)
The canonical **"Sandwich Pattern"** builder that combines:
1. **Public Contract** (`inputs`, `events`, `outputs`, `states`, `methods`) as pure TypeScript types at the top.
2. **Transition Matrix** (`id`, `initial`, `transitions`) in the middle (pure, 0% Angular DI).
3. **Encapsulated Runtime** (`state`, `syncContext`, `methods`, `onEnter`, `onExit`, `debug`, `inspect`) at the bottom.

Works seamlessly both as a **root SignalStore feature** (`signalStore(withStateMachine(myFeature))`) and as an **isolated sub-actor** (`store.actors.<id>()`) with zero parent state leakage.

#### `createEffectMachineFeature<TContract>()(config)` (`@matrix-fsm/angular/effect`)
Identical to `createMachineFeature`, except `awaiting()` methods can return `Effect.Effect<A, E, never>`. Automatically forks fibers via `Effect.runFork`, interrupts them on state exit/cancellation, infers `A` for `'DONE'`, and routes `E` via `'ERROR'` or `Data.TaggedError` `_tag` names in Column 2 (`VIA`).

#### `createFSM<TContract>()(config)` (`@matrix-fsm/core`)
Pure TypeScript (0% Angular) curried machine builder (`{ id, initial, transitions, context? }`). Can be run standalone via `createMachineInstance(fsm, hooks)` or mounted in Angular via `withStateMachine(fsm, { state, methods })`.

#### `withStateMachine(fsm, config?)` (`@matrix-fsm/angular`)
Custom `@ngrx/signals` `signalStoreFeature` that mounts a `createMachineFeature` or `createFSM` onto an Angular `SignalStore`.
- Automatically registers `state` signals on the store (`store.<prop>()`).
- Automatically exposes reactive machine signals and control methods (`StateMachineStoreMembers`).
- Supports `syncContext: () => ({ prop: externalSignal })` for reactive one-way signal mirroring from external stores without tight coupling.

#### `StateMachineStoreMembers<TFSM>` (Exposed on `SignalStore` & `MachineInstance`)

| Member | Type | Description |
| :--- | :--- | :--- |
| **`state`** / **`fsmState`** | `Signal<ExtractStates<TFSM>>` | Current active state name of the machine. |
| **`stateEpoch`** | `Signal<number>` | Monotonically incrementing counter bumped on every non-`stay()` state transition. |
| **`fsmContext`** | `DeepSignalOf<ExtractContext<TFSM>>` | Deep signal of the machine's context state. |
| **`actors`** | `{ [id]: Signal<ActorState \| null> }` | Keyed signals for every sub-machine in the hierarchy. Returns the sub-actor's live context while active, or `null` when inactive. |
| **`fsmSubState`** | `Signal<string \| null>` | Active child state when a sub-machine is running, or `null`. |
| **`fsmSubContext`** | `Signal<Record<string, any> \| null>` | Active child context when a sub-machine is running, or `null`. |
| **`childMachines`** | `Signal<Record<string, readonly ChildMachineSnapshot[]>>` | Live snapshots of active `each()` pools and `all`/`race`/`any` combinator children. |
| **`isPending`** | `Signal<boolean>` | `true` whenever the machine (or an active child actor) is inside an `awaiting()` state. |
| **`isDone`** | `Signal<boolean>` | `true` when the machine has reached `finalState()`. |
| **`finalOutcome`** | `Signal<string \| null>` | Name of the terminal outcome once `isDone()` is `true`, otherwise `null`. |
| **`send(event, payload?)`** | `SendFn<TFSM>` | Enqueues a strongly-typed event into the FIFO Run-to-Completion queue. Delegates to active sub-actors first if they handle the event (Cooperative Cancel), or triggers parent interrupt transitions. |
| **`can(event, payload?)`** | `CanFn<TFSM>` | Purely evaluates (`true`/`false`) whether `event` (with optional `payload`) would match a transition from the current state (including guards). |
| **`sendToChild(key, itemId, event, payload?)`** | `Function` | Sends an event to a specific child instance inside an active `each(key, childFSM)` pool by its item ID. |
| **`patchContext(patch)`** | `(patch: Partial<Context>) => void` | Updates context properties directly and re-evaluates dynamic `every()` timers or `always()` branches. |
| **`getSnapshot()`** | `() => MachineSnapshot<TFSM>` | Captures a serializable snapshot (`{ state, context, stateEpoch, children }`) of the entire active hierarchy. |
| **`restoreSnapshot(snap)`** | `(snap: MachineSnapshot<TFSM>) => void` | Restores machine state, context, and child actors from a snapshot and re-arms state timers. |
| **`reset(override?)`** | `(override?: Partial<Context>) => void` | Aborts any running tasks/timers and resets the machine to `initial` with initial context (plus optional `override`). |
| **`destroy()`** | `() => void` | Cleans up all active timers, tasks, watches, and child actors (automatically called on Angular `DestroyRef`). |

#### Additional Helpers & Runners

| Function | Package | Description |
| :--- | :--- | :--- |
| **`createFeatureTester(feature, options?)`** | `@matrix-fsm/angular` | Lightweight unit-test harness for Vitest/Node (`< 5ms`, zero `TestBed`). Accepts `{ inputs, stateOverride, syncedContext, methods, actorMethods }` and provides `tester.send()`, `tester.state()`, `tester.context()`, `await tester.flushTasks()`, and `tester.emittedOutputs()`. |
| **`provideStateMachine(fsm, storeOrConfig)`** | `@matrix-fsm/angular` | Explicitly binds or overrides a sub-machine's runtime implementation via Angular DI (`providers: [...]`). |
| **`patchMachineState(store, ...updaters)`** | `@matrix-fsm/angular` | Safely patches state inside both full `SignalStore` instances and scoped sub-actor runners. |
| **`getMachineToken(fsm)`** | `@matrix-fsm/angular` | Returns the Angular `InjectionToken` associated with `fsm`. |
| **`createMachineInstance(fsm, hooks?)`** | `@matrix-fsm/core` | Framework-agnostic (0% Angular) FIFO state machine runner for Node, CLI, or backend services. |
| **`toMermaid(fsmOrFeature)`** | `@matrix-fsm/core` | Generates a Mermaid `stateDiagram-v2` string with `⚡` badges for `awaiting()`, `⇉` badges for `each`/`all`/`race`/`any`, and composite blocks for sub-machines. |
| **`getShortestPaths(fsmOrFeature)`** | `@matrix-fsm/core` | Computes deterministic shortest transition sequences from `initial` to every reachable state via BFS (used for automated path coverage tests). |
| **`withRouteMachine(fsm, mapping)`** | `@matrix-fsm/router` | Binds a `SignalStore` machine to URL routes (`stateToRoute`, `routeToEvent`, `onNavigate`) and exposes `store.fsmUrl()` + `store.syncFromUrl(url, params)`. |
| **`runEffect(effect, abortSignal?)`** | `@matrix-fsm/angular/effect` | Bridges an `Effect.Effect<A, E>` into an `AbortSignal`-aware `Promise<A>` that interrupts the fiber on abort. |

---

### 4. Compile-Time Type Extractors & Runtime Guards (`@matrix-fsm/core`)

- **Type Extractors**:
  - `ExtractStates<typeof fsm>` / `ExtractOwnStates<typeof fsm>`
  - `ExtractContext<typeof fsm>` / `ExtractOwnContext<typeof fsm>` / `ExtractAllContext<typeof fsm>`
  - `ExtractEvents<typeof fsm>` / `ExtractEventsMap<typeof fsm>` / `ExtractEventPayload<typeof fsm, 'EVENT'>`
  - `ExtractInput<typeof fsm>` / `ExtractOutput<typeof fsm>` / `ExtractOutputsMap<typeof fsm>`
  - `ExtractFinalOutcomes<typeof fsm>` / `ExtractEmittedOutputs<typeof fsm>`
  - `ExtractMethods<typeof fsm>` / `ExtractAllSubMachines<typeof fsm>` / `ExtractAwaitingNodes<typeof fsm>`
- **Runtime Type Guards**:
  - `isAwaitingNode`, `isOutcomeNode`, `isStayNode`, `isAnyStateNode`, `isFinalNode`, `isAfterNode`, `isEveryNode`, `isAlwaysNode`, `isEachNode`, `isCombinatorNode`, `isSubMachineRef`, `isFSMDefinition`

---

## Classic End-to-End Example: Coffee Shop & Barista Sub-Actor

This example demonstrates the **Sandwich Pattern (`createMachineFeature`)**, **`stay()`**, **`awaiting()`**, **guards**, **typed sub-actor `inputs` & `outputs`**, **`finalState()`**, **`after()` timeouts**, **`anyState()` global events**, **`each()` parallel batch brewing**, **`SignalStore` mounting**, and **fast unit testing without `TestBed`**.

### 1. Child Actor: `barista.feature.ts`

```ts
import { inject } from '@angular/core';
import { patchState } from '@ngrx/signals';
import { awaiting, createMachineFeature, finalState } from '@matrix-fsm/angular';
import { CoffeeShopApiService } from './coffee-shop-api.service';

export interface CoffeeDrink {
  readonly id: string;
  readonly name: string;
  readonly price: number;
}

export interface BrewResult {
  readonly baristaNote: string;
  readonly temperatureCelsius: number;
}

// 1. PUBLIC CONTRACT (Inputs, Events, Outputs)
export interface BaristaInputs {
  readonly selectedDrink: CoffeeDrink;
}

export type BaristaEvents = {
  START_BREWING: void;
  RETRY_BREW: void;
};

export type BaristaOutputs = {
  COFFEE_READY: {
    readonly drinkName: string;
    readonly result: BrewResult;
  };
};

// 2. COHESIVE SANDWICH FEATURE (Matrix + Private State + Methods)
export const baristaFSM = createMachineFeature<{
  inputs: BaristaInputs;
  events: BaristaEvents;
  outputs: BaristaOutputs;
  states: 'ticketQueued' | 'brewingCoffee' | 'maintenance';
}>()({
  id: 'barista',
  initial: 'ticketQueued',

  // prettier-ignore
  transitions: [
    /* FROM            VIA               TO                         OPTIONS */
    ['ticketQueued',   'START_BREWING',  awaiting('brewingCoffee'), { call: (m) => m._brewCoffee }],
    ['brewingCoffee',  'DONE',           finalState(),              {
                                                                      call: (m) => m._saveBrewResult,
                                                                      output: ['COFFEE_READY', (ctx, result) => ({
                                                                        drinkName: ctx.selectedDrink.name,
                                                                        result,
                                                                      })],
                                                                    }],
    ['brewingCoffee',  'ERROR',          'maintenance',             { call: (m) => m._setBrewError }],
    ['maintenance',    'RETRY_BREW',     awaiting('brewingCoffee'), { call: (m) => m._brewCoffee }],
  ],

  // Private to the Barista actor — zero parent store leakage!
  state: {
    baristaResult: null as BrewResult | null,
    brewError: null as string | null,
  },

  methods: (store, api = inject(CoffeeShopApiService)) => ({
    _brewCoffee: (_payload: void, signal: AbortSignal, ctx) =>
      api.brewCoffee(ctx.selectedDrink, signal),
    _saveBrewResult: (baristaResult: BrewResult) =>
      patchState(store, { baristaResult, brewError: null }),
    _setBrewError: (err: Error) =>
      patchState(store, { brewError: err.message }),
  }),
});
```

### 2. Root Machine: `coffee-shop.machine.ts`

```ts
import { inject } from '@angular/core';
import { patchState } from '@ngrx/signals';
import {
  after,
  anyState,
  awaiting,
  createMachineFeature,
  each,
  stay,
} from '@matrix-fsm/angular';
import { baristaFSM, type BrewResult, type CoffeeDrink } from './barista.feature';
import { CoffeeShopApiService } from './coffee-shop-api.service';

export interface CoffeeShopContext {
  selectedDrink: CoffeeDrink | null;
  batchOrders: CoffeeDrink[];
  isFreeDrink: boolean;
  isPaid: boolean;
  preparedCup: BrewResult | null;
  error: string | null;
}

export type CoffeeShopEvents = {
  SELECT_DRINK: { drink: CoffeeDrink };
  PLACE_ORDER: void;
  PAY: void;
  BREW_BATCH: void;
  TAKE_COFFEE: void;
  CANCEL: void;
  RESET_SHOP: void;
};

export type CoffeeShopStates =
  | 'customerBrowsing'
  | 'checkingLoyalty'
  | 'awaitingPayment'
  | 'coffeeReady'
  | 'drinkingCoffee';

// Pure guards (0% DI, strictly reads ctx / payload):
const hasSelectedDrink = (ctx: CoffeeShopContext) => ctx.selectedDrink !== null;
const isFreeDrink = (ctx: CoffeeShopContext, payload?: { isFreeDrink: boolean }) =>
  payload ? payload.isFreeDrink : ctx.isFreeDrink;

export const coffeeShopFSM = createMachineFeature<{
  events: CoffeeShopEvents;
  states: CoffeeShopStates;
}>()({
  id: 'coffeeShop',
  initial: 'customerBrowsing',

  // prettier-ignore
  transitions: [
    /* FROM                         VIA               TO                            OPTIONS */
    ['customerBrowsing',            'SELECT_DRINK',   stay(),                       { call: (m) => m._selectDrink }],
    ['customerBrowsing',            'PLACE_ORDER',    awaiting('checkingLoyalty'),  { guard: hasSelectedDrink, call: (m) => m._checkLoyalty }],
    ['customerBrowsing',            'PLACE_ORDER',    stay(),                       { call: (m) => m._setMissingDrinkError }],
    ['customerBrowsing',            'BREW_BATCH',     each('batchOrders', baristaFSM)],

    // Async loyalty check outcomes:
    ['checkingLoyalty',             'CANCEL',         'customerBrowsing'],
    ['checkingLoyalty',             'ERROR',          'customerBrowsing',           { call: (m) => m._setError }],
    ['checkingLoyalty',             'DONE',           baristaFSM,                   {
                                                                                      guard: isFreeDrink,
                                                                                      call: (m) => m._applyLoyaltyResult,
                                                                                      input: (ctx) => ({ selectedDrink: ctx.selectedDrink! }),
                                                                                    }],
    ['checkingLoyalty',             'DONE',           'awaitingPayment',            { call: (m) => m._applyLoyaltyResult }],

    // Payment -> spawns isolated Barista Sub-FSM with typed input:
    ['awaitingPayment',             'PAY',            baristaFSM,                   {
                                                                                      call: (m) => m._markPaid,
                                                                                      input: (ctx) => ({ selectedDrink: ctx.selectedDrink! }),
                                                                                    }],
    ['awaitingPayment',             'CANCEL',         'customerBrowsing'],

    // Sub-actor & parallel batch (`each`) transitions:
    [baristaFSM,                    'CANCEL',         'customerBrowsing'],
    [baristaFSM,                    'COFFEE_READY',   'coffeeReady',                { call: (m) => m._onCoffeeReady }],
    [each('batchOrders', baristaFSM), 'ALL_DONE',     'coffeeReady'],

    // Pickup & declarative auto-reset timer (`after`):
    ['coffeeReady',                 'TAKE_COFFEE',    'drinkingCoffee'],
    ['drinkingCoffee',              after(5000),      'customerBrowsing',           { call: (m) => m._resetOrder }],

    // Global fallback from any state (`anyState`):
    [anyState(),                    'RESET_SHOP',     'customerBrowsing',           { call: (m) => m._resetOrder }],
  ],

  state: {
    selectedDrink: null,
    batchOrders: [],
    isFreeDrink: false,
    isPaid: false,
    preparedCup: null,
    error: null,
  } satisfies CoffeeShopContext,

  methods: (store, api = inject(CoffeeShopApiService)) => ({
    _selectDrink: ({ drink }: { drink: CoffeeDrink }) =>
      patchState(store, { selectedDrink: drink, error: null }),
    _setMissingDrinkError: () =>
      patchState(store, { error: 'Please select a coffee first!' }),
    _checkLoyalty: (_payload: void, signal: AbortSignal, _ctx: Readonly<CoffeeShopContext>) =>
      api.checkLoyalty(signal),
    _applyLoyaltyResult: (res: { isFreeDrink: boolean }) =>
      patchState(store, { isFreeDrink: res.isFreeDrink, error: null }),
    _markPaid: () =>
      patchState(store, { isPaid: true }),
    _onCoffeeReady: ({ result }: { drinkName: string; result: BrewResult }) =>
      patchState(store, { preparedCup: result }),
    _setError: (err: Error) =>
      patchState(store, { error: err.message }),
    _resetOrder: () =>
      patchState(store, {
        selectedDrink: null,
        isFreeDrink: false,
        isPaid: false,
        preparedCup: null,
        error: null,
      }),
  }),
});
```

### 3. Mounting in Angular `SignalStore` (`coffee-shop.store.ts`)

```ts
import { Injectable } from '@angular/core';
import { signalStore } from '@ngrx/signals';
import { withStateMachine } from '@matrix-fsm/angular';
import { coffeeShopFSM } from './coffee-shop.machine';

@Injectable()
export class CoffeeShopStore extends signalStore(
  withStateMachine(coffeeShopFSM),
) {}

// In a Component:
// store.state()                 -> 'customerBrowsing' | 'checkingLoyalty' | 'barista' | ...
// store.selectedDrink()         -> Signal<CoffeeDrink | null>
// store.actors.barista()        -> Signal<(BaristaInputs & BaristaInternalState) | null>
// store.isPending()             -> Signal<boolean>
// store.can('PLACE_ORDER')      -> boolean (evaluates `hasSelectedDrink` guard!)
// store.send('SELECT_DRINK', { drink })
// store.send('PLACE_ORDER')
```

### 4. Unit Testing in `< 5ms` without `TestBed` (`coffee-shop.spec.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { createFeatureTester } from '@matrix-fsm/angular';
import { baristaFSM } from './barista.feature';

describe('baristaFSM', () => {
  it('brews coffee and emits typed COFFEE_READY output', async () => {
    const tester = createFeatureTester(baristaFSM, {
      inputs: {
        selectedDrink: { id: 'espresso', name: 'Double Espresso', price: 3.5 },
      },
      methods: {
        _brewCoffee: async () => ({
          baristaNote: 'Rich crema',
          temperatureCelsius: 92,
        }),
      },
    });

    expect(tester.state()).toBe('ticketQueued');
    tester.send('START_BREWING');
    expect(tester.isPending()).toBe(true);

    await tester.flushTasks();

    expect(tester.isDone()).toBe(true);
    expect(tester.emittedOutputs()).toEqual([
      {
        type: 'COFFEE_READY',
        payload: {
          drinkName: 'Double Espresso',
          result: { baristaNote: 'Rich crema', temperatureCelsius: 92 },
        },
      },
    ]);
  });
});
```

---

## Static AST & Graph Conservation Rules (`@matrix-fsm/eslint-plugin`)

Enable all 15 rules with the recommended flat config preset:

```js
// eslint.config.mjs
import matrixFsm from '@matrix-fsm/eslint-plugin';

export default [
  matrixFsm.configs.recommended,
];
```

| # | Rule | Auto-Fix | Description |
| :---: | :--- | :---: | :--- |
| 1 | `@matrix-fsm/align-matrix-columns` | `eslint --fix` | Enforces that `[FROM, VIA, TO]` sit on a single line and are vertically column-aligned across the entire matrix. |
| 2 | `@matrix-fsm/group-contiguous-transitions` | `eslint --fix` | Requires identical `[FROM, VIA]` rows to be grouped contiguously and expands array shorthands in Column 1. |
| 3 | `@matrix-fsm/require-fallback-transition` | — | Every guarded `[FROM, VIA]` group must end with an unguarded fallback row (e.g. `stay()`). |
| 4 | `@matrix-fsm/no-unreachable-transitions` | — | Forbids rows placed after an unguarded row with the same `[FROM, VIA]` (or shadowed by an unguarded `[anyState(), EVENT]`). |
| 5 | `@matrix-fsm/no-shadowed-transitions` | — | Detects duplicate/shadowed transitions across inline and spread `transitions([...])` groups. |
| 6 | `@matrix-fsm/require-awaiting-handlers` | — | Every `awaiting('x')` state must handle both `'DONE'` (or `outcome()`) and `'ERROR'` exits. |
| 7 | `@matrix-fsm/awaiting-naming-convention` | — | Enforces that every `awaiting('...ing')` state name ends with `-ing`. |
| 8 | `@matrix-fsm/complete-extracted-groups` | — | Forbids splitting a `[FROM, VIA]` group across `transitions([...])` and requires `> 3` rows (`minRows: 4`) before extracting. |
| 9 | `@matrix-fsm/pure-machine-definition` | — | Forbids Angular/service imports or `inject()` inside `*.machine.ts` / `transitions` arrays and enforces single-method `call: (m) => m._method` selectors. |
| 10 | `@matrix-fsm/no-conflicting-final-output` | — | Forbids combining a named `finalState('NAME')` with `options.output` in the same row, or responding to a terminal child output with `stay()`. |
| 11 | `@matrix-fsm/require-exit-for-targets` | — | Every active target (`awaiting`, sub-machine, `all`, `race`, `any`, `each`) in Column 3 (`TO`) must have at least one non-`stay()` exit in Column 1 (`FROM`). |
| 12 | `@matrix-fsm/no-unreachable-states` | — | Every state or actor in Column 1 (`FROM`, except `anyState()`) must be `initial` or reachable via Column 3 (`TO`). |
| 13 | `@matrix-fsm/no-duplicate-combinator-actors` | — | Forbids passing duplicate machine references into `all()`, `race()`, or `any()`. |
| 14 | `@matrix-fsm/valid-any-state-target` | — | Validates legal targets and guards on `anyState()` global transitions. |
| 15 | `@matrix-fsm/valid-timer-transitions` | — | Enforces that `after(ms)` transitions out of the state (never `stay()`) and `every(ms)` targets `stay()`. |

---

## Commands

```sh
pnpm nx run-many -t test,lint,build
```
