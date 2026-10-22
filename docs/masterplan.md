# Masterplan: Hierarchical Matrix Tree & Zero-Leakage Sub-Machine DX

**Document Status:** Single Source of Truth (SSOT) for Next-Stage Architecture & Implementation  
**Created:** 2026-10-21 21:02 CEST  
**Target:** High-Reasoning / "Powerful" AI Agent Evaluation & Execution  

---

## 1. Executive Summary & Core Philosophy

> [!IMPORTANT]
> ### 🛡️ The Guiding Mandate for the Next Agent:
> 1. **The Syntax is Sacred (DO NOT TOUCH):** We are **extremely satisfied** with the current 2D Matrix syntax `[FROM, VIA, TO, OPTIONS]`, the curried `createFSM<{ ... }>()({ ... })` API, the visual column alignment, and the hierarchical tree composition where child machines (`baristaFSM`) appear directly in parent transition rows. **This syntax is our core differentiator and winning formula. Do NOT reinvent or alter it.**
> 2. **The Sole Enemy is the Double Coupling:** The **only** issue we are solving is that currently the developer must wire the sub-machine twice: once in the matrix, and a second time in the store via `withBarista()`. **This secondary store-level coupling must be completely eradicated.** The transitions matrix must be the ONE and ONLY place where coupling occurs.
> 3. **Mathematical Determinism is Non-Negotiable:** The elimination of the double coupling must NOT come at the expense of mathematical rigor. The system must remain **100% deterministic, race-condition-free, scope-invariant**, and strictly verified at compile-time by TypeScript without runtime magic or dynamic duck-typing.

### 1.1 The "Bread & Butter" Vision
The foundational premise and absolute competitive advantage of `@matrix-fsm` is the **2D Matrix Syntax combined with a Hierarchical Tree Structure**:

```
[Chain FSM]  (Root / "Main Method")
     │
     ├── [Shop FSM #1] (Branch)
     │        │
     │        ├── [Barista FSM] (Leaf)
     │        └── [Cashier FSM] (Leaf)
     │
     └── [Shop FSM #2] (Branch)
              ...
```

- **Declarative 2D Table:** Every transition table is an aligned, visual, human-readable table `[FROM, VIA, TO, OPTIONS]`.
- **Top-Down Tree Decomposition:** Complex real-world software workflows are partitioned into modular, highly decoupled nodes—from the high-level orchestration matrix down to specialized leaf machines.
- **The Golden Law:** **Coupling MUST happen in the Transitions Matrix — and ONLY in the Transitions Matrix.**

### 1.2 The Current DX Pain Point (The "Double Coupling" Violation)
In the current implementation, incorporating a sub-machine (e.g. `baristaFSM`) into a parent (e.g. `coffeeShopFSM`) requires coupling at **two disjoint locations**:
1. **In the Matrix:** `['awaitingPayment', 'PAY', baristaFSM]` *(This is desired, intuitive, and visually declarative).*
2. **In the Host Store:** The developer is forced to write `withBarista()` (or wire child state, methods, and tasks) inside `CoffeeShopStore`!

This secondary store-level coupling violates the tree abstraction:
- Internal state of the child (`baristaResult`) leaks into the parent store context.
- Internal private methods of the child (`_setBrewError`) leak into the parent store interface.
- Internal tasks of the child (`brewingCoffee`) must be re-registered or contributed into the parent.

**Target State:** The host store (`CoffeeShopStore`) must remain **100% clean**. It must contain **zero lines of Barista code**. The fact that `coffeeShopFSM` transitions into `baristaFSM` in its matrix must be completely sufficient for the system to execute the child machine with its own encapsulated state, tasks, and error handling.

---

## 2. Problem Analysis & The Architectural Dilemma

### 2.1 The Two Clashing Constraints
1. **Rule #1: Pure Machine Definition (0% Framework / 0% Angular DI):**
   - `*.machine.ts` must remain pure TypeScript. It cannot call `inject()`, import Angular services, or import `*.store.ts`.
   - Therefore, `coffee-shop.machine.ts` imports `barista.machine.ts` cleanly.
