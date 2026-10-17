Dieses vollständige `BLUEPRINT.md` bündelt alle unsere Architekturentscheidungen, Typ-Regeln, Linter-Gesetze und Design-Patterns widerspruchsfrei in einer einzigen Spezifikation. Du kannst es direkt ins Root-Verzeichnis deines Workspaces legen, damit Antigravity das System ohne Rückfragen aufsetzen und durchziehen kann.

# Architectural Blueprint: `@ngx/flatstate`

**Flat, Idiot-Proof Tuple State Machines for Angular SignalStore & Ionic**

---

## 1. Core Philosophy & Goals

1. **Zero JSON-Hell:** State machines are defined as flat, vertically scannable 4-column tuple matrices `[FROM, VIA, TO, OPTIONS?]`. No deeply nested objects.
2. **Strict Separation of Concerns:**
   - **Topology (Where & When):** Pure, static FSM files (`*.machine.ts`) with 0% Angular DI, 100% static analyzability (Mermaid exportable).
   - **Business Rules (Why):** Pure TypeScript functions & Policy Lookup Tables (`*.domain.ts`, `*.policy.ts`) with 0% Angular DI.
   - **Execution & IO (How):** Angular `SignalStore` (`*.store.ts`) handling Dependency Injection (`inject()`), Effect-TS/Promise tasks, and reactive signal projection.
3. **Compiler & Linter Enforced ("Idiot-Proof"):** Human and AI errors (missing fallbacks, unhandled async errors, self-transition re-entry bugs, architectural layer violations) are caught at compile/lint time.

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

### Nx ESLint Boundary Configuration (`.eslintrc.base.json`)

```json
{
  "@nx/enforce-module-boundaries": [
    "error",
    {
      "enforceBuildableLibDependency": true,
      "allow": [],
      "depConstraints": [
        { "sourceTag": "type:core", "onlyDependOnLibsWithTags": ["type:core"] },
        {
          "sourceTag": "type:domain",
          "onlyDependOnLibsWithTags": ["type:core", "type:domain"]
        },
        {
          "sourceTag": "type:feature",
          "onlyDependOnLibsWithTags": ["type:core", "type:domain"]
        }
      ]
    }
  ]
}
```

---

## 3. Policy-Driven Design (Capabilities over Roles)

Features and FSMs **never** check raw enums like `user.role === UserRole.Admin`. Instead, categories (Roles, Countries, Subscription Tiers, Device Types) are mapped once via `Record<Enum, Policy>` into boolean/numeric **Entitlements (Capabilities)**.

```typescript
// libs/core/auth/src/lib/role.policy.ts
export interface UserEntitlements {
  showUpsellAds: boolean;
  canBypassApproval: boolean;
  discountPercent: number;
  maxProjects: number;
}

// TypeScript enforces exhaustiveness whenever a new UserRole is added:
export const ROLE_POLICIES: Record<UserRole, UserEntitlements> = {
  [UserRole.Free]: {
    showUpsellAds: true,
    canBypassApproval: false,
    discountPercent: 0,
    maxProjects: 3,
  },
  [UserRole.Pro]: {
    showUpsellAds: false,
    canBypassApproval: false,
    discountPercent: 10,
    maxProjects: 100,
  },
  [UserRole.Admin]: {
    showUpsellAds: false,
    canBypassApproval: true,
    discountPercent: 100,
    maxProjects: Infinity,
  },
};
```

### Decision Matrix: FSM State vs. TypeScript Domain Logic

| Question                                                          | YES -> **FSM State (`*.machine.ts`)**                  | NO -> **TS Logic (`*.domain.ts` / `computed`)**                  |
| ----------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| Does the app pause here waiting for an event (Click, API, Timer)? | **State** (`'proUpsellModal'` waiting for `'DISMISS'`) | **TS Logic** (Inline banner rendered inside `'loggedIn'`)        |
| Does it change which events are currently valid/allowed?          | **State** (`'authenticating'` blocks `'LOGIN'`)        | **TS Logic** (Same actions allowed, different calculated values) |
| Is it a phase on a timeline (Before -> After)?                    | **State** (`'editing'` -> `'saving'` -> `'done'`)      | **TS Logic** (Simultaneous properties like `price`, `showAds`)   |
| Does it branch into >3 data variants (15 roles, 20 countries)?    | **Never as separate states!**                          | **TS Logic** (`Record<Enum, Policy>` or `tasks` lookup)          |

