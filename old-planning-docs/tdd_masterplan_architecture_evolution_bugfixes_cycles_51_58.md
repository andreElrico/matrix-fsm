# TDD Masterplan: Steckspiel-Perfektion, Timer-Ontologie & Unified `call` Architecture (Cycles 51–58)

**Modus:** Strict Test-Driven Development (🔴 RED -> 🟢 GREEN -> 🔵 REFACTOR)

**Ziel:** Behebung aller ab der Kaskaden-Dropdown-Analyse identifizierten Bugs und Umsetzung der vereinbarten Architektur-Vereinfachungen (Kein Hope-Driven Development, saubere Trennung von `after()` und `every()`, Verschmelzung von `tasks` & `methods` in `{ call }`, nativer Support für Angular `Observable`/`ResourceRef` sowie eine getrennte `effect-ts`-Sandwich-Welt).

## Übersicht der 8 TDD-Zyklen

| Zyklus | Thema / Gefundener Bug | Betroffene Pakete | 
| ----- | ----- | ----- | 
| **Cycle 51** | **Bugfix `can()` bei Guard-Fallbacks:** `instance.can()` / `store.can()` darf bei leeren No-Op-`stay()`-Fallback-Zeilen nicht `true` liefern | `@matrix-fsm/core`, `@matrix-fsm/angular` | 
| **Cycle 52** | **Anti-Hope-Driven `anyState()`:** `anyState()` in Spalte 1 (`FROM`) strikt auf `stay()`, `finalState()` oder `VIA === 'ERROR'` beschränken | `@matrix-fsm/core`, `@matrix-fsm/eslint-plugin` | 
| **Cycle 53** | **Timer-Ontologie (`after` vs. `every`):** `after(ms)` verbietet `stay()` (muss State wechseln); neues `every(ms)`-Primitiv für wiederkehrende Intervalle mit `stay()` | `@matrix-fsm/core`, `@matrix-fsm/angular`, `@matrix-fsm/eslint-plugin` | 
| **Cycle 54** | **Entfernung von `on` / `whenSignal`:** Bereinigung überkomplexer reaktiver Event-Pipelines zugunsten expliziter `store.send()`-Aufrufe | `@matrix-fsm/core`, `@matrix-fsm/angular` | 
| **Cycle 55** | **Unified `{ call }` statt `tasks`:** `awaiting('state')` ruft `{ call: (m) => m._asyncMethod }` in Spalte 4 auf; `DONE` empfängt den Return-Wert als Payload | `@matrix-fsm/core`, `@matrix-fsm/angular`, `@matrix-fsm/eslint-plugin` | 
| **Cycle 56** | **Fachliche Outcome-Events aus `awaiting()`:** Erlaube neben `'DONE'` auch benannte fachliche Outcome-Events (`return { event: 'APPROVED', payload }`) | `@matrix-fsm/core`, `@matrix-fsm/angular` | 
| **Cycle 57** | **90%-Angular-Async-Support in `call`:** Native Unterstützung für `Observable<T>` (Auto-Unsubscribe bei Exit), `Promise<T>` (`AbortSignal`) und Angular `ResourceRef<T>` (`resource` / `rxResource`) | `@matrix-fsm/angular` | 
| **Cycle 58** | **Zwei saubere Sandwich-Welten:** `createMachineFeature` (Angular Standard) vs. `createEffectMachineFeature` (`effect-ts`) auf gemeinsamer Core-Runtime | `@matrix-fsm/angular` | 

## PHASE I: Kaskaden-Bugs, Strikte `anyState()`-Regeln & Timer-Ontologie (Cycles 51–53)

### Cycle 51: Fix `instance.can()` / `store.can()` Returning `true` on Pure No-Op `stay()` Fallbacks