2. **Framework Execution (Angular DI & State Management):**
   - The concrete task `brewingCoffee` requires Angular DI (`inject(CoffeeShopApiService)`).
   - In NgRx SignalStore, all reactive signals and methods on a store instance are computed statically at `signalStore(...)` declaration time.
   - If `CoffeeShopStore` does not invoke `withBarista()`, the Angular runtime does not automatically discover which Angular services and task runners belong to `baristaFSM`.

### 2.2 Why Statecharts Differ from Plain Actor Systems
- **Plain Actor System:** Two completely independent stores communicating via message passing.
  - *Risk:* Race conditions on cancel. If the parent cancels an order, an in-flight child task might still emit `COFFEE_READY` seconds later ("ghost coffee").
- **Hierarchical Statechart (Our Model):** The parent matrix possesses **Scope Invariant Authority**.
  - When the parent matrix leaves `baristaFSM` (e.g. via parent group-interrupt `['baristaFSM', 'CANCEL', 'customerBrowsing']`), the child machine instance and all its active abort controllers/promises/fibers are **atomically terminated in the exact same tick**.
  - Any subsequent completion event from the child is discarded because the parent is no longer in the sub-machine state.

---

## 3. The Target Architecture: Encapsulated Tree Nodes

### 3.1 Mental Model: Components with Input & Output
A sub-machine in `@matrix-fsm` must behave like an isolated UI component in a template:
```html
<app-barista [drink]="selectedDrink" (coffeeReady)="onReady($event)" />
```
- **Input:** Context passed from parent to child on transition entry.
- **Output:** Payload passed from child to parent on terminal state exit (`finalState('OUTCOME')`).
- **Encapsulation:** Child's internal awaiting states (`brewingCoffee`), maintenance states (`machineMaintenance`), and private error-setters (`_setBrewError`) are completely invisible to the parent.

### 3.2 The Developer Experience (DX) Target Code

#### A) Child Machine & Store (`barista.machine.ts` & `barista.store.ts`)
The child defines its pure matrix, and binds its own state, methods, and tasks self-contained:
```ts
// barista.machine.ts (Pure)
export const baristaFSM = createFSM<{ ... }>()({
  id: 'barista',
  initial: 'ticketQueued',
  transitions: [
    ['ticketQueued',       'START_BREWING', awaiting('brewingCoffee')],
    ['brewingCoffee',      'DONE',          finalState('COFFEE_READY')],
    ['brewingCoffee',      'ERROR',         'machineMaintenance', { call: (m) => m._setBrewError }],
    ['machineMaintenance', 'RETRY_BREW',    awaiting('brewingCoffee')],
  ],
});

// barista.store.ts (Self-contained, standalone injectable or feature)
@Injectable({ providedIn: 'root' })
export class BaristaStore extends signalStore(
  withStateMachine(baristaFSM, {
    state: initialBaristaContext,
    methods: (store) => ({
      _setBrewError: (err) => patchState(store, { error: err.message }),
    }),
    tasks: (api = inject(CoffeeShopApiService)) => ({
      brewingCoffee: async (ctx, signal) => {
        const result = await api.brewCoffee(ctx.selectedDrink, signal);
        return { baristaResult: result };
      },
    }),
  }),
) {}
```

#### B) Parent Store (`coffee-shop.store.ts`) — Zero Leakage!
```ts
// coffee-shop.store.ts
@Injectable()
export class CoffeeShopStore extends signalStore(
  withState<CoffeeShopContext>(initialCoffeeShopContext),
  withMethods((store): CoffeeShopMethods => ({
    _selectDrink: ...,
    _markPaid: ...,
    _finishCoffee: ...,
    // ZERO Barista methods here!
  })),
  withStateMachine(coffeeShopFSM, {
    tasks: (api = inject(CoffeeShopApiService)) => ({
      checkingLoyalty: ...,
      // ZERO Barista tasks here!
    }),
  }),
) {}
```
**Notice:**
- No `withBarista()` in `CoffeeShopStore`.
- No `...createBaristaTasks()` in `tasks`.
- No `_setBrewError` in `CoffeeShopMethods`.
- The parent store code is 100% focused on CoffeeShop domain logic.

---

## 4. Scaling Dimensions to Solve

The next agent must ensure the solution scales cleanly across three critical topologies:

### 4.1 Topology 1: Sequential 1:1 Sub-FSM
- Exactly one customer and one barista.
- Transition: `['awaitingPayment', 'PAY', baristaFSM]`.
- Parent interruption: `[baristaFSM, 'CANCEL', 'customerBrowsing']`.
- Guarantees immediate abortion of the child task without race conditions.

