Dieses vollständige `blueprint.md` bündelt alle unsere Architekturentscheidungen, Typ-Regeln, Linter-Gesetze und Design-Patterns widerspruchsfrei in einer einzigen Spezifikation.

# Architectural Blueprint: `@matrix-fsm`

**Flat, Idiot-Proof 2D Matrix State Machines for Angular SignalStore**

---

## 1. Core Philosophy & Goals

1. **Zero JSON-Hell & Zero Dummy Objects:** State machines are defined as flat, vertically aligned 4-column tuple matrices `[FROM, VIA, TO, OPTIONS?]` using the single canonical curried creator `createFSM<FSMContract>()({ id, initial, transitions })`.
2. **Strict SOLID Separation of Concerns:**
   - **Topology (Where & When):** Pure, static FSM files (`*.machine.ts`) with 0% Angular DI, 100% static analyzability (Mermaid exportable).
   - **Business Rules & Narrow Contracts (Why):** Pure TypeScript functions, narrow per-machine contracts (`*.domain.ts`), and Policy Lookup Tables (`*.policy.ts`) with 0% Angular DI. Sub-machines never import parent domain types (DIP & ISP).
   - **Execution & IO (How):** Angular `SignalStore` (`*.store.ts`) handling Dependency Injection (`inject()`), `withState`, `withMethods` (`{ call: (m) => m._method }`), composable `signalStoreFeature` slices, and Promise/Observable/Effect-TS `tasks`.
3. **Compiler & Linter Enforced ("Idiot-Proof"):** Human and AI errors (missing fallbacks, unhandled async errors, self-transition re-entry bugs, missing sub-machine tasks or methods, typo outcomes, unaligned matrix columns) are caught at compile/lint time.

---

## 2. The 3-Layer Nx Architecture & Module Boundaries

All code in the monorepo follows a strict one-way dependency flow enforced via `@nx/enforce-module-boundaries`.

