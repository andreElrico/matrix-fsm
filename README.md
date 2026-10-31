# `@matrix-fsm` — Flat 2D Matrix State Machines for Angular SignalStore

`@matrix-fsm` is a type-safe, zero-JSON-hell state machine architecture for TypeScript and `@ngrx/signals` (`SignalStore`), backed by compile-time graph validation and AST lint rules.

---

## Packages

- **`@matrix-fsm/core`**: Pure TypeScript (`0%` Angular) 4-column tuple DSL (`[FROM, VIA, TO, OPTIONS?]`), FIFO Run-to-Completion runner (`createMachineInstance`), Mermaid diagram generator (`toMermaid`), and recursive type extractors.
- **`@matrix-fsm/angular`**: First-class `@ngrx/signals` integration (`withStateMachine`, `createMachineFeature`, `whenSignal`, `createFeatureTester`) with native `Promise` + `AbortSignal` and RxJS `Observable` support (`effect` and `rxjs` are optional peer dependencies).
- **`@matrix-fsm/angular/effect`**: Optional secondary entrypoint (`effectTaskAdapter`) for Effect-TS Fibers and `Data.TaggedError` routing.
- **`@matrix-fsm/eslint-plugin`**: Static AST & Graph Conservation ESLint rules with auto-fix for 2D matrix column alignment.

---

## Key Features

1. **The Sandwich Pattern (`createMachineFeature`)**:
   Combines **Public Contract** (`inputs`, `events`, `outputs`, `states`) at the top, the pure **Transition Matrix** (`transitions`) in the middle, and **Encapsulated Runtime** (`state`, `methods`, `tasks`, `on`) at the bottom. Mounts directly onto `signalStore(withStateMachine(myFeature))` as a root feature or spawns automatically as a zero-leakage sub-actor (`store.actors.<id>()`).
2. **Unified Tuple Outputs (`finalState()` + `output`)**:
   Emit strongly-typed intermediate or terminal outputs to parent machines via `{ output: ['COFFEE_READY', (ctx, ev) => ({ ... })] }` or void shorthand `finalState('CANCELLED')`.
3. **Global Events (`anyState()`) & Declarative Timers (`after(ms)`)**:
   Handle cross-cutting events from any state via `[anyState(), 'LOGOUT', 'loginView']` and declarative timeouts via `['splash', after(1000), 'home']` with automatic `clearTimeout` cleanup on state exit or sub-actor hard-kill.
4. **Actor Combinators (`all`, `race`, `any`, `each`) & Signal Bridge (`whenSignal`)**:
   Orchestrate parallel sub-actors with `all(m1, m2)`, `race(m1, m2)`, `any(m1, m2)`, and `each('items', itemFSM)`, and bridge external Angular Signals via `whenSignal(urlSig, (url) => url ? ['DEEP_LINK', { url }] : null)`.
5. **Fast Unit Testing without Angular `TestBed` (`createFeatureTester`)**:
   Test `createMachineFeature` actors in pure Vitest in `< 5ms` with mocked `inputs` and `tasks`.
6. **AST & Graph Conservation Rules (`@matrix-fsm/eslint-plugin`)**:
   - `align-matrix-columns` (auto-fix)
   - `group-contiguous-transitions` (auto-fix)
   - `require-fallback-transition`
   - `no-unreachable-transitions`
   - `require-awaiting-handlers`
   - `awaiting-naming-convention`
   - `complete-extracted-groups`
   - `pure-machine-definition`
   - `no-conflicting-final-output`
   - `require-exit-for-targets`
   - `no-unreachable-states`

---

## Commands

```sh
pnpm nx run-many -t test,lint,build
```
