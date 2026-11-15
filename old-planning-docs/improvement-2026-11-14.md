# `@matrix-fsm` Public API & Implementation Audit (2026-11-14)

> **Scope:** `@matrix-fsm/core`, `@matrix-fsm/angular`, `@matrix-fsm/angular/effect`, `@matrix-fsm/eslint-plugin` (`@matrix-fsm/router` excluded).

---

## 1. What Is Wrong (Bugs, Broken Contracts & Type/Runtime Defects)

### A. Base Library (`@matrix-fsm/core` & `@matrix-fsm/angular`)

1. **Omitting Column 4 (`OPTIONS`) on `awaiting('state')` Bypasses Compile-Time `{ call }` Enforcement**
   - **Where:** [types.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/types.ts#L1645-L1665), [types.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/types.ts#L1484-L1493)
   - **Bug:** `ValidateTransitionRows` only delegates to `ValidateRowOptions` (which enforces `StrictAwaitingTransitionOptions` with required `call`) in the `: Rest extends readonly [any]` branch. Writing a 3-tuple `['idle', 'FETCH', awaiting('loading')]` without a 4th element takes the `: TTransitions[K]` fallback and compiles without error, then silently hangs at runtime in `isPending() === true`.

2. **`StrictTransitionOptions` Disables `output` Type-Checking Whenever `outputs` Declares >1 Event**
   - **Where:** [types.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/types.ts#L482-L484), [types.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/types.ts#L502-L504), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2900-L2928)
   - **Bug:** `readonly output?: IsUnion<Extract<keyof TOutputs, string>> extends true ? unknown : TransitionOutputTuple<...>` widens `output` to `unknown` whenever `TOutputs` has 2+ keys. Additionally, `HasDeclaredVoidOutput<TOutputs>` in `MachineFeatureConfig` / `EffectMachineFeatureConfig` widens `TOutputContext` to `any` for *all* outputs as soon as a single `void` output exists in `outputs`.

3. **`fsm.evaluate()` Executes `input` and `output` Selectors Prematurely (Before `call`) and During `can()`**
   - **Where:** [fsm.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/fsm.ts#L326-L366), [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L805-L815), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2095-L2108)
   - **Bug:**
     - `fsm.evaluate()` runs `options.input(ctx, payload)` and `options.output[1](ctx, payload)` on the *pre-`call`* context, and the runner runs them a **second time** after `invokeCallSelector` mutates state.
     - If `call` initializes a context field read by `input` or `output` (e.g. `_saveResult` sets `ctx.result`, `output` reads `ctx.result.id`), the premature evaluation inside `fsm.evaluate()` throws `TypeError` before `call` ever runs.
     - `store.can(event, payload)` calls `fsm.evaluate()`, executing `input`/`output` mappers and cloning context on every UI readiness check.

4. **`hasTransitionFor('anyState', ...)` Uses Wrong Wildcard Key (`'anyState'` vs `'*'`) & Rejects `[anyState(), 'ERROR', ...]` on Sub-Machines**
   - **Where:** [fsm.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/fsm.ts#L60-L62), [fsm.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/fsm.ts#L279-L290), [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L370-L395), [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L468), [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L514), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1219), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1609), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1660-L1670), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1725), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1803)
   - **Bug:**
     - `resolveSourceId(anyState())` returns `'*'`, but combinator handlers in both `runner.ts` and `with-state-machine.ts` check `fsm.hasTransitionFor('anyState', ...)`, which always returns `false`.
     - Sub-machine output/completion checks (`fsm.hasTransitionFor(refId, outcome)`) do not check `fsm.hasTransitionFor('*', outcome)`. Handling sub-machine `'ERROR'` via `[anyState(), 'ERROR', ...]` throws `Sub-machine emitted output 'ERROR', but parent has no matching transition`.

5. **False-Positive `awaitingStates` Heuristic Corrupts Resting States That Handle `'DONE'` or `'ERROR'` Events**
   - **Where:** [fsm.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/fsm.ts#L246-L251), [fsm.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/fsm.ts#L385-L386), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1060), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2083-L2092)
   - **Bug:** `if (via === 'DONE' || via === 'ERROR') awaitingStates.add(fromItem)` marks any plain resting state that transitions on `'DONE'` or `'ERROR'` as an `awaiting` state. Consequently:
     - `isPending()` is permanently `true` while resting in that state.
     - Transitioning into that state with a synchronous `{ call: (m) => m._init }` treats `_init` as an async `awaiting` task (`isEnteringAwaiting === true`), and its `void` return immediately dispatches `'DONE'`, skipping the state in the same tick.

6. **`each()` Pool Registry Is Never Cleared on Exit or Completion in `@matrix-fsm/angular`**
   - **Where:** [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1494), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1558-L1579), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2065-L2075)
   - **Bug:** Exiting an `each(key, childFSM)` state (either via `'ALL_DONE'` or parent cancellation) destroys running child nodes in `eachRegistries.get(key)` but never removes them from the map or resets `childMachinesSig`. Re-entering `each()` with the same item IDs hits `if (!registry.has(id))` and reuses the dead/completed instances instead of spawning new ones, and `store.childMachines()` leaks stale snapshots after exit.

7. **Named `finalState('OUTCOME')` Leaks Child Private Context into Parent Store**
   - **Where:** [fsm.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/fsm.ts#L378-L383), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1195-L1216), [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L378-L381)
   - **Bug:** `hasFinalPayloadSelector` is `true` for bare `finalState()` (`to.isBare`), but `false` for named void outcomes like `finalState('CANCELLED')` (where `options.output` is forbidden). When a `createMachineFeature` child exits via `finalState('CANCELLED')`, `checkSubNodeCompletion` sees `hasSelector === false`, copies the child's entire private `fsmContext()` into the parent via `applyContextPatch` (triggering `@ngrx/signals` unknown slice warnings and violating encapsulation), and passes the child's context as the event payload for a `void` outcome.

8. **Unhandled Async Errors (`__UNHANDLED_ERROR__`) Crash Single Sub-Machines, Disappear in Root/`each()`, and Hang in `@matrix-fsm/core`**
   - **Where:** [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1290-L1296), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1512-L1519), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1604-L1615), [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L993)
   - **Bug:**
     - In `enterSubMachineNode`, `onChildEmitOutput` does not handle `emitted.type === '__UNHANDLED_ERROR__'` (unlike `enterCombinatorNode`), throwing `Sub-machine emitted output '__UNHANDLED_ERROR__'`.
     - In `syncEachInstances` (`each()`), `onChildEmitOutput` is not passed at all, and `checkEachAllDone` treats `finalOutcome() === 'ERROR'` as `'ALL_DONE'` (success).
     - On a root machine without an `'ERROR'` transition, `onEmitOutput` is `undefined`, silently swallowing the error and leaving the machine stuck in the awaiting state.
     - In `@matrix-fsm/core` (`runner.ts`), unhandled child async errors are never propagated to parent sub-machines or combinators.

9. **Dynamic `after((ctx) => ms)` and `every((ctx) => ms)` Break With Guarded Fallbacks**
   - **Where:** [primitives.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/primitives.ts#L120-L153), [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L299-L320), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1904-L1926)
   - **Bug:** Every call to `after(fn)` / `every(fn)` allocates a unique `id` (`__after_fn_1__`, `__after_fn_2__`). Writing a guarded timer row followed by an unguarded fallback row schedules two separate timers; if the guard on Row 1 returns `false` when `__after_fn_1__` fires, Row 2 (`__after_fn_2__`) does not match the event ID. Also, timers inside a `VIA` array (`['CANCEL', after(5000)]`) are allowed by types/evaluator but never scheduled by `scheduleStateTimers`.

10. **Guarded `every(ms)` Timer Permanently Dies If No Row Matches on a Tick**
    - **Where:** [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L742-L747), [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L829-L837), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2032-L2036), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2120-L2128)
    - **Bug:** `every(ms)` is scheduled via one-shot `setTimeout` and only re-armed inside the `if (evaluation.stayed)` block. If `evaluation.matched` is `false`, `processOneEvent` returns early and the recurring timer never fires again.

11. **`patchContext()` and `syncContext` Updates Do Not Re-Evaluate `every()` Timers, `always()` Branches, or `each()` Pools**
    - **Where:** [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L1141-L1146), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2371-L2373), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2586-L2588)
    - **Bug:** Contrary to `README.md` (line 122), `patchContext()` only mutates context signals; it never updates dynamic `every((ctx) => ...)` delays, never triggers `always()` transitions, and in Angular never forwards patches to active child machines or `each()` pools.