```text
┌─────────────────────────────────────────────────────────┐
│ LAYER 1: Core (`tag:type:core`)                         │
│ Global Singletons: AuthStore, Role Policies, AppConfig  │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│ LAYER 2: Domain (`tag:type:domain`)                     │
│ Pure Functions, Pricing, Validation, Capability Maps    │
│ STRICT RULE: 0% Angular DI (`inject` forbidden!)        │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│ LAYER 3: Features (`tag:type:feature`)                  │
│ *.machine.ts (Pure FSM) + *.store.ts (SignalStore + DI) │
│ + *.component.ts (Dumb Views with @switch)              │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Policy-Driven Design (Capabilities over Roles)

Features and FSMs **never** check raw enums like `user.role === UserRole.Admin`. Instead, categories (Roles, Countries, Subscription Tiers, Device Types) are mapped once via `Record<Enum, Policy>` into boolean/numeric **Entitlements (Capabilities)**.

### Decision Matrix: FSM State vs. TypeScript Domain Logic

| Question                                                          | YES -> **FSM State (`*.machine.ts`)**                  | NO -> **TS Logic (`*.domain.ts` / `computed`)**                  |
| ----------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| Does the app pause here waiting for an event (Click, API, Timer)? | **State** (`'proUpsellPromo'` waiting for `'DISMISS'`) | **TS Logic** (Inline banner rendered inside `'loggedIn'`)        |
| Does it change which events are currently valid/allowed?          | **State** (`'authenticating'` blocks `'LOGIN'`)        | **TS Logic** (Same actions allowed, different calculated values) |
| Is it a phase on a timeline (Before -> After)?                    | **State** (`'editing'` -> `'saving'` -> `'done'`)      | **TS Logic** (Simultaneous properties like `price`, `showAds`)   |
| Does it branch into >3 data variants (15 roles, 20 countries)?    | **Never as separate states!**                          | **TS Logic** (`Record<Enum, Policy>` or `tasks` lookup)          |

---

## 4. The Matrix DSL Specification (`@matrix-fsm/core`)

### 4.1 Named `FSMContract` & First-Match-Wins Evaluation

Every state machine is created via `createFSM<TContract extends FSMContract = {}>()({ ... })`:

```typescript
export interface FSMContract {
  readonly events?: Record<string, any>;
  readonly states?: string;
  readonly context?: object;
  readonly methods?: object;
}
```

- Every transition row is a strict tuple: `[FROM, VIA, TO, OPTIONS?]`.
- Rows with the same `[FROM, VIA]` form a **Transition Group** and are evaluated **top-to-bottom (First-Match-Wins)**.
- **No State Arrays in Column 1:** `['stateA', 'stateB']` in Column 1 is forbidden to preserve strict grouping. Shared exit/cancel behavior uses a hierarchical sub-machine (`[baristaFSM, 'CANCEL', 'customerBrowsing']`).
- **Recursive Sub-Machine Aggregation:** When a child `FSMDefinition` (`baristaFSM`) is used in a parent's `transitions`, `@matrix-fsm/core` automatically intersects `ExtractContext` and `ExtractMethods` (`UnionToIntersection`), unions `ExtractStates`, `ExtractEvents`, and `ExtractAwaitingNodes`, and narrows Column 2 (`VIA`) on `[baristaFSM, VIA, TO]` rows to `ExtractFinalOutcomes<typeof baristaFSM> | BuiltInLifecycleEvent | keyof TParentEvents`.

### 4.2 Core Primitives & Markers

1. **`awaiting('stateName')` (Async Task State Marker)**
   - Marks a state in Column 3 (`TO`) as an asynchronous transitional state (must end with `-ing`, e.g., `awaiting('authenticating')`).
   - Every `awaiting('x')` state **must** have at least one `'DONE'` and one `'ERROR'` transition in the matrix, and **must** have a matching task implementation `x` in the SignalStore's `tasks` block.

2. **`stay()` (In-Place Mutation without Re-Entry)**
   - Used in Column 3 (`TO`) for gatekeeper fallbacks: `['loginView', 'LOGIN', stay(), { call: (m) => m._setInvalidEmail }]`.
   - Executes `call` (or `patch`), keeps the machine in the current state, and **does not** trigger `onExit` / `onEnter` or interrupt running tasks.

3. **`transitions<TContractOrFSM>([...])` (Zero-Cost Macro Wrapper, `> 3` Rows Rule)**
   - Identity function (`x => x`) used to extract large transition groups (`>= 4` rows) into a variable while preserving full TypeScript context/method inference and ESLint AST detection.

4. **Unified `createFSM` Sub-Machines & `finalState('OUTCOME')`**
   - Any machine created with `createFSM` can be referenced directly in Column 1 (`FROM`) or Column 3 (`TO`) of a parent matrix. Terminal outcomes use `finalState('OUTCOME')`.

5. **`each('contextArrayKey', childFSM)` (Parallel Master/Slave Orchestration)**
   - Spawns an isolated `childFSM` instance for each ID in `ctx[contextArrayKey]` and dispatches `'ALL_DONE'` when all instances finish.

---

## 5. Complete Code Example (End-to-End)

### 5.1 Pure FSM Definition (`auth.machine.ts`)

```typescript
import { awaiting, createFSM, stay } from '@matrix-fsm/core';
import type { Credentials, User, UserEntitlements } from '../../core';

export interface AuthContext {
  credentials: Credentials;
  user: User | null;
  policy: UserEntitlements;
  error: string | null;
}

export type AuthStates =
  | 'loginView'
  | 'authenticating'
  | 'proUpsellPromo'
  | 'offlineRetryView'
  | 'loggedIn';

export type AuthEvents = {
  UPDATE_CREDENTIALS: Partial<Credentials>;
  LOGIN: void;
  DISMISS_PROMO: void;
  CANCEL: void;
  RETRY: void;
  LOGOUT: void;
  NetworkTimeoutError: { message: string };
};

export type AuthMethods = {
  _updateCredentials(payload: Partial<Credentials>): void;
  _setInvalidEmail(): void;
  _setErrorMessage(err: Error): void;
  _logout(): void;
};

const hasValidInput = (ctx: AuthContext) => ctx.credentials.email.includes('@');
const shouldShowPromo = (ctx: AuthContext) => ctx.policy.showUpsellAds;