### 4.2 Topology 2: Concurrent 1:N Pools (`each`)
- A single shop managing multiple active orders concurrently.
- Transition: `['orderQueue', 'DISPATCH_ALL', each('orders', baristaFSM)]`.
- The parent matrix remains in the `each(...)` state while individual items progress independently through `baristaFSM`.
- Event routing: `store.sendToChild('orders', itemId, 'START_BREWING')`.
- Completion: `[each('orders', baristaFSM), 'ALL_DONE', 'allOrdersFulfilled']`.

### 4.3 Topology 3: Deeply Nested Hierarchy (The "Coffee Chain")
- `ChainFSM` (Root) $\rightarrow$ `each('shops', CoffeeShopFSM)` (Branch) $\rightarrow$ `each('baristas', BaristaFSM)` (Leaf).
- State and task encapsulation must hold at every level of the tree.
- A leaf must never demand configuration from the root unless explicitly bridged.

---

## 5. Critical Directives & Open Questions for the "Powerful Agent"

> [!IMPORTANT]
> The implementing agent must NOT rush into code generation. It must rigorously reason through the following architectural challenges:
> - **Syntax Preservation Mandate:** The 2D matrix structure, column alignment, and curried `createFSM` API must NOT be changed. We are completely satisfied with the syntax.
> - **Mathematical Determinism Mandate:** The state transitions must remain strictly deterministic (First-Match-Wins top-to-bottom), race-condition-free, and scope-invariant. Zero runtime guesswork, zero magic strings.

### Question 1: How does the runtime bridge the pure FSM to the DI-enabled Task Runner without parent store imports?
If `coffee-shop.store.ts` does not import `barista.store.ts`, how is the implementation of `brewingCoffee` resolved when the parent store enters `baristaFSM` at runtime?
*Options to analyze:*
- **Option A (Angular DI Token Binding):** Does `withStateMachine` inject child stores via Angular's Injector (e.g., using an injection token map or convention `provideSubMachine(baristaFSM, BaristaStore)`)?
- **Option B (Module-level Binding Registry):** When `barista.store.ts` is imported, does it register its task execution factory onto `baristaFSM` via a symbol/registry? If so, what guarantees that `barista.store.ts` is not tree-shaken away if nothing in the JS bundle statically references it?
- **Option C (Scoped Child Machine Instance):** Should `withStateMachine` dynamically instantiate child machine runners inside the host injector context when entering the sub-machine state?

### Question 2: Input & Output Protocol Between Tree Nodes
When transitioning into `baristaFSM`, how does the child receive its required data from the parent?
- Currently: Implicit shared context keys (`ctx.selectedDrink` matches between both contexts).
- *Evaluate:* Is implicit property matching sufficient, or do we need an explicit input mapper in the matrix row?
  ```ts
  ['awaitingPayment', 'PAY', baristaFSM, { input: (ctx) => ({ drink: ctx.selectedDrink }) }]
  ```
- *Evaluate:* On exit (`finalState('COFFEE_READY')`), how is the child's final payload delivered to the parent? Does it arrive as the event payload to `{ call: (m) => m._handleDrinkPrepared }`?

### Question 3: Type Safety & Compile-Time Diagnostics
- If a sub-machine has awaiting states (`brewingCoffee`), how does TypeScript ensure at compile time that an implementation exists somewhere in the application, WITHOUT forcing that implementation into the parent store's type contract?
- How to prevent `TS4058` / `TS4020` ("private name" / "cannot be named") when exporting signal stores?

---

## 6. Verification & Quality Gates
Any solution proposed and implemented by the powerful agent must satisfy:
1. **Zero ESLint Violations:** All 8 Matrix Linter laws (`align-matrix-columns`, `pure-machine-definition`, etc.) pass with 0 errors.
2. **Typecheck Clean:** `npm run typecheck` passes across all 5 projects (`core`, `angular`, `router`, `eslint-plugin`, `playground`).
3. **Full Vitest Suite:** `npm test` passes all 38+ unit and integration tests.
4. **Full Production Build:** `npm run build` succeeds for all packages and the production Angular playground application.

---
*End of Masterplan. Ready for deep reasoning, architectural review, and rigorous execution.*