**Hintergrund:** Wenn eine Transition einen `guard` besitzt, erzwingt die ESLint-Regel `require-fallback-transition` eine unbewachte Fallback-Zeile darunter: `['idle', 'SELECT_CITY', stay()]` (ohne `call` und ohne `output`). Aktuell wertet `runner.can('SELECT_CITY')` diese leere Fallback-Zeile als gültigen Treffer (`result !== null`) und gibt `true` zurück, obwohl der Guard `false` geliefert hat! Dadurch sind abhängige UI-Elemente (`[disabled]="!store.can('SELECT_CITY')"`) fälschlicherweise aktiv.

* **🔴 RED (`packages/core/src/lib/core.spec.ts` & `packages/angular/src/lib/with-state-machine.spec.ts`):**

  1. Schreibe einen Test für eine Maschine mit Guard + ESLint-konformem Fallback:

     ```
     transitions: [
       ['idle', 'SELECT_CITY', 'loadingPlaces', { guard: (ctx) => ctx.country !== null }],
       ['idle', 'SELECT_CITY', stay()], // No-Op Fallback für ESLint require-fallback-transition
     ]
     
     ```

  2. Verifiziere, dass bei `country: null` der Aufruf `instance.can('SELECT_CITY')` (bzw. `store.can('SELECT_CITY')`) **`false`** zurückgibt!

  3. Verifiziere gegenläufig, dass eine `stay()`-Zeile **mit** Seiteneffekt (`['ready', 'SELECT_PLACE', stay(), { call: (m) => m._selectPlace }]` oder `{ output: ... }`) bei `can('SELECT_PLACE')` weiterhin **`true`** zurückgibt!

* **🟢 GREEN (`packages/core/src/lib/runner.ts`):**
  Prüfe in `can()` (bzw. `evaluateRowList` bei `dryRun === true`): Wenn die gematchte Zeile als Ziel `isStayNode(result.target)` hat **und** weder `options?.call` noch `options?.output` definiert sind, gilt sie als reiner No-Op-Fallback und `can()` muss `false` zurückgeben.

### Cycle 52: Restrict `anyState()` to `stay()`, `finalState()`, or `'ERROR'` Transitions (No Hope-Driven State Jumps)

**Hintergrund:** Wenn `[anyState(), 'SELECT_2', awaiting('load3')]` erlaubt ist, hebelt das die Zustandsgrenzen der State Machine aus („Hope-Driven Development“). `anyState()` soll ausschließlich für nicht-unterbrechende Querschnitts-Listener (`stay()`), globale Abbrüche (`finalState()`) oder globale Fehlerbehandlung (`VIA === 'ERROR'`) erlaubt sein. Für kaskadierende Übergänge nutzt man stattdessen explizite State-Whitelists oder extrahierte `...transitions`-Gruppen.

* **🔴 RED (`packages/core/src/lib/core.spec.ts` & `packages/eslint-plugin/src/lib/eslint-plugin.spec.ts`):**

  1. Schreibe einen Compile-Time-Test (`@ts-expect-error`), bei dem `[anyState(), 'SELECT_2', 'step3']` oder `[anyState(), 'SELECT_2', awaiting('load3')]` einen TypeScript-Compiler-Fehler wirft!

  2. Verifiziere, dass `[anyState(), 'VOUCHER_SCANNED', stay(), { call: ... }]`, `[anyState(), 'ABORT', finalState()]` und `[anyState(), 'ERROR', 'errorState']` weiterhin fehlerfrei kompilieren.

  3. Schreibe einen ESLint-RuleTester-Test (z. B. in `no-unreachable-transitions` oder einer neuen Regel `valid-any-state-target`), der `[anyState(), 'SOME_EVENT', 'someState']` als Fehler markiert, sofern `TO` nicht `stay()` / `finalState()` und `VIA` nicht `'ERROR'` ist.