export const authFSM = createFSM<{
  events: AuthEvents;
  context: AuthContext;
  states: AuthStates;
  methods: AuthMethods;
}>()({
  id: 'auth',
  initial: 'loginView',
  // prettier-ignore
  transitions: [
    /* FROM               VIA                     TO                           OPTIONS */
    ['loginView',         'UPDATE_CREDENTIALS',   stay(),                      { call: (m) => m._updateCredentials }],
    ['loginView',         'LOGIN',                awaiting('authenticating'),  { guard: hasValidInput }],
    ['loginView',         'LOGIN',                stay(),                      { call: (m) => m._setInvalidEmail }],
    ['authenticating',    'CANCEL',               'loginView'],
    ['authenticating',    'DONE',                 'proUpsellPromo',            { guard: shouldShowPromo }],
    ['authenticating',    'DONE',                 'loggedIn'],
    ['authenticating',    'NetworkTimeoutError',  'offlineRetryView'],
    ['authenticating',    'ERROR',                'loginView',                 { call: (m) => m._setErrorMessage }],
    ['offlineRetryView',  'RETRY',                awaiting('authenticating')],
    ['offlineRetryView',  'CANCEL',               'loginView'],
    ['proUpsellPromo',    'DISMISS_PROMO',        'loggedIn'],
    ['loggedIn',          'LOGOUT',               'loginView',                 { call: (m) => m._logout }],
  ],
});
```

### 5.2 SignalStore Integration (`auth.store.ts`)

```typescript
import { Injectable, inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { Effect, Schedule } from 'effect';
import { withStateMachine } from '@matrix-fsm/angular';
import { effectTaskAdapter } from '@matrix-fsm/angular/effect';
import { AuthApiService, GlobalAuthStore } from '../../core';
import {
  authFSM,
  initialAuthContext,
  type AuthContext,
  type AuthMethods,
} from './auth.machine';

@Injectable()
export class AuthFeatureStore extends signalStore(
  withState<AuthContext>(initialAuthContext),
  withMethods(
    (store): AuthMethods => ({
      _updateCredentials: (patch) =>
        patchState(store, {
          credentials: { ...store.credentials(), ...patch },
          error: null,
        }),
      _setInvalidEmail: () => patchState(store, { error: 'Invalid email' }),
      _setErrorMessage: (err) => patchState(store, { error: err.message }),
      _logout: () => patchState(store, { user: null, error: null }),
    }),
  ),
  withStateMachine(authFSM, {
    taskAdapter: effectTaskAdapter,
    syncContext: (globalAuth = inject(GlobalAuthStore)) => ({
      policy: globalAuth.policy,
    }),
    tasks: (authApi = inject(AuthApiService)) => ({
      authenticating: (ctx) =>
        authApi.loginEffect(ctx.credentials).pipe(
          Effect.retry({
            times: 2,
            schedule: Schedule.exponential('10 millis'),
          }),
          Effect.map((user) => ({ user, error: null })),
        ),
    }),
  }),
) {}
```

---

## 6. Custom ESLint Plugin Specification (`@matrix-fsm/eslint-plugin`)

| # | Rule ID                        | Severity           | Description & Enforcement                                                                                                       |
| - | ------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 1 | `align-matrix-columns`         | `error` (auto-fix) | First 3 columns `[FROM, VIA, TO]` must be on a single horizontal line and vertically aligned across all rows.                   |
| 2 | `group-contiguous-transitions` | `error` (auto-fix) | All rows sharing the exact same `[FROM, VIA]` pair must be placed directly adjacent to each other.                              |
| 3 | `require-fallback-transition`  | `error`            | Every guarded `[FROM, VIA]` group must end with an unguarded fallback row.                                                      |
| 4 | `no-unreachable-transitions`   | `error`            | An unguarded row for `[FROM, VIA]` must never appear above another row with the same `[FROM, VIA]`.                             |
| 5 | `require-awaiting-handlers`    | `error`            | Every state wrapped in `awaiting('x')` in Column 3 must have at least one `'DONE'` and one `'ERROR'` row in Column 1.           |
| 6 | `awaiting-naming-convention`   | `error`            | State names inside `awaiting('...')` must end with `-ing` (e.g., `'authenticating'`, `'brewingCoffee'`).                        |
| 7 | `complete-extracted-groups`    | `error`            | `transitions([...])` variables must not split a `[FROM, VIA]` group and require `> 3` rows (`minRows: 4`).                      |
| 8 | `pure-machine-definition`      | `error`            | Forbids `@angular/*`, service, or store imports and `inject()` in `*.machine.ts`, and enforces single `(m) => m._method` calls. |
