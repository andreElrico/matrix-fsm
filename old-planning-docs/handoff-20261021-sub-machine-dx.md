# Handoff: Sub-Machine DX — "One Mention" Wiring (2026-10-21)

## Problem
After commit `af9cbc0` (barista sub-machine), using `baristaFSM` inside `coffeeShopFSM` required **3 manual couplings**:

1. `coffee-shop.machine.ts` → `baristaFSM` in transitions (intended, the real coupling)
2. `coffee-shop.store.ts` → `withBarista()` (state + methods)
3. `coffee-shop.store.ts` → `...createBaristaTasks(api)` inside `tasks`

## Decision
User's preference: store/tasks should be **bound to `baristaFSM`** so the parent doesn't have to re-wire them.

Hard constraints that rule out "zero mentions":
- `*.machine.ts` must stay pure (no Angular, enforced by `pure-machine-definition`) → the machine cannot carry the Angular implementation.
- A global side-effect registry (`registerMachine(baristaFSM, ...)` at module load) would break tree-shaking (`sideEffects: false`), lose compile-time safety, and fail silently if the file isn't imported.

**Chosen solution:** tasks are bound to the FSM inside the child's composable feature via the new `withMachineTasks(fsm, tasks)`. The parent store mentions the child **exactly once** (`withBarista()`), and the compiler guarantees completeness.

## Implemented (uncommitted)
### `@matrix-fsm/angular` ([with-state-machine.ts](packages/angular/src/lib/with-state-machine.ts))
- `FSM_TASKS`: branded string constant `'__fsmTasks'` (prevents TS4058/TS4020 "cannot be named" / "private name" errors when exported from libraries).
- `withMachineTasks(fsm, tasks | () => tasks)`: a `signalStoreFeature` that adds `TasksMapFor<fsm>` to `props[FSM_TASKS]`. It merges with earlier contributions and runs in injection context, so `inject()` works. In dev mode it warns about task keys that aren't awaiting states of `fsm`.
- `withStateMachine(fsm, config)`: task ownership is now split:
  - `OwnAwaitingNodes<TFSM>` (e.g. `checkingLoyalty`) are **required** in `config.tasks`.
  - `SubMachineAwaitingNodes<TFSM>` (e.g. `brewingCoffee`) are **required as feature input** `RequiredTaskSlots<TFSM>`, i.e. `props[FSM_TASKS]`. If you forget `withBarista()`, `withStateMachine(...)` fails to compile with `MachineTaskSlots<"brewingCoffee">`.
  - Sub-machine tasks can optionally be overridden in `config.tasks` (useful for tests and mocks).
  - At runtime, `tasksMap = { ...store[FSM_TASKS], ...config.tasks }`. In dev mode it warns about awaiting states that have no task.
- Project reference & composite configs fixed across all packages (`packages/*/tsconfig.lib.json` has `composite: true`, and playground explicit `typecheck` target added).
- Full verification: `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass 100% cleanly!

### Playground
- [barista.store.ts](apps/playground/src/app/features/coffee-shop/barista.store.ts): `withBarista()` = `withState` + `withMethods` + `withMachineTasks(baristaFSM, ...)`. `createBaristaTasks` removed.
- [coffee-shop.store.ts](apps/playground/src/app/features/coffee-shop/coffee-shop.store.ts): only `withBarista()` + own `checkingLoyalty` task.

### Tests ([with-state-machine.spec.ts](packages/angular/src/lib/with-state-machine.spec.ts))
- 1: missing sub task → `@ts-expect-error` moved onto `withStateMachine(...)` (error is now a missing task slot).
- 1b: `withMachineTasks(subBarista, …)` satisfies the parent at compile time.
- 1c: runtime — contributed `brewingCoffee` runs when entering the sub-machine.

## Open Questions / Next Steps
1. **Sub-machine input** (user question: "how does barista get input from the coffee shop?"). Today: *structural shared context* — `BaristaContext.selectedDrink` is read from the merged parent store state because keys match; `ExtractContext` intersects both contexts (conflicting types → `never`). Works, but implicit. Proposal: explicit port mapping, e.g. `invoke(baristaFSM, { input: (ctx) => ({ selectedDrink: ctx.selectedDrink }) })` in Column 3, so the child stays name-independent from the parent.
2. `_setBrewError` writes `error` which barista doesn't own (cast via `WritableStateSource`). Consider: barista declares `error` as a required *input* slot rather than casting.
3. Parent `_finishCoffee` resets `baristaResult` (barista-owned state). Better: barista resets its own slice (e.g. on entering `ticketQueued`).
4. Docs: update `BEST_PRACTICES.md` §2, `.cursorrules` §2, `blueprint.md` with the `withMachineTasks` pattern ("a sub-machine's feature owns state + methods + tasks; the parent mentions it once").
5. Optional ESLint rule: forbid spreading child tasks into parent `tasks` (`...createXTasks()`).
6. Run full `pnpm typecheck` + `pnpm test` + `pnpm lint`, then commit.