---

## 4. The Matrix DSL Specification (`@ngx/flatstate`)

### 4.1 Tuple Structure & First-Match-Wins Evaluation

Every transition row is a strict tuple: `[FROM, VIA, TO, OPTIONS?]`.

- Rows with the same `[FROM, VIA]` form a **Transition Group** and are evaluated **top-to-bottom (First-Match-Wins)**.
- **No State Arrays in Column 1:** `['stateA', 'stateB']` in Column 1 is forbidden to preserve strict grouping. Shared exit/cancel behavior must use `subMachine()`.

```typescript
export type TransitionRow<TContext, TEvent TState,> = readonly [
  from: TState | SubMachineRef<any>,
  via: TEvent | 'DONE' | 'ERROR',
  to: TState | AwaitingNode<string> | StaySymbol | FinalNode<string> | SubMachineRef<any> | EachNode<any>,
  options?: {
    guard?: (ctx: Readonly<TContext>, eventPayload?: any) => boolean;
    patch?: (ctx: Readonly<TContext>, eventPayload?: any) => Partial<TContext>;
  }
];

```

### 4.2 Core Primitives & Markers

1. **`awaiting('stateName')` (Async Task State Marker)**

- Marks a state in Column 3 (`TO`) as an asynchronous transitional state (must end with `-ing`, e.g., `awaiting('authenticating')`).
- Subsequent exit rows in Column 1 reference the state by its plain string `'authenticating'`.
- **Contract:** Every `awaiting('x')` state **must** have at least one `'DONE'` and one `'ERROR'` transition in the matrix, and **must** have a matching task implementation `x` in the SignalStore's `tasks` block.

2. **`stay()` (In-Place Patch without Re-Entry)**

- Used in Column 3 (`TO`) for gatekeeper fallbacks: `[ 'editing', 'SUBMIT', stay(), { patch: setFormError } ]`.
- Executes `patch`, keeps the machine in the current state, and **does not** trigger `onExit` / `onEnter` or interrupt running tasks.

3. **`transitions<TContext>([...])` (Zero-Cost Macro Wrapper)**

- Identity function (`x => x`) used to extract large transition groups into a variable or separate file while preserving full TypeScript context inference and ESLint AST detection.
- **Rule:** Extracted blocks must be complete `[FROM, VIA]` groups including their final unguarded fallback row.

4. **`subMachine({...})` & `finalState('OUTCOME')` (Hierarchical Encapsulation)**

- Used when a multi-step flow waits for multiple events over time, needs local context cleanup, or requires a single group-interrupt (`[ paymentFSM, 'CANCEL', 'cart' ]`).

5. **`each('contextArrayKey', childFSM)` (Parallel Master/Slave Orchestration)**

- Spawns an isolated `childFSM` instance for each ID in `ctx[contextArrayKey]`.
- Instances stay alive in the store as long as their ID remains in the array (allowing UI split-views to display completed items).
- Automatically dispatches `'ALL_DONE'` to the parent machine when `instances.length > 0 && instances.every(i => i.isDone())`.

---

## 5. Complete Code Example (End-to-End)

### 5.1 Pure FSM Definition (`auth.machine.ts`)