* **🟢 GREEN (`packages/core/src/lib/types.ts` & `packages/eslint-plugin`):**
  Schränke in `ValidateSingleRow` (`types.ts`) Zeilen mit `Row[0] extends AnyStateNode` so ein, dass `Row[2]` zwingend `StayNode | FinalNode` sein muss, es sei denn `Row[1]` ist `'ERROR'`. Ergänze die analoge AST-Prüfung im ESLint-Plugin.

### Cycle 53: Timer-Ontologie — `after(ms)` Must Change State (Forbid `stay()`) & Introduce `every(ms)` for Intervals

**Hintergrund:**

1. In Cycle 19 wurde festgelegt, dass `stay()` niemals `onStateExit` oder `onStateEnter` auslöst. Daher feuert `['ticking', after(1000), stay()]` nur ein einziges Mal und bleibt danach für immer stumm. Zudem ist `after(ms)` semantisch ein einmaliger Timeout, der den Zustand verlassen muss.

2. Für wiederkehrende Intervalle (wie einen Counter/Ticker) führen wir `every(ms | ((ctx) => number))` in Spalte 2 (`VIA`) ein, das mit `stay()` kombiniert wird und bei dynamischen Context-Änderungen (z. B. `tickSpeed`) das Intervall sauber anpasst.

* **🔴 RED (`packages/core/src/lib/core.spec.ts` & `packages/eslint-plugin/src/lib/eslint-plugin.spec.ts`):**

  1. Schreibe einen `@ts-expect-error`-Test und einen ESLint-Test, der beweist, dass `['ticking', after(1000), stay()]` verboten ist (`after()` muss den Zustand wechseln oder explizit re-entern).

  2. Schreibe einen Laufzeit-Test für `every()`:

     ```
     transitions: [
       ['stopped', 'START',             'ticking'],
       ['ticking', every((c) => c.ms),  stay(),     { call: (m) => m._tick }],
       ['ticking', 'SET_SPEED',         stay(),     { call: (m) => m._setSpeed }],
       ['ticking', 'PAUSE',             'stopped'],
     ]
     
     ```

     Verifiziere mit `vi.useFakeTimers()`:

     * Solange die Maschine in `'ticking'` ist, wird `_tick` kontinuierlich alle `c.ms` Millisekunden ausgeführt.

     * Wenn `'SET_SPEED'` via `stay()` `c.ms` von `1000` auf `200` ändert, passt sich das laufende `every()`-Intervall sofort auf `200ms` an!

     * Beim Übergang nach `'stopped'` (`'PAUSE'`) wird das Intervall sofort gestoppt (`clearInterval` / `clearTimeout`).

* **🟢 GREEN (`packages/core/src/lib/primitives.ts`, `types.ts`, `runner.ts`, `packages/eslint-plugin`):**

  1. Exportiere `every(ms: number | ((ctx: any) => number)): EveryNode` aus `@matrix-fsm/core` (und re-exportiere es in `@matrix-fsm/angular`).

  2. Verbiete in `ValidateSingleRow` (`types.ts`) die Kombination `Row[1] extends AfterNode` mit `Row[2] extends StayNode`.

  3. Implementiere `scheduleEveryTimers(state)` im Runner: Nach jedem Tick (und nach jedem `stay()`-Call, falls sich die Dauer `ms(getContext())` geändert hat) plant sich der Timer für die nächste Periode im aktuellen `stateEpoch` neu ein und räumt sich bei `onStateExit` restlos auf.

## PHASE II: Radikale Vereinfachung — Wegfall von `whenSignal` & Verschmelzung von `tasks` in `{ call }` (Cycles 54–56)

### Cycle 54: Remove `whenSignal` and `on:` Configuration Overhead

**Hintergrund:** Das Konstrukt `on: (store) => [whenSignal(...)]` in `createMachineFeature` und `withStateMachine` erzeugt unnötige kognitive Last und versteckt Event-Auslöser außerhalb der Transitionstabelle. Externe Reaktivität wird in Angular direkt und transparent über `store.send(...)` oder `syncContext` gelöst.