12. **Synchronous Exceptions in `call` or `guard` Corrupt Machine State & Leave Stale Events in Queue**
    - **Where:** [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L774-L792), [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L1068-L1092), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2061-L2092), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2246-L2269)
    - **Bug:** `currentState` and `stateEpoch` are mutated *before* synchronous `invokeCallSelector` runs. If `call` throws, the state has already changed, but `onEnter`, timers, sub-machine spawning, and `inspect` are skipped, and remaining queued events stay in `eventQueue` until the next `send()`.

13. **RxJS `Observable` Completing Without Emitting (`EMPTY`) Fires `'DONE'` With `undefined` Payload**
    - **Where:** [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1413-L1461)
    - **Bug:** `complete()` on an Observable that never emitted a `next` value calls `handleTaskSuccess(handle, undefined)`, routing to `'DONE'` with `undefined` even though TypeScript types the `'DONE'` payload as `T` (non-undefined).

14. **`store.actors` Has Unsound Index Signature & Returns `null` for Grandchildren and `each()` Actors; `store.childMachines()` Omits Combinators**
    - **Where:** [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L334-L338), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L918-L945), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1538-L1556)
    - **Bug:**
      - `ActorsMapFor<TFSM>` intersects `{ [M in ExtractAllSubMachines<TFSM> as M['id']]: ... }` with `Record<string, Signal<...>>`, so arbitrary typos (`store.actors.typo()`) compile without error.
      - `getOrCreateActorSignal` only inspects direct `activeSubNode` and direct `activeCombinator` (ignoring nested grandchildren and `each()` children that `ExtractAllSubMachines` includes in the type).
      - `store.childMachines()` only tracks `each()` pools, never `all()` / `race()` / `any()` combinators (contradicting `README.md` line 116), and `store.actors.<id>()` only returns context (not child `state`), leaving no public API to read the active state of combinator children.

