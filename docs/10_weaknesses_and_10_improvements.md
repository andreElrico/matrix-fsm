# Deep Audit: 20 Schwachstellen & 20 Verbesserungen für `@matrix-fsm` (verifiziert)

> **Modus:** Strikt Read-Only – keine Codebase-Datei verändert.
> **Geprüfter Stand:** Commit `3ce9be6` (Cycles 51–58). Testsuite: **130/130 grün** (`npx vitest run`).
> **Verifikationsrunde:** 2026-11-08 – jedes Finding erneut gegen den Code geprüft, Zeilennummern aktualisiert, falsche Aussagen korrigiert oder ersetzt.

**Legende:** ✅ bestätigt · 🟡 bestätigt, aber präzisiert/korrigiert · 🔁 widerlegt → durch neues, verifiziertes Finding ersetzt · ✔️ inzwischen behoben

---

## Änderungsprotokoll dieser Verifikationsrunde

| # | Änderung | Grund |
| :--- | :--- | :--- |
| 1 | 🟡 präzisiert | Silent No-Op nur, wenn **keine** Eingangszeile `call` hat (sonst Fallback auf ersten Selector). ESLint `missingAwaitingCall` deckt es zur Lint-Zeit ab. |
| 2 | 🟡 korrigiert | Root-Store filtert Patches auf deklarierte Keys. Warnung kommt aus **Child-Runnern ohne Host-Store** (ungefilterter `patchState`). Tritt in der Suite weiterhin 6× auf. |
| 6 | 🟡 korrigiert | `ValidateTransitionRows` ist ein **Mapped Tuple Type** (nicht rekursiv) → TS2589 unwahrscheinlich. Reales Risiko: Typ-Kosten O(N²) durch `TTransitions[number]`-Filter pro Zeile. |
| 10 | 🔁 ersetzt | `can('LOG') === true` bei `[anyState(), 'LOG', stay(), { call }]` ist **korrekt**, kein Bug. Ersetzt durch: halbe Transitionen bei synchronen Exceptions. |
| 12 | 🟡 präzisiert | Tritt nur ohne Fallback-Zeile auf (die Lint-Regel `require-fallback-transition` würde sie erzwingen). |
| 14 | 🔁 ersetzt | ResourceRef-Race widerlegt: Angulars `reload()` setzt den Status über `linkedSignal` synchron auf `'reloading'`. Ersetzt durch: `Observable` ohne Emission → `DONE(undefined)`. |
| 16 | 🟡 korrigiert | Kein Absturz: ein fehlender Service wird zu einem Defect, `Cause.squash` → `ERROR`-Event. Die Typ-Lücke (`R = any`) bleibt. |
| 18 | 🟡 gekürzt | Behauptung „Doppelpunkt bricht Mermaid“ unbelegt → entfernt. ID-Kollisionen bleiben bestätigt. |
| 19 | 🟡 korrigiert | Spreads **im selben File** werden aufgelöst (`extractedVars`). Nur `require-awaiting-handlers` ignoriert nicht auflösbare (importierte) Spreads stillschweigend, statt abzubrechen. |
| 20 | 🟡 präzisiert | `@angular/compiler` überschreibt die Fassade später ohnehin. Das Risiko ist der versteckte JIT-Fehler und ein Seiteneffekt beim Import, kein Bruch des echten Compilers. |

---

## TEIL 1: Schwachstellen #1–#10 (Erstaudit, verifiziert)