* **🔴 RED (`packages/angular/src/lib/with-state-machine.spec.ts`):**
  Entferne alle Referenzen auf `whenSignal` und `on:` aus den öffentlichen Exports und migriere bestehende Tests auf explizite `store.send()`-Aufrufe bzw. `syncContext`.

* **🟢 GREEN (`packages/core` & `packages/angular`):**
  Entferne `whenSignal`, `SignalReaction` und die `on`-Option aus `primitives.ts`, `types.ts` und `with-state-machine.ts`. (`syncContext` für das synchrone Spiegeln externer Store-Slices bleibt selbstverständlich erhalten!).

### Cycle 55: Unify `tasks` and `methods` — `awaiting('state')` Invokes `{ call: (m) => m._method }`

**Hintergrund:** Bisher musste ein Entwickler für synchrone Aktionen `{ call: (m) => m._syncMethod }` in Spalte 4 schreiben (definiert unter `methods`), aber für asynchrone Zustände `awaiting('loading')` in Spalte 3 ohne `call` schreiben und unten einen zweiten Block `tasks: { loading: ... }` anlegen, der nur über String-Namensgleichheit verknüpft war.
Ab sofort gibt es **nur noch `methods` und `{ call: (m) => m._method }`**:

* Steht in Spalte 3 ein normaler Zustand oder `stay()`, wird `call` synchron in Phase 2 ausgeführt.

* Steht in Spalte 3 `awaiting('loading')`, ist `{ call: (m) => m._loadData }` die asynchrone Methode für diesen Wartezustand! Sie erhält `(payload, signal: AbortSignal)` und ihr aufgelöster Rückgabewert wird automatisch als **typisierter Payload an das `'DONE'`-Event** (`['loading', 'DONE', 'ready', { call: (m) => m._saveData }]`) übergeben!

* **🔴 RED (`packages/core/src/lib/core.spec.ts`, `packages/angular/src/lib/with-state-machine.spec.ts`, `packages/eslint-plugin`):**

  1. Schreibe einen Test für `createMachineFeature` komplett **ohne** `tasks`-Block:

     ```
     transitions: [
       ['idle',    'LOAD',  awaiting('loading'), { call: (m) => m._fetchCities }],
       ['loading', 'DONE',  'ready',             { call: (m) => m._setCities }],
       ['loading', 'ERROR', 'error',             { call: (m) => m._setError }],
     ],
     methods: (store, api = inject(CityApi)) => ({
       _fetchCities: async (countryId: string, signal: AbortSignal) => {
         return await api.getCities(countryId, signal); // gibt string[] zurück!
       },
       _setCities: (cities: string[]) => patchState(store, { cities }),
       _setError: (err: unknown) => patchState(store, { error: String(err) }),
     })
     
     ```

  2. Verifiziere, dass `_fetchCities` beim Übergang in `awaiting('loading')` mit dem Payload von `'LOAD'` und einem frischen `AbortSignal` aufgerufen wird, und dass `_setCities` bei `'DONE'` das `string[]`-Ergebnis typsicher als Payload erhält!

  3. Verifiziere, dass `ResolveRowPayload` in `types.ts` für `['loading', 'DONE', ...]` den `Awaited<ReturnType<...>>` der Methode inferiert, die beim Eintritt in `awaiting('loading')` via `call` aufgerufen wurde!

* **🟢 GREEN (`packages/core` & `packages/angular` & `packages/eslint-plugin`):**

  1. Erlaube in `methods` sowohl synchrone Methoden als auch asynchrone Methoden `(payload: P, signal: AbortSignal) => Promise<R> | Observable<R> | ResourceRef<R>`.

  2. Wenn `target` in Phase 8 ein `AwaitingNode` ist und die Zeile `options?.call` besitzt, führe `call` mit `(payload, abortController.signal)` als verwalteten `awaiting`-Prozess aus (mit vollem `stateEpoch`- und `AbortController`-Schutz aus Cycle 19!).

  3. Leite das aufgelöste Ergebnis `result` als Payload von `runner.send('DONE', result)` weiter.

  4. *Abwärtskompatibilität / Migration:* Migriere den Playground (`coffee-shop` und `auth`) auf das einheitliche `methods`-Modell und entferne den separaten `tasks`-Block.