15. **`provideStateMachine(feature, configOverride)` Wipes Out Feature Defaults (`state`, `taskAdapter`, `syncContext`, `onEnter`/`onExit`)**
    - **Where:** [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L520-L528), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L671)
    - **Bug:** `createScopedMachineRunner` resolves config via `const effectiveConfig = config ?? defaultFeatureConfigs.get(fsm)`. Passing an inline override object to `provideStateMachine(feature, { methods: ... })` completely replaces `defaultFeatureConfigs.get(fsm)` instead of merging it.

16. **`createFeatureTester` Temporal Dead Zone (TDZ) Crash on Initial `always()` -> `finalState()`**
    - **Where:** [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2560-L2565), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L3201-L3226)
    - **Bug:** `createScopedMachineRunner` dispatches initial `'__always__'` synchronously before returning `runner`. If that transition reaches `finalState()`, `onNotifyParent` accesses `runner.isDone()` while `const runner` is still in TDZ, throwing `ReferenceError: Cannot access 'runner' before initialization`.

17. **Signal Proxy `wrapSignalWithWatchFlush` Mutates State Inside Reactive Reads & Misses Nested DeepSignals**
    - **Where:** [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2656-L2664), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2825-L2847)
    - **Bug:** Wrapping top-level `stateSignals` in a `Proxy` `apply` trap that runs `flushPendingSignalWatches()` (which calls `patchState` / `rawContextSig.update`) causes signal writes during `computed()` evaluation if a `syncContext` signal is dirty, and does not intercept nested `DeepSignal` reads (`store.user.name()`).