### 1. 🟡 Fehlendes `{ call }` bei `awaiting()` → stilles Hängen zur Laufzeit
- **Ort:** [with-state-machine.ts#L1301-L1310](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1301-L1310), [fsm.ts#L255-L260](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/fsm.ts#L255-L260)
- **Befund:** `effectiveSelector = callSelector ?? fsm.awaitingCallSelectors.get(state)`. Hat **keine** Zeile, die in `awaiting('x')` führt, ein `call`, folgt `return` ohne Dev-Warnung, und die Maschine bleibt dauerhaft `isPending()`. Hat nur *eine andere* Eingangszeile ein `call`, wird stillschweigend **deren** Methode benutzt (implizite Kopplung).
- **Abdeckung:** ESLint `require-awaiting-handlers` → `missingAwaitingCall` meldet es zur Lint-Zeit. Zur Laufzeit gibt es kein Netz.

### 2. 🟡 NgRx-Warnung „unknown state slice“ aus Child-Runnern
- **Ort:** [with-state-machine.ts#L797-L822](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L797-L822) (`applyContextPatch`)
- **Befund:** Mit Host-Store wird auf `storeStateKeys` gefiltert. **Ohne** Host-Store (gespawnte Child-/Combinator-Runner auf eigener `signalState`) folgt `patchState(effectiveStoreSource, patch)` **ungefiltert**. Actor-keyed Inputs (`barista`, `bakery`, `drink`, `pastry`) erzeugen Warnungen.
- **Beleg:** Test *Cycle 34 – unwraps actor-keyed combinator inputs…* loggt die Warnung aktuell 6×. Der Test ist trotzdem grün, die Daten werden also verworfen, ohne dass der Test es merkt.

### 3. ✔️ Syntaxfehler in `core.spec.ts` – behoben
- Doppeltes `interface AuthMethods` in Commit `3ce9be6` entfernt; 36 Core-Tests grün.

### 4. ✅ Asymmetrische Context-Propagation im Core-Runner
- **Ort:** [runner.ts#L1141-L1146](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L1141-L1146), [runner.ts#L704](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L704) vs. [runner.ts#L721-L725](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L721-L725)
- **Befund:** `patchContext()` reicht Patches nur an `activeSubMachine` weiter, nicht an Combinator- oder `each()`-Kinder. Beim Event-Forwarding gilt: Combinator-Kinder erhalten vorher `inst.patchContext(readEffectiveContext())`, `each()`-Kinder **nicht**. Drei Child-Arten, drei Regeln.

### 5. 🟡 Zero-Tick Child Completion – Test grün, strukturelles Risiko bleibt
- Cycle-18-Test grün. Core und Angular pflegen aber **getrennte** Event-Queues und Child-Output-Pfade (siehe #11), deshalb muss jede Race-Korrektur doppelt erfolgen.

### 6. 🟡 Typ-Kosten bei großen Matrizen (kein TS2589-Rekursionsproblem)
- **Ort:** [types.ts#L1529-L1537](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/types.ts#L1529-L1537) (Mapped Tuple), [types.ts#L1296-L1306](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/types.ts#L1296-L1306), [types.ts#L1312](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/types.ts#L1312)
- **Befund:** Die Validierung ist pro Zeile ein Mapped Type, also keine tiefe Rekursion. Payload-Inferenz (`IsAwaitingStateInTransitions`, `ResolveAwaitingViaPayload`) filtert für jede Zeile die gesamte Union `TTransitions[number]`. Das ergibt ≈ O(N²) Instanziierungen.
- **Lücke:** Größte Matrix im Repo ≈ 18 Zeilen; es gibt keinen Typ-Performance-Test mit 50+ Zeilen.

### 7. 🟡 `Effect` im Standard-`createMachineFeature` → stilles `DONE` mit Effect-Objekt
- **Ort:** [with-state-machine.ts#L1464-L1465](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1464-L1465)
- **Befund:** Ohne `taskAdapter` ist ein `Effect` weder Promise, ResourceRef noch Subscribable. Es landet im Zweig *„5. Synchronous return value“*: `handleTaskSuccess(handle, effect)`. Der Effect läuft **nie**, und `DONE` erhält das unausgeführte Effect-Objekt als Payload. Kein Crash, keine Warnung.

### 8. ✅ Schattenzeilen nur per ESLint erkannt + doppelte Regel
- **Ort:** [no-shadowed-transitions.ts#L9](file:///home/hanshannes/Development/matrix-fsm/packages/eslint-plugin/src/lib/rules/no-shadowed-transitions.ts#L9), [eslint-plugin/src/index.ts#L63-L64](file:///home/hanshannes/Development/matrix-fsm/packages/eslint-plugin/src/index.ts#L63-L64)
- **Befund:** TypeScript akzeptiert identische unbewachte `[FROM, VIA]`-Zeilen. `no-shadowed-transitions` ist ein 1:1-Alias von `no-unreachable-transitions`; beide stehen in `recommended` auf `error`, derselbe Fehler wird also **doppelt** gemeldet.

### 9. ✅ DI-Fallback mit `DUMMY_DI_DEP` + verschlucktes `NG0203`
- **Ort:** [with-state-machine.ts#L557-L595](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L557-L595)
- **Befund:** Ohne Injector bekommt `methods(store, …)` fünf leere `Object.freeze({})`-Objekte als Default-Parameter-Ersatz, d. h. `api.fetch is not a function` erst zur Laufzeit. Ruft der Methods-Body `inject()`, wird `NG0203` abgefangen und `{}` zurückgegeben. **Alle Methoden fehlen dann stillschweigend**, was direkt zu #1 (Silent Hang) führt.

### 10. 🔁 NEU: Synchrone Exception in `call`/`guard` hinterlässt halbe Transition
- **Ort Core:** [runner.ts#L774-L792](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L774-L792), [runner.ts#L128-L145](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L128-L145), [runner.ts#L1048-L1093](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L1048-L1093)
- **Ort Angular:** [with-state-machine.ts#L2060-L2092](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2060-L2092)
- **Befund:** Die Reihenfolge ist `clearTimers` → `cancelTask` → `onExit` → `currentState = next` → `stateEpoch++` → **danach** `invokeCallSelector(...)`, ohne `try/catch`. Wirft die synchrone Methode, ist der State schon gewechselt, aber `onEnter`, Timer, `awaiting`-Call, Sub-Machine-Spawn und `inspect`/`onStateChange` fehlen. Der Zustand ist inkonsistent und wird nicht gemeldet.
- **Folgefehler:** Die `while`-Queue bricht ab, `finally` setzt nur `isProcessing = false`. **Restliche Events bleiben in `eventQueue`** und werden beim nächsten `send()` veraltet abgearbeitet (nur der Loop-Guard leert die Queue). Guards werden in `fsm.evaluate` ebenfalls ohne `try/catch` ausgeführt.
- **Tests:** Es gibt keinen Test für werfende Guards oder synchrone `call`s.

> *Ersetzt das ursprüngliche #10 („`can()` bei `anyState()`“). Das war kein Bug: eine `stay()`-Zeile mit `call` behandelt das Event tatsächlich, `can() === true` ist korrekt ([fsm.ts#L392-L393](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/fsm.ts#L392-L393)).*

---

## TEIL 2: Schwachstellen #11–#20 (zweite Runde, verifiziert)

### 11. ✅ Zwei vollständige Engines: Angular nutzt `createMachineInstance` nicht
- **Ort:** [runner.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts) (1.337 Zeilen) vs. `createScopedMachineRunner` [with-state-machine.ts#L637-L2713](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L637-L2713) (~2.070 Zeilen)
- **Beleg:** `grep createMachineInstance with-state-machine.ts` liefert 0 Treffer. Timer, Microstep-Queue, Combinators, `each()` und Snapshots sind doppelt implementiert. Funktionsnamen driften bereits (`startAwaitingCallIfNeeded` ↔ `startAwaitingTaskIfNeeded`, `enterSubMachineIfNeeded` ↔ `enterSubMachineNode`).
- **Konkreter Drift bei `each()`:**

| Aspekt | Core ([runner.ts#L615-L624](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L615-L624)) | Angular ([with-state-machine.ts#L597-L605](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L597-L605), [#L1471-L1530](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1471-L1530)) |
| :--- | :--- | :--- |
| ID primitiver Items | Array-Index `"0"`, `"1"` | Wert selbst (`"Berlin"`) |
| ID Objekt ohne `id` | Array-Index | `JSON.stringify(item)` (wirft bei Zirkelbezug/`BigInt`) |
| Doppelte IDs | eigene Instanz pro Index | kollabieren auf eine Instanz |
| Item-Liste ändert sich | Pool fix bis State-Exit | Reconciliation (Add/Remove) bei `stay()` |
| Parent-Context im Kind | immer gespreadet | bei Feature-Kindern leer (`isFeatureEach`) |

### 12. 🟡 Bewachter `every(ms)`-Timer stirbt bei `matched === false`
- **Ort:** [runner.ts#L254-L289](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L254-L289), [runner.ts#L742-L747](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L742-L747), [runner.ts#L829-L837](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L829-L837); identisch in Angular [#L1859-L1892](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1859-L1892), [#L2032-L2036](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2032-L2036), [#L2120-L2128](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2120-L2128)
- **Befund:** `every` ist ein einmaliges `setTimeout` und wird **nur** im `evaluation.stayed`-Zweig neu geplant. Lehnt der Guard ab und gibt es keine Fallback-Zeile, folgt ein früher `return`, und das Intervall ist bis zum State-Exit tot.
- **Einschränkung:** `require-fallback-transition` erzwingt die Fallback-Zeile. Betroffen sind daher Code ohne Linter, generierte oder dynamische Matrizen. Die Laufzeit bleibt trotzdem fragil.

### 13. ✅ `awaitingCallSelectors` First-Row-Wins + `restoreSnapshot()` ohne Hooks
- **Ort:** [fsm.ts#L255-L260](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/fsm.ts#L255-L260), [runner.ts#L1192-L1273](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L1192-L1273), [runner.ts#L1291](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L1291), Angular [#L2406](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L2406)
- **Befund:** Bei `SEARCH_BY_ID → awaiting('loading') { call: _loadById }` und `SEARCH_BY_NAME → awaiting('loading') { call: _loadByName }` speichert die Map nur `_loadById`. `restoreSnapshot()`/`reset()` starten immer diesen Selector mit `payload = undefined`. `restoreSnapshot()` ruft außerdem **kein** `onEnter` auf (0 Vorkommen im Core-Block).

### 14. 🔁 NEU: `Observable` ohne Emission → `DONE` mit `undefined` (Typ-Lüge)
- **Ort:** [with-state-machine.ts#L1413-L1461](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1413-L1461)
- **Befund:** `complete` ohne vorheriges `next` ruft `handleTaskSuccess(handle, undefined)` auf. Ein `EMPTY`, ein `filter(...)` ohne Treffer oder ein abgebrochener HTTP-Stream wird so als **Erfolg** gewertet. `ResolveAwaitingViaPayload` typisiert den `DONE`-Payload aber als `T` statt `T | undefined`, und `_setCities(cities: City[])` bekommt zur Laufzeit `undefined`.
- **Dazu:** Striktes `take(1)` (die erste Emission beendet den Task). Streams mit Fortschritt sind nicht abbildbar (siehe Verbesserung #17).

> *Ersetzt das ursprüngliche #14 (ResourceRef „stale resolved“). Widerlegt für echte Angular-Resources, weil `reload()` den `linkedSignal`-Status synchron auf `'reloading'` setzt. Theoretisch bleibt es nur für selbstgebaute `ResourceRefLike`-Duck-Types relevant ([#L615-L624](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L615-L624)).*

### 15. ✅ `@matrix-fsm/router`: `onNavigate` feuert nie bei FSM-Transitions
- **Ort:** [router-binding.ts#L40](file:///home/hanshannes/Development/matrix-fsm/packages/router/src/lib/router-binding.ts#L40), [#L73](file:///home/hanshannes/Development/matrix-fsm/packages/router/src/lib/router-binding.ts#L73), [#L84-L97](file:///home/hanshannes/Development/matrix-fsm/packages/router/src/lib/router-binding.ts#L84-L97)
- **Befund:** Laut JSDoc wird `onNavigate` *„whenever `fsmUrl()` changes“* aufgerufen. Tatsächlich passiert das nur in `syncFromUrl()` (URL → FSM). Bei `store.send('NEXT')` gibt es kein `effect()`, und das faule `computed` wird nie beobachtet. Dazu kommt: `routeToEvent` matcht nur exakte Strings (`mapping.routeToEvent?.[url]`), also ohne Parameter-Pattern wie `/city/:id`. Das Paket hat nur 1 Test.

### 16. 🟡 Effect-TS: `R` (Requirements) wird zu `any` → fehlender Service erst zur Laufzeit
- **Ort:** [effect/index.ts#L43-L46](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/effect/index.ts#L43-L46), [#L68-L83](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/effect/index.ts#L68-L83)
- **Befund:** `NormalizeEffectMethodReturn` matcht `Effect<A, E, any>`. Ein Effect mit `R = HttpClient` kompiliert also ohne Fehler. `Effect.runFork` läuft mit Default-Runtime ohne `Layer` und ohne `ManagedRuntime`. Der fehlende Service wird zu einem Defect, `Cause.squash` → `ERROR`-Event (kein Crash, aber ein falsch klassifizierter Programmierfehler als fachlicher Fehler).

### 17. ✅ Plural-Heuristik `key.slice(0, -1)` in `each()`
- **Ort:** [runner.ts#L588-L589](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L588-L589), [with-state-machine.ts#L1486-L1487](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1486-L1487)
- **Befund:** `cities` → `citie`, `addresses` → `addresse`, `status` → `statu`, `kinder` → kein Singular. Zusätzlich werden Item-Properties per `...item` direkt in den Child-Context gespreadet und können Parent-Keys stillschweigend überschreiben.

### 18. 🟡 Mermaid: ID-Kollisionen
- **Ort:** [mermaid.ts#L24-L26](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/mermaid.ts#L24-L26), [mermaid.ts#L58-L64](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/mermaid.ts#L58-L64)
- **Befund:** `sanitizeMermaidId` faltet `'user-profile'` und `'user_profile'` zu `user_profile`, und auch `'stadt.köln'` / `'stadt_k_ln'` kollidieren. Ein State namens `'anyState'` kollidiert mit dem hartkodierten Wildcard-Knoten `state "(*)" as anyState`. Inline-Guards erscheinen nur als `[guard]`, weil anonyme Arrow-Funktionen keinen `.name` haben.

### 19. 🟡 ESLint: Import-Aliase hebeln Regeln aus; importierte Spreads → stille False Positives
- **Ort:** [ast-utils.ts#L190](file:///home/hanshannes/Development/matrix-fsm/packages/eslint-plugin/src/lib/ast-utils.ts#L190), [#L249](file:///home/hanshannes/Development/matrix-fsm/packages/eslint-plugin/src/lib/ast-utils.ts#L249), [require-awaiting-handlers.ts#L72-L81](file:///home/hanshannes/Development/matrix-fsm/packages/eslint-plugin/src/lib/rules/require-awaiting-handlers.ts#L72-L81)
- **Befund:**
  1. Alle AST-Checks vergleichen Identifier-Namen (`'stay'`, `'awaiting'`, `'anyState'`, `'createFSM'`). `import { stay as keep }` oder `import * as fsm` machen die Regeln blind.
  2. Spreads **im selben File** werden über `extractedVars` aufgelöst (korrekt). `no-unreachable-states` und `require-exit-for-targets` brechen bei nicht auflösbaren Spreads ab (`hasUnresolvedSpread`). **`require-awaiting-handlers` tut das nicht**: liegen `DONE`/`ERROR`-Zeilen in einer *importierten* Gruppe, meldet die Regel fälschlich „missing handlers“.
  3. 14 Regel-Links zeigen auf `https://matrix-fsm.dev/rules/...`. Docs dazu gibt es im Repo nicht (Domain vermutlich Platzhalter, nicht online geprüft).

### 20. 🟡 Top-Level-Seiteneffekt: Stub für `globalThis.ng.ɵcompilerFacade`
- **Ort:** [with-state-machine.ts#L150-L175](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L150-L175)
- **Befund:** Der bloße Import setzt per `??=` eine Minimal-Fassade (nur Factory/Injectable). `@angular/compiler` überschreibt sie später ohnehin. Fehlt der Compiler aber (AOT, Node-Tests), **maskiert** der Stub Angulars klare Meldung „JIT compilation failed“ für Components/Pipes. `package.json` deklariert außerdem kein `"sideEffects"`, und eine Library mutiert globalen Framework-Zustand beim Import.

---

## TEIL 3: 20 Verbesserungs- & Feature-Vorschläge

### A. Public API

| # | Vorschlag | Löst |
| :--- | :--- | :--- |
| 1 | **`history()`-Target** in Spalte 3 – Rücksprung in den letzten Zustand (Modal/Login-Unterbrechung, Wizard „Zurück“), ohne `previousState` im Context. | Lücke vs. XState |
| 2 | **Dev-Mode-Warnung + Convention-Fallback** für `awaiting('x')` ohne `call`: `ngDevMode`-Warnung und optional Auto-Lookup `_x`. | #1, #9 |
| 3 | **Deklaratives Event-Buffering** `{ queue: 'fifo' }` für Events während `awaiting()`. | Lücke vs. XState |
| 4 | **`each(key, fsm, { keyBy, itemAs })`** statt Plural- und ID-Heuristik; einheitlich in Core und Angular. | #11, #17 |
| 5 | **Observable-Modi** `{ call, stream: 'first' \| 'last' \| 'progress' }`: Zwischenwerte als `outcome('PROGRESS', x)` auf `stay()`-Zeilen, `DONE` erst bei `complete()`. `complete` ohne Wert wird zu `ERROR` (`EmptyStreamError`) oder `DONE` mit Typ `T \| undefined`. | #14 |
| 6 | **`createEffectMachineFeature({ runtime })`**: `ManagedRuntime`/`Layer` (auch per `inject()`), und `R` per Default auf `never` beschränken → fehlender Service ist ein Compile-Fehler. | #16 |
| 7 | **`withRouteMachine` reaktiv**: `effect()` auf `fsmUrl()` mit optionalem `inject(Router).navigateByUrl`; `routeToEvent` mit Pattern (`/city/:id` → Payload). | #15 |
| 8 | **`transitions.group(['a','b','c'], 'CANCEL', 'cancelled')`** erzeugt flache Zeilen, Matrix-Stil bleibt erhalten, keine State-Arrays in Spalte 1. | Redundanz bei Kaskaden-Resets |

### B. Internals & Robustheit

| # | Vorschlag | Löst |
| :--- | :--- | :--- |
| 9 | **Single Engine**: Angular-Runner als dünner Signal-Adapter über `createMachineInstance` (Hooks: `getContext`, `onStateChange`, `taskAdapter`). Ca. −2.000 LOC, keine Drift mehr. | #4, #5, #11 |
| 10 | **Transaktionale Transition**: sync `call`/Guard vor dem Commit ausführen oder per `try/catch` auf `ERROR` routen; bei Exception `eventQueue` leeren oder zurückrollen. | #10 |
| 11 | **`every()` unabhängig von `matched` neu planen** (Reschedule vor dem frühen `return`). | #12 |
| 12 | **Snapshot v2**: `awaitingCallKey`, `awaitingPayload`, `schemaVersion` speichern; optional `restoreSnapshot(snap, { runEnterHooks: true })`. | #13 |
| 13 | **Einheitliche Child-Context-Regel** (Sub-Machine, Combinator, `each`): Kinder erhalten nur explizites `input`, kein impliziter Parent-Context-Spread. Passt zum DIP/ISP-Geist im Blueprint. | #2, #4, #17 |
| 14 | **Seiteneffektfreier Import**: JIT-Stub nur in `createFeatureTester`/Test-Setup und `"sideEffects": false` in `package.json`. | #20 |

### C. Tooling, Typen & DX

| # | Vorschlag | Löst |
| :--- | :--- | :--- |
| 15 | **Scope-basierte Symbol-Erkennung im ESLint-Plugin** (Import-Specifier auflösen statt Namensvergleich); `require-awaiting-handlers` bricht bei nicht auflösbarem Spread ab wie die anderen Regeln. | #19 |
| 16 | **`no-shadowed-transitions` entdoppeln**: entweder echte eigene Semantik (nur Shadowing) oder aus `recommended` entfernen. | #8 |
| 17 | **Typ-Performance-Benchmark** in CI (Matrix mit 50/100 Zeilen, `tsc --extendedDiagnostics`, Budget für Instantiations) – Voraussetzung, bevor teurere Typ-Checks wie Shadow-Erkennung auf Typ-Ebene kommen. | #6, #8 |
| 18 | **Mermaid-Exporter härten**: kollisionsfreie IDs (Hash-Suffix bei Kollision), reservierte Namen (`anyState`) escapen, `guard`-Label über optionales `name`-Feld. | #18 |
| 19 | **Live-Inspector**: `provideFsmDevTools()` nutzt `inspect()` und hebt den aktiven State im Mermaid-Diagramm hervor. | Lücke vs. Stately |
| 20 | **Manifest im README**: das 3(+1)-Spalten-Motto aus [library_spirit_and_manifesto.md](file:///home/hanshannes/Development/matrix-fsm/docs/library_spirit_and_manifesto.md) plus Entscheidungsbaum `createMachineFeature` vs. `createEffectMachineFeature` direkt im [README.md](file:///home/hanshannes/Development/matrix-fsm/README.md). | Onboarding |

---

## Priorisierung (Empfehlung)

| Prio | Items | Begründung |
| :--- | :--- | :--- |
| **P0 – Korrektheit** | #10, #14, #7, #13 | Stille Fehlzustände zur Laufzeit, keine Tests vorhanden |
| **P1 – Architektur** | #11 → Verbesserung 9 | Wurzel von #4, #5 und den `each()`-Drifts; jede weitere Korrektur kostet sonst doppelt |
| **P2 – Integrationen** | #15, #16, #2 | Gebrochene Doku-Versprechen bzw. Typ-Lücken |
| **P3 – Tooling/DX** | #8, #18, #19, #20, #6 | Qualität, kein Datenverlust |