### Cycle 56: Named Domain Outcomes from `awaiting()` Calls (Beyond Generic `'DONE'`)

**Hintergrund:** Manchmal hat eine asynchrone Prüfung mehrere fachliche Ausgänge (z. B. `'APPROVED'`, `'REQUIRES_3DS'`, `'DECLINED'`). Statt immer `'DONE'` zu feuern und danach 3 `guard`-Zeilen schreiben zu müssen, darf eine asynchrone Methode in `awaiting()` optional ein Outcome-Tupel oder Objekt `outcome('APPROVED', data)` zurückgeben, das direkt das fachliche Event `'APPROVED'` mit `data` feuert!

* **🔴 RED (`packages/core/src/lib/core.spec.ts`):**
  Schreibe einen Test mit einem kleinen Helper `outcome(eventName, payload?)`:

  ```
  transitions: [
    ['checkout',  'PAY',           awaiting('verifying'), { call: (m) => m._verifyPayment }],
    ['verifying', 'APPROVED',      'paid',                { call: (m) => m._onApproved }],
    ['verifying', 'REQUIRES_3DS',  'challenge3ds',        { call: (m) => m._on3ds }],
    ['verifying', 'ERROR',         'paymentFailed'],
  ]
  
  ```

  Verifiziere, dass wenn `_verifyPayment` `outcome('REQUIRES_3DS', { challengeUrl: '...' })` zurückgibt, die Maschine direkt über `'REQUIRES_3DS'` nach `'challenge3ds'` wechselt und `{ challengeUrl }` an `_on3ds` übergibt! Gibt die Methode einen normalen Wert zurück, feuert weiterhin automatisch `'DONE'`.

* **🟢 GREEN (`packages/core/src/lib/primitives.ts` & `runner.ts` & `with-state-machine.ts`):**
  Exportiere `outcome<E extends string, P = void>(event: E, payload?: P): OutcomeNode<E, P>`. Prüfe beim Auflösen eines `awaiting()`-Calls: Ist der Rückgabewert ein `OutcomeNode`, dispatche `send(res.event, res.payload)`; andernfalls dispatche `send('DONE', res)`. Passe `require-awaiting-handlers` in ESLint so an, dass benannte Ausgangs-Events neben `'ERROR'` als gültige Handler für `awaiting()`-Zustände akzeptiert werden.

## PHASE III: Native Angular Async Primitives (`Observable` / `ResourceRef`) & Two Sandwich Worlds (Cycles 57–58)

### Cycle 57: Native Support for `Observable<T>` and Angular `ResourceRef<T>` (`resource` / `rxResource`) in `createMachineFeature`

**Hintergrund:** In der 90 %-Angular-Welt arbeiten Entwickler mit `HttpClient` (`Observable<T>`) oder Angulars neuen Signal-Resources (`resource()`, `rxResource()`, `httpResource()`). `createMachineFeature` soll diese in `{ call: (m) => m._load }` bei `awaiting()` nativ ohne Boilerplate ausführen und bei State-Exit automatisch abbrechen.