```typescript
import { createFSM, awaiting, stay, transitions } from '@ngx/flatstate';
import { User, Credentials, UserEntitlements } from '@app/core/auth';

export interface AuthContext {
  credentials: Credentials;
  user: User | null;
  policy: UserEntitlements;
  error: string | null;
}

// Pure guards (0% DI, reads only ctx):
const hasValidInput = (ctx: AuthContext) => ctx.credentials.email.includes('@');
const shouldShowPromo = (ctx: AuthContext) => ctx.policy.showUpsellAds;

// Optional extracted transition group (100% typed & linted):
const handleLoginSubmit = transitions<AuthContext>([
  ['loginView', 'LOGIN', awaiting('authenticating'), { guard: hasValidInput }],
  ['loginView', 'LOGIN', stay(), { patch: () => ({ error: 'Invalid email' }) }],
]);

export const authFSM = createFSM({
  id: 'auth',
  initial: 'loginView',
  events: {} as {
    LOGIN: void;
    DISMISS_PROMO: void;
    CANCEL: void;
    NetworkTimeoutError: { message: string };
  },
  context: {
    credentials: { email: '', password: '' },
    user: null,
    policy: {
      showUpsellAds: true,
      canBypassApproval: false,
      discountPercent: 0,
      maxProjects: 3,
    },
    error: null,
  } satisfies AuthContext,
  transitions: [
    /* FROM              VIA                      TO                          OPTIONS */
    ...handleLoginSubmit,

    // User cancels in-flight request -> Engine automatically aborts Effect fiber / AbortSignal:
    ['authenticating', 'CANCEL', 'loginView'],

    // Task succeeded ('DONE') -> Task return value is already merged into ctx before guards run!
    ['authenticating', 'DONE', 'proUpsellPromo', { guard: shouldShowPromo }],
    ['authenticating', 'DONE', 'loggedIn'], // Mandatory unguarded fallback

    // Task failed ('ERROR' or Effect TaggedError _tag):
    ['authenticating', 'NetworkTimeoutError', 'offlineRetryView'],
    [
      'authenticating',
      'ERROR',
      'loginView',
      {
        patch: (_ctx, err: Error) => ({ error: err.message }),
      },
    ],

    ['proUpsellPromo', 'DISMISS_PROMO', 'loggedIn'],
  ],
});
```

### 5.2 SignalStore + DI + Effect-TS Integration (`auth.store.ts`)

```typescript
import { Injectable, inject } from '@angular/core';
import { signalStore } from '@ngrx/signals';
import { Effect, Schedule } from 'effect';
import { withStateMachine } from '@ngx/flatstate-angular';
import { GlobalAuthStore, AuthApiService } from '@app/core/auth';
import { authFSM } from './auth.machine';

@Injectable()
export class AuthFeatureStore extends signalStore(
  withStateMachine(authFSM, {
    // 1. Reactive Context Mirroring (syncs Layer 1 signals into FSM context without coupling):
    syncContext: (globalAuth = inject(GlobalAuthStore)) => ({
      policy: globalAuth.policy, // Signal<UserEntitlements> synced into ctx.policy
    }),

    // 2. Compile-time enforced Tasks for every awaiting('...') state in authFSM:
    tasks: (authApi = inject(AuthApiService)) => ({
      // Supports both Promise<Partial<Context>> and Effect<Partial<Context>, TaggedError, never>
      authenticating: (ctx) =>
        authApi.loginEffect(ctx.credentials).pipe(
          Effect.retry({
            times: 2,
            schedule: Schedule.exponential('300 millis'),
          }),
          Effect.map((user) => ({ user, error: null })), // Auto-patched into ctx BEFORE 'DONE' guards evaluate!
        ),
    }),
  }),
) {}
```

---

## 6. Runtime Engine Mechanics (`withStateMachine`)

1. **Deterministic Task-to-Context Flow:**

- When the machine enters `awaiting('stateName')`, the store invokes `tasks.stateName(ctx, abortSignal)`.
- If the task returns a `Promise` or an `Effect.Effect`:
- **On Success (`output: Partial<TContext>`):** The engine first merges `output` into `store.fsmContext()`, and **then** dispatches `'DONE'` (with `output` as payload) so all `'DONE'` guards immediately see the fresh data in `ctx`.
- **On Failure (`err`):** If `err` is an Effect `TaggedError` (`'_tag' in err`) and the machine defines a transition for `[currentState, err._tag]`, the engine dispatches `err._tag`; otherwise it dispatches `'ERROR'` with `err` as payload.
- **On State Exit (Cancellation):** If the machine leaves `'stateName'` before the task settles (e.g., via `'CANCEL'`), the engine immediately calls `abortController.abort()` and `Effect.runFork(Fiber.interrupt(fiber))`.