18. **Flagship `README.md` Example Fails Both TypeScript Compilation and ESLint**
    - **Where:** [README.md](file:///home/hanshannes/Development/matrix-fsm/README.md#L301), [README.md](file:///home/hanshannes/Development/matrix-fsm/README.md#L330), [types.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/types.ts#L1031-L1040), [valid-any-state-target.ts](file:///home/hanshannes/Development/matrix-fsm/packages/eslint-plugin/src/lib/rules/valid-any-state-target.ts#L71-L85)
    - **Bug:** `[anyState(), 'RESET_SHOP', 'customerBrowsing', { call: (m) => m._resetOrder }]` in `README.md` is rejected by `IsInvalidAnyStateRow` in `types.ts` and `valid-any-state-target` in ESLint (which forbid `anyState()` transitioning to a concrete state unless `VIA === 'ERROR'`).

---

### B. Effect-TS Integration (`@matrix-fsm/angular/effect`)

1. **`runEffect(effect, signal)` Never Settles Its Returned Promise on Abort or Fiber Interruption (Deadlock / Memory Leak)**
   - **Where:** [effect/index.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/effect/index.ts#L220-L253)
   - **Bug:**
     - If `signal?.aborted` is already `true` (line 225), `new Promise` returns immediately without calling `resolve` or `reject`.
     - When `signal` aborts while in flight (line 231), `onAbort` sets `settled = true` and interrupts the fiber, but never rejects or resolves the Promise.
     - When the fiber is interrupted externally (line 248: `!Cause.hasInterruptsOnly(exit.cause)`), neither `resolve` nor `reject` is called.
     - If used with `createFeatureTester`, `inFlightPromises` tracks the never-settling Promise and `await tester.flushTasks()` (`Promise.allSettled`) deadlocks forever.

2. **`createFeatureTester.flushTasks()` Does Not Track Effect Fibers (`taskAdapter`)**
   - **Where:** [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1343-L1350), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L3228-L3237)
   - **Bug:** `startAwaitingTaskIfNeeded` only calls `onTrackPromise` for native Promises, never for `taskAdapter.execute`. For `createEffectMachineFeature`, `flushTasks()` falls back to polling `setTimeout(0)` at most 50 times; any Effect taking >50 macrotask ticks (or waiting on an Effect timer/latch) leaves `flushTasks()` resolving prematurely while the fiber is still running.

3. **`NormalizeEffectMethodReturn` Lies About Store Method Return Types (`Promise` Instead of `Effect`)**
   - **Where:** [effect/index.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/effect/index.ts#L43-L54), [effect/index.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/effect/index.ts#L202-L210)
   - **Bug:** `createEffectMachineFeature` returns `MachineFeatureDefinition<..., NormalizeEffectMethods<TMethods>, ...>`. When mounted via `withStateMachine`, the store's exposed methods are typed as returning `Promise<A | OutcomeNode<...>>`, whereas at runtime they return an unexecuted `Effect.Effect<A, E, R>`.

4. **Effect Requirements (`R`) Are Typed as `any` and Executed Without a `Runtime` or `Layer`**
   - **Where:** [effect/index.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/effect/index.ts#L44), [effect/index.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/effect/index.ts#L68-L70)
   - **Bug:** `R extends Effect.Effect<infer A, infer E, any>` accepts Effects with unsatisfied context requirements (`R !== never`) without a compile error. `Effect.runFork` executes them against the bare default runtime, turning missing services into runtime fiber defects.

5. **`Cause.squash` Conflates Untyped Defects (`Cause.Die`) With Expected Failures (`E`) and Drops Parallel Causes**
   - **Where:** [effect/index.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/effect/index.ts#L78-L84)
   - **Bug:** In `effectExecutorAdapter`, `Cause.squash(exit.cause)` extracts defects (`Effect.die`, thrown bugs, missing service defects) and passes them to `onFailure`, which dispatches `'ERROR'` to a handler typed as receiving `E` (expected domain error), and discards secondary errors in `Cause.Parallel` / `Cause.Sequential`.

6. **Returning an `Effect` Inside Standard `createMachineFeature` or `createMachineInstance` Silently Succeeds as `'DONE'` With the Raw `Effect` Object**
   - **Where:** [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1464-L1465), [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L1040-L1042)
   - **Bug:** Without `effectExecutorAdapter`, an `Effect` object is not a Promise, Observable, or ResourceRef, so it hits the synchronous return fallback (`handleTaskSuccess(handle, result)`), never running the Effect and passing the raw `Effect` structure as the `'DONE'` payload.

7. **Using `provideStateMachine` on an Effect Feature Drops `effectExecutorAdapter`**
   - **Where:** [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L520-L528), [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L671)
   - **Bug:** Passing a config override in `provideStateMachine(myEffectFeature, { methods: ... })` overrides the `defaultFeatureConfigs` entry containing `taskAdapter: effectExecutorAdapter`, causing all Effects in the provided sub-machine to stop executing and resolve synchronously as raw Effect objects.

---

### C. Static Analysis (`@matrix-fsm/eslint-plugin`)

1. **`require-awaiting-handlers` Misclassifies `TaggedError` (`_tag`) Rows as `'DONE'` Handlers**
   - **Where:** [require-awaiting-handlers.ts](file:///home/hanshannes/Development/matrix-fsm/packages/eslint-plugin/src/lib/rules/require-awaiting-handlers.ts#L141-L160)
   - **Bug:** Any non-external event exiting an `awaiting()` state (such as `['checking', 'NetworkTimeoutError', 'retry']` for Effect `TaggedError` or custom `Error.name`) is added to `doneStates`. If a machine handles `'NetworkTimeoutError'` and `'ERROR'` but forgets `'DONE'`, the rule fails to report the missing `'DONE'` transition.

2. **`no-shadowed-transitions` Is a 100% Duplicate Alias of `no-unreachable-transitions` Enabled Twice in `recommended`**
   - **Where:** [no-shadowed-transitions.ts](file:///home/hanshannes/Development/matrix-fsm/packages/eslint-plugin/src/lib/rules/no-shadowed-transitions.ts#L1-L9), [eslint-plugin/src/index.ts](file:///home/hanshannes/Development/matrix-fsm/packages/eslint-plugin/src/index.ts#L63-L64)
   - **Bug:** `export const noShadowedTransitions = noUnreachableTransitions;` causes every unreachable/shadowed row to be reported twice under two rule IDs.

3. **`no-unreachable-states` Only Checks In-Degree >= 1 Instead of Reachability From `initial`**
   - **Where:** [no-unreachable-states.ts](file:///home/hanshannes/Development/matrix-fsm/packages/eslint-plugin/src/lib/rules/no-unreachable-states.ts#L106-L120)
   - **Bug:** Disconnected state cycles (`a -> b`, `b -> a`) have `toKey !== fromKey` and are marked reachable even though no path exists from `initial`.

4. **`require-awaiting-handlers` Does Not Bail Out on Unresolved (Imported) Spreads**
   - **Where:** [require-awaiting-handlers.ts](file:///home/hanshannes/Development/matrix-fsm/packages/eslint-plugin/src/lib/rules/require-awaiting-handlers.ts#L71-L81)
   - **Bug:** Unlike `no-unreachable-states` and `require-exit-for-targets` (which track `hasUnresolvedSpread`), `require-awaiting-handlers` ignores unresolved spreads and emits false positives when `'DONE'`/`'ERROR'` handlers live in an imported `transitions()` group.

---

## 2. What Is Missing (Feature & API Gaps)

### A. Base Library (`@matrix-fsm/core` & `@matrix-fsm/angular`)

1. **No Pluggable `taskAdapter` or Async Primitive Parity in `@matrix-fsm/core` (`createMachineInstance`)**
   - `createMachineInstance` only handles `PromiseLike` and sync values; it lacks `taskAdapter` hooks, `Subscribable` support, `actors` map, `childMachines`, and `sendToChild`, making `createMachineFeature` / `createEffectMachineFeature` incompatible with the pure core runner.
2. **No Public API to Read Active State of Combinator (`all` / `race` / `any`) Children**
   - `store.fsmSubState()` only reflects a single sub-machine (`activeSubNode`). `store.actors.<id>()` only exposes child context (`ActorStateOf<M>`), not `{ state, context, isPending }`. `store.childMachines()` only exposes `each()` pools.
3. **No `AbortSignal` / Task Argument Forwarding on Self-Re-Entry or `restoreSnapshot()`**
   - `awaitingCallSelectors` only stores the *first* row's `call` selector per awaiting state ([fsm.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/fsm.ts#L258)). If two transitions enter `awaiting('loading')` with different `call` methods or payloads, `restoreSnapshot()` and `reset()` invoke the first row's selector with `payload = undefined`.
4. **No Configurable Item Key / Context Property in `each()`**
   - `each('items', childFSM)` relies on brittle `key.slice(0, -1)` singularization (`cities` -> `citie`, `status` -> `statu`) and spreads `...item` directly onto child context, risking property collisions. Furthermore, `core` uses array index for primitive items while `angular` uses `String(item)` or `JSON.stringify(item)`.
5. **No Multi-Emission / Progress Stream Mode for RxJS Observables**
   - Observables in `awaiting()` are hardcoded to `take(1)` (`settled = true` on first `next`). There is no way for an Observable to emit intermediate progress events before completing.
6. **No Shallow/Deep History Target (`history()`)**
   - Returning from a modal/error/pause state to the prior state requires manual context bookkeeping (`ctx.prevState`) and N guarded `always()` rows.
7. **Missing Child Inspection & `sendToChild` in `createFeatureTester`**
   - `FeatureTester` does not expose `actors`, `subState`, `childMachines`, or `sendToChild`, preventing unit tests of hierarchical or `each()` machines through the test harness.

### B. Effect-TS Integration (`@matrix-fsm/angular/effect`)

1. **No `Runtime` / `ManagedRuntime` / `Layer` Injection Support**
   - `createEffectMachineFeature` and `runEffect` have no way to provide an Effect `Runtime<R>` or `Layer<R, E, never>` (e.g., resolved via Angular `inject()` in a factory `runtime: () => inject(AppEffectRuntime)`), forcing every Effect method to manually `.pipe(Effect.provide(...))` and preventing shared fiber supervision/tracing/TestClock.
2. **No `AbortSignal` <-> Effect Fiber Bridge Inside `createEffectMachineFeature`**
   - In `createEffectMachineFeature`, `startAwaitingTaskIfNeeded` creates an `AbortController` and passes `abortController.signal` as the 2nd argument to the method (`_fn(payload, signal, ctx)`), while `effectExecutorAdapter` interrupts the Effect fiber directly on cancel. However, if `effectExecutorAdapter` is used, `abortController.abort()` is still called on exit, which is good—but if the Effect itself calls a Promise-based API via `Effect.tryPromise({ try: (signal) => ... })`, that works via Effect's internal `AbortSignal`, making the 2nd parameter `(payload, signal: AbortSignal, ctx)` redundant/confusing in `createEffectMachineFeature` where `ctx` is pushed to the 3rd parameter.
3. **No Defect (`Cause.Die`) vs Failure (`Cause.Fail<E>`) Routing**
   - No `onDefect` hook or separate defect handling; unexpected defects are silently squashed into domain `'ERROR'` transitions.
4. **No Stream (`Stream.Stream<A, E, R>`) Support in `@matrix-fsm/angular/effect`**
   - Only `Effect.Effect` is handled by `effectExecutorAdapter`; `Stream` from `effect` is not supported.
5. **No `Effect` Support in `@matrix-fsm/core` or Standalone `withStateMachine(fsm)`**
   - `effectExecutorAdapter` is not exported from `@matrix-fsm/angular/effect`, so users using `createFSM` + `withStateMachine(fsm, { taskAdapter })` cannot plug it in without `createEffectMachineFeature`.

---

## 3. What Can Be Improved (Architecture, Type System & DX)

### A. Unify the Execution Engine (`@matrix-fsm/core` + `@matrix-fsm/angular`)
- **Problem:** `createMachineInstance` in [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts) (1,337 LOC) and `createScopedMachineRunner` in [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L637-L2704) (~2,070 LOC) duplicate the entire runtime (FIFO queue, microstep loop, timers, sub-machines, combinators, `each()`, snapshots) with diverging behavior.
- **Improvement:** Make `createMachineInstance` in `@matrix-fsm/core` the single state-machine engine (supporting `taskAdapter` plugins), and reduce `@matrix-fsm/angular` to a thin Signal/DI reactive adapter (~400 LOC) on top of `createMachineInstance`.

### B. Make Effect-TS First-Class & Type-Sound (`@matrix-fsm/angular/effect`)
1. **Preserve True Method Types & Native `Effect` Unwrapping in Core Types:**
   - Instead of rewriting `TMethods` return types into fake `Promise<...>` via `NormalizeEffectMethods<TMethods>` (which corrupts `store._method` types), add a structural `EffectLike<A, E>` (or symbol brand check) to `UnwrapStandardAsyncReturn` in `@matrix-fsm/core` and add a separate `ExtractMethodFailureEvents<TMethods>` extractor so `'DONE'` infers `A`, `'ERROR'` infers `E`, `_tag` infers `Extract<E, { _tag: Tag }>`, and `store._method` retains its real `Effect.Effect<A, E, R>` signature.
2. **Enforce `R = never` (or Configured `TRuntime`) at Compile Time:**
   - Constrain `Effect.Effect<A, E, R>` so `R` must be satisfied by the feature's configured `runtime?: () => Runtime.Runtime<TRuntime> | ManagedRuntime.ManagedRuntime<TRuntime, any>` (defaulting to `TRuntime = never`). Unsatisfied `R` becomes an immediate compile-time error.
3. **Fix `runEffect(effect, signal, runtime?)`:**
   - Reject the Promise with `signal.reason ?? new DOMException('Aborted', 'AbortError')` when `signal` is already aborted or aborts mid-flight, and reject on external fiber interruption.
4. **Integrate `taskAdapter` with `createFeatureTester.flushTasks()`:**
   - Have `CustomTaskAdapter.execute` either return `{ cancel: () => void; done?: Promise<void> }` or invoke an `onSettled` callback tracked by `createFeatureTester`, so `await tester.flushTasks()` deterministically awaits in-flight Effect fibers and RxJS Observables.
5. **Separate `Cause.failureOption` from `Cause.dieOption`:**
   - Route `Cause.failureOption(exit.cause)` to domain `_tag` / `'ERROR'` transitions, and route defects (`Cause.isDie`) to an optional `onDefect` handler or rethrow/report as unhandled defects instead of masquerading as typed `E`.

### C. Fix Type-Level Validation & Contract Consistency (`@matrix-fsm/core`)
1. **Fix `ValidateTransitionRows` Dispatch & `StrictTransitionOptions['output']`:**
   - Add `: IsAwaitingNode<To> extends true` before `: Rest extends readonly [any]` in `ValidateTransitionRows` so 3-element `awaiting()` rows without `{ call }` fail compilation.
   - Remove `IsUnion<Extract<keyof TOutputs, string>> extends true ? unknown` from `StrictTransitionOptions` / `StrictAwaitingTransitionOptions`, and remove `HasDeclaredVoidOutput` context erasure so multi-output machines keep full compile-time output payload & context checking.
   - Compose `From` and `To` validations orthogonally in `ValidateTransitionRows` instead of mutually exclusive `if / else if` branches (`IsSubMachineNode<From>` vs `IsCombinatorNode<To>` vs `IsNamedFinalNode<To>`).
2. **Harmonize `FSMContract` and `MachineFeatureContract` Naming:**
   - Support both `state` and `context` (or standardize on one) across `createFSM` and `createMachineFeature`, and use `Omit<TInputs, keyof TState> & TState` in `MachineFeatureConfig` (matching `ContractContext` in `@matrix-fsm/core`).
3. **Allow Explicit Reset Targets on `anyState()`:**
   - Update `IsInvalidAnyStateRow` and `@matrix-fsm/valid-any-state-target` to allow transitioning to `initial` (or any explicitly listed state) on global reset/cancel events, matching `README.md` line 330 (`[anyState(), 'RESET_SHOP', 'customerBrowsing']`).

### D. Harden Runtime Semantics & Encapsulation
1. **Defer `input` and `output` Selector Execution Until After `call`:**
   - Remove eager `inputSelector` / `outputSelector` calls from `fsm.evaluate()`. Keep `fsm.evaluate()` 100% pure (evaluating only matching + `guard`), making `can()` side-effect-free and preventing pre-`call` null-dereference crashes.
2. **Remove `via === 'DONE' || via === 'ERROR'` Heuristic from `awaitingStates`:**
   - Populate `fsm.awaitingStates` strictly from `isAwaitingNode(fromItem)` and `isAwaitingNode(to)`, and compute `isPending` from actual active task/child handles rather than static state-name membership.
3. **Fix `hasTransitionFor` Wildcard & Sub-Machine Checks:**
   - Replace all `fsm.hasTransitionFor('anyState', ...)` calls with `fsm.hasTransitionFor('*', ...)`, and check `fsm.hasTransitionFor(refId, outcome) || fsm.hasTransitionFor('*', outcome)` on sub-machine and `each()` exits.
4. **Fix Named `finalState('OUTCOME')` Encapsulation:**
   - Treat `finalState('OUTCOME')` as having an explicit void payload (`hasFinalPayloadSelector = true`, `finalPayload = undefined`) so `checkSubNodeCompletion` never dumps private child context into the parent store.
5. **Remove Top-Level `globalThis.ng.ɵcompilerFacade` Side Effect:**
   - Move `ensureJitCompilerFacade()` out of module top-level scope in [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L150-L175) (into test setup or lazy fallback) and mark `"sideEffects": false` in `package.json`.