* **🔴 RED (`packages/angular/src/lib/with-state-machine.spec.ts`):**

  1. **Observable-Test:** Schreibe einen Test, bei dem `_loadCities: (country: string) => httpMock.getCities$(country)` direkt ein RxJS `Observable<string[]>` zurückgibt.

     * Verifiziere: Wenn das Observable emittiert und komplettiert, feuert `'DONE'` mit `string[]`.

     * Verifiziere: Wenn der Zustand `'loadingCities'` vorzeitig verlassen wird (z. B. durch Re-Entry bei neuem Country-Klick), wird die Subscription **sofort per `.unsubscribe()` beendet**!

  2. **Angular `ResourceRef`-Test:** Schreibe einen Test, bei dem eine Angular `ResourceRef` (bzw. ein `rxResource` / `resource`) in `awaiting('loading')` übergeben wird.

     * Verifiziere: Sobald die Resource in den Status `'resolved'` wechselt, feuert die Maschine `'DONE'` mit `resourceRef.value()`. Wechselt sie in `'error'`, feuert `'ERROR'` mit `resourceRef.error()`.

* **🟢 GREEN (`packages/angular/src/lib/with-state-machine.ts`):**
  Baue in den Standard-Angular-Task-Adapter von `withStateMachine` und `createFeatureTester` drei Zweige ein:

  1. `isObservable(ret)` (RxJS `Observable`): Subscribiere auf den ersten Wert (`take(1)`), binde `abortSignal` direkt an `subscription.unsubscribe()`, feuere `'DONE'` bei `next` und `'ERROR'` bei `error`.

  2. `isResourceRef(ret)` (Objekt mit Signalen `status`, `value`, `error` und Methode `reload`): Rufe `reload()` auf (falls nicht bereits `'loading'`), überwache `status()` reaktiv im `stateEpoch`-Kontext und dispatche `'DONE'` mit `value()` bzw. `'ERROR'` mit `error()`.

  3. `PromiseLike`: Wie bisher über `AbortSignal`.

### Cycle 58: Clean Separation of the Two Sandwich Worlds (`createMachineFeature` vs. `createEffectMachineFeature`)

**Hintergrund:** Um das TypeScript-Typsystem der 90 %-Angular-Welt (`Promise` | `Observable` | `ResourceRef`) komplett frei von `effect-ts`-Typen (`Effect.Effect<A, E, R>`) zu halten und gleichzeitig FP-Entwicklern erstklassigen `effect-ts`-Support zu bieten, trennen wir die beiden Sandwich-Fabriken sauber auf, während sie zu 100 % dieselbe Core- und Store-Runtime teilen.

* **🔴 RED (`packages/angular/src/lib/with-state-machine.spec.ts`):**

  1. Schreibe einen Test für `createEffectMachineFeature` (exportiert aus `@matrix-fsm/angular/effect` bzw. `@matrix-fsm/angular`), bei dem `_checkLoyalty` ein `Effect.Effect<{ points: number }, LoyaltyError>` zurückgibt:

     * Verifiziere, dass der Effekt über `Effect.runFork` ausgeführt wird.

     * Verifiziere, dass beim vorzeitigen Verlassen des `awaiting()`-Zustands der laufende Fiber sofort über `Fiber.interruptFork` abgebrochen wird!

     * Verifiziere, dass die Typinferenz von `createMachineFeature` (Standard-Welt) keinerlei `Effect`-Generics enthält, während `createEffectMachineFeature` den `Success`-Typ `A` aus `Effect<A, E>` für `'DONE'` und den `Error`-Typ `E` für `'ERROR'` inferiert!

* **🟢 GREEN (`packages/angular/src/lib/with-state-machine.ts` & `packages/angular/src/effect/index.ts`):**

  1. Extrahiere die gemeinsame Sandwich-Runtime in eine interne Funktion, die einen austauschbaren `AsyncExecutorAdapter` entgegennimmt.

  2. `createMachineFeature` nutzt den **Angular Standard Executor** (`Promise` | `Observable` | `ResourceRef`).

  3. `createEffectMachineFeature` nutzt den **Effect-TS Executor** (`Effect.runFork` + `Fiber.interruptFork`) mit dedizierten TypeScript-Typen für `Effect<A, E, never>`.

  4. Trage `./effect` sauber in `packages/angular/package.json` unter `"exports"` ein.