2. **Exposed Store Signals:**

- `store.fsmState()`: `Signal<StateUnion>`
- `store.fsmContext()`: `Signal<TContext>`
- `store.isPending()`: `Signal<boolean>` (true whenever current state is an `awaiting` node)
- `store.send(event, payload?)`: Type-safe event dispatcher.

---

## 7. Custom ESLint Plugin Specification (`@ngx/eslint-plugin-flatstate`)

The linter inspects all AST calls to `createFSM({ transitions: [...] })`, `subMachine({ transitions: [...] })`, and `transitions([...])`.

| Rule ID                        | Severity           | Description & Enforcement                                                                                                                                                         |
| ------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `group-contiguous-transitions` | `error` (auto-fix) | All rows sharing the exact same `[FROM, VIA]` pair must be placed directly adjacent to each other.                                                                                |
| `require-fallback-transition`  | `error`            | If any row in a `[FROM, VIA]` group defines a `{ guard }`, the **last** row of that `[FROM, VIA]` group **must not** have a `guard` (use `stay()` if no state change is desired). |
| `no-unreachable-transitions`   | `error`            | An unguarded row for `[FROM, VIA]` must never appear above another row with the same `[FROM, VIA]`.                                                                               |
| `require-awaiting-handlers`    | `error`            | Every state wrapped in `awaiting('x')` in Column 3 must have at least one `[ 'x', 'DONE', ... ]` row and at least one `[ 'x', 'ERROR', ... ]` row in Column 1.                    |
| `awaiting-naming-convention`   | `error`            | State names inside `awaiting('...')` must use the present participle suffix `-ing` (e.g., `'authenticating'`, `'loadingData'`).                                                   |
| `complete-extracted-groups`    | `error`            | A `[FROM, VIA]` pair defined inside a `transitions([...])` variable must not be split across both the variable and the parent `createFSM` array.                                  |
| `pure-machine-definition`      | `error`            | Forbids importing `@angular/core` (`inject`), services, or stores inside `*.machine.ts` files.                                                                                    |

---

## 8. Implementation Roadmap for Antigravity

### Phase 1: Core DSL & Type Engine (`libs/flatstate-core`)

1. Implement `createFSM`, `awaiting`, `stay`, `transitions`, `subMachine`, `finalState`, and `each`.
2. Implement TypeScript type extractors (`ExtractStates`, `ExtractAwaitingNodes`, `RequiredTasksMap`) to enforce that every `awaiting('x')` node requires a corresponding entry in the store's `tasks` map.
3. Implement static Mermaid stateDiagram-v2 generator (`toMermaid(fsm)`) that renders `awaiting()` nodes with `⚡` badges and `subMachine()` as composite blocks.

### Phase 2: Angular SignalStore Bridge & Effect Runner (`libs/flatstate-angular`)

1. Implement `withStateMachine(fsm, { syncContext, tasks, onEnter })` as a custom `@ngrx/signals` `signalStoreFeature`.
2. Build the dual Promise / Effect-TS task runner with automatic `AbortController` and `Fiber.interrupt` cleanup on state exit.
3. Implement pre-DONE context patching and `_tag` error routing.

### Phase 3: ESLint Plugin & Nx Generators (`libs/eslint-plugin-flatstate`)

1. Implement the 7 AST rules listed in Section 7 for `createFSM` and `transitions()`.
2. Configure `@nx/enforce-module-boundaries` for `type:core`, `type:domain`, and `type:feature`.
3. Add a `.cursorrules` / agent instruction file referencing this blueprint.