## Finalized Design Decisions (Grill-Me Alignment)

1. **Cycle 51 (`can()` on No-Op `stay()`):** Pure unguarded `stay()` fallback rows without `call` or `output` return `false` for `can()`, whereas `stay()` rows with `call` or `output` return `true`.
2. **Cycle 52 (`anyState()` Restrictions):** Strictly allow `anyState()` in Column 1 (`FROM`) only when `TO` is `stay()` / `finalState(...)` OR `VIA` is `'ERROR'`. Forbid `anyState()` inside Column 1 state arrays. Enforced at compile-time in `types.ts` and via a dedicated ESLint rule in `configs.recommended`.
3. **Cycle 53 (`after` vs. `every` Symmetry):** `after(ms | ((ctx) => number))` forbids `stay()` in Column 3 (`TO`), while `every(ms | ((ctx) => number))` strictly requires `stay()` in Column 3 (`TO`) (enforced in TS types + ESLint). Non-positive or non-finite dynamic `ms` values (`<= 0`, `NaN`, `Infinity`) pause/skip timer scheduling until a `stay()` transition updates context to a positive finite number.
4. **Cycle 54 (Remove `whenSignal` & `on:`):** Completely remove `whenSignal`, `SignalEventBridge`, and `on:` from `@matrix-fsm/core` and `@matrix-fsm/angular`.
5. **Cycle 55 (Clean Break `tasks` -> `{ call }`):**
   - Remove `tasks` config property and `withMachineTasks` completely.
   - Require `{ call: (m) => m._asyncMethod }` on every transition row targeting `awaiting('...')` (enforced in TS + ESLint).
   - Forbid `initial: awaiting(...)` (use `always()` from initial state instead).
   - Async `call` methods always receive `(payload, signal: AbortSignal, ctx: Readonly<TContext>)` in that fixed order, supported natively in both `@matrix-fsm/core` (`createMachineInstance`) and `@matrix-fsm/angular`.
   - No magic context auto-patching: the resolved value is passed strictly as the `'DONE'` event payload.
   - `createFeatureTester` accepts `methods` and `actorMethods` overrides instead of `tasks` and `actorTasks`.
6. **Cycle 56 (`outcome(event, payload?)`):** Auto-allow `OutcomeNode<E, P>` events in Column 2 (`VIA`) with full payload inference in TypeScript without polluting the external `events` contract. In ESLint `require-awaiting-handlers`, require `'ERROR'` plus at least one outcome row (`'DONE'`, `'ALL_DONE'`, or any domain outcome event not declared as an external user event / `'CANCEL'`).
7. **Cycle 57 (`Observable<T>` & `ResourceRef<T>`):** `createMachineFeature` natively handles `Promise<T>`, RxJS `Observable<T>` (`take(1)` semantics + auto-unsubscribe on state exit), and Angular `ResourceRef<T>` (auto-`reload()` if not loading, watching `status()` for `'resolved'`/`'local'` -> `'DONE'` and `'error'` -> `'ERROR'`).
8. **Cycle 58 (`createMachineFeature` vs. `createEffectMachineFeature`):** Export `createEffectMachineFeature` exclusively from `@matrix-fsm/angular/effect` (keeping `@matrix-fsm/angular` 100% free of `effect` types/imports), remove legacy `taskAdapter` / `effectTaskAdapter` / `registerTaskAdapter`, and migrate `auth.feature.ts` to `createEffectMachineFeature`.

## Final Verification Gate

Führe nach Abschluss aller Zyklen (51–58) folgende Befehle aus:

```
pnpm nx run-many -t test,lint,build

```

Stelle sicher, dass alle Unit-Tests, `@ts-expect-error`-Typ-Tests, alle ESLint-Regeln (inkl. Playground) und der Build für `@matrix-fsm/core`, `@matrix-fsm/angular` und `@matrix-fsm/eslint-plugin` zu 100 % grün durchlaufen.