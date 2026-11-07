# Deep Analysis: 10 Schwachstellen & 10 Verbesserungsvorschläge für @matrix-fsm

> **Status:** Read-Only Audit der Codebasis (`@matrix-fsm/core`, `@matrix-fsm/angular`, `@matrix-fsm/eslint-plugin`, `apps/playground`)  
> **Referenzen:** [TDD Masterplan Cycles 51–58](file:///home/hanshannes/Development/matrix-fsm/tdd_masterplan_architecture_evolution_bugfixes_cycles_51_58.md), [Blueprint](file:///home/hanshannes/Development/matrix-fsm/blueprint.md)

---

## TEIL 1: 10 Schwachstellen (Architektur, Bugs & Typ-Ergonomie)

### 1. `tasks` -> `{ call }` Migrations-Bruch & Silent No-Op
- **Ort:** [packages/angular/src/lib/with-state-machine.ts#L1258](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1258)
- **Problem:** Wenn bei einer Transition nach `awaiting('loading')` in Spalte 4 `{ call: ... }` fehlt, bricht `startAwaitingTaskIfNeeded` lautlos ab (`return`). Vorhandene Legacy-`tasks`-Blöcke oder Methoden mit Namensgleichheit werden nicht aufgerufen. Die Maschine verharrt für immer im Wartezustand.

### 2. NgRx SignalStore Slice-Hydration Bug bei Combinators & Snapshots
- **Ort:** [packages/angular/src/lib/with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts)
- **Problem:** Combinators (`all`, `race`, `each`) rufen `patchState(store, { [actorKey]: state })` auf dem Root-Store auf. Da diese Keys im `initialState` des Stores fehlen, loggt NgRx Signals Warnungen (`patchState was called with an unknown state slice`) und verwirft die Daten. `restoreSnapshot()` schlägt fehl (14 Tests rot).

### 3. Syntax-Fehler blockiert `@matrix-fsm/core` Testlauf
- **Ort:** [packages/core/src/lib/core.spec.ts#L59-L60](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/core.spec.ts#L59-L60)
- **Problem:** Duplizierte Typ-Definition:
  ```typescript
  interface AuthMethods {
  interface AuthMethods {
  ```
  Vite/OXC bricht mit einem Parse-Error ab. Kein einziger Core-Test kann ausgeführt werden.

### 4. Asymmetrische Context-Aktualisierung (`patchContext`) im Runner
- **Ort:** [packages/core/src/lib/runner.ts#L1141-L1146](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L1141-L1146)
- **Problem:** `patchContext` leitet Patches an `activeSubMachine` weiter, ignoriert aber `activeCombinator` und `activeEachPool`. Child-Instanzen in Combinators laufen mit veraltetem Kontext weiter.

### 5. Synchrones Zero-Tick Child Completion Race
- **Ort:** [packages/angular/src/lib/with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts) (Cycle 18 Test)
- **Problem:** Wenn ein synchroner Sub-Actor oder Task sofort während `onStateEnter` sein Terminal-Event (`DONE`) absendet, befindet sich die Pipeline des Parents noch in der Commit-Phase. Das Folge-Event wird verschluckt und der Zustand bleibt fälschlicherweise in `baristaZeroTick` hängen.

### 6. Rekursive Typ-Kaskaden & TS2589-Gefahr bei großen Matrizen
- **Ort:** [packages/core/src/lib/types.ts#L1410-L1457](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/types.ts#L1410-L1457)
- **Problem:** `ResolveRowPayload` und `ValidateSingleRow` nutzen tief verschachtelte rekursive Conditional Types über Tupel. Bei Matrizen mit mehr als 35–40 Zeilen droht TypeScript mit `TS2589: Type instantiation is excessively deep and possibly infinite`.

### 7. Effect-TS Typ-Falle in Standard `createMachineFeature`
- **Ort:** [packages/angular/src/lib/with-state-machine.ts#L1305](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1305) & [packages/angular/src/effect/index.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/effect/index.ts)
- **Problem:** Gibt eine Methode ein `Effect.Effect` im Standard-`createMachineFeature` zurück, greift der Task-Adapter nicht. Das System versucht `result.then(...)` aufzurufen und stürzt zur Laufzeit mit einem TypeError ab.

### 8. Fehlende Compile-Zeit-Prüfung auf identische `[FROM, VIA]` Schattenzeilen
- **Ort:** [packages/eslint-plugin/src/lib/rules/no-shadowed-transitions.ts](file:///home/hanshannes/Development/matrix-fsm/packages/eslint-plugin/src/lib/rules/no-shadowed-transitions.ts)
- **Problem:** Ungeschützte doppelte Transitions werden nur durch den ESLint-Linter geflaggt. TypeScript selbst akzeptiert identische Zeilen ohne Fehler. Fehlt der Linter im CI-Schritt, bleibt toter Code unbemerkt.

### 9. DI-Absturz (`NG0203`) durch Default-Parameter in `methods`
- **Ort:** [apps/playground/src/app/features/coffee-shop/coffee-shop.machine.ts#L83](file:///home/hanshannes/Development/matrix-fsm/apps/playground/src/app/features/coffee-shop/coffee-shop.machine.ts#L83)
- **Problem:** `methods: (store, api = inject(ApiService)) => ...` stürzt in Unit-Tests ohne Angular `TestBed` mit `NG0203` ab, wenn `createFeatureTester` verwendet wird und der 2. Parameter nicht explizit gemockt wird.

### 10. `can()` bei `anyState()` Übergängen inkonsistent
- **Ort:** [packages/core/src/lib/runner.ts#L1128-L1135](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/runner.ts#L1128-L1135)
- **Problem:** Während Cycle 51 No-Op-`stay()` für konkrete Zustände filtert, kann eine globale `anyState()`-Fallback-Regel dazu führen, dass `can('IRRELEVANT_EVENT')` für geschützte Zustände unerwartet `true` liefert, wenn ein `stay()` mit allgemeinem Logging vorhanden ist.

---

## TEIL 2: 10 Feature- & Verbesserungsvorschläge (Public API & Internals)

### 1. Natives `history()` State Primitiv
- **Kategorie:** Public API
- **Vorschlag:** Einführung eines `history()`-Markers in Spalte 3 (`TO`):
  ```typescript
  ['authModal', 'SUCCESS', history()], // Kehrt in den Zustand vor dem Modal zurück
  ```
  Erspart manuelles Vorhalten von `previousState` im Kontext bei Standard-Workflows (Login-Interruption, Dialoge, Wizards).

### 2. Convention-over-Configuration für `awaiting()`
- **Kategorie:** Public API & DX
- **Vorschlag:** Fehlt `{ call }` an einer Transition nach `awaiting('loadingData')`, sucht der Runner automatisch nach `methods._loadingData` oder `methods.loadingData`.
- **Nutzen:** Eliminiert DRY-Verletzungen, wenn derselbe Wartezustand von mehreren Events angesprungen wird.

### 3. Deklaratives Event-Buffering (`queue: 'fifo'`)
- **Kategorie:** Public API / Runtime
- **Vorschlag:** Optionale Queue-Konfiguration an Transitions oder im Machine-Config:
  ```typescript
  options: { queue: 'fifo' }
  ```
  Events, die während eines `awaiting()` eintreffen, werden nach `DONE` automatisch abgearbeitet statt verworfen.

### 4. Isolierte Signal-Scopes für Sub-Actors
- **Kategorie:** Internals (`@matrix-fsm/angular`)
- **Vorschlag:** Statt Sub-Actor-States per `patchState` in den Root-Store zu schreiben, werden sie in einem internen Dictionary `store.actors[actorId]` gekapselt.
- **Nutzen:** Beseitigt NgRx-Unknown-Slice-Warnungen und garantiert vollständige Kapselung.

### 5. First-Class Support für Angular 19 `resource()` / `rxResource()`
- **Kategorie:** Public API & Angular-Integration
- **Vorschlag:** Direkte Anbindung von Angular Signals `resource`:
  ```typescript
  ['idle', 'FETCH', awaiting('loading'), { call: (m) => m.userResource }]
  ```
  Automatisches Binden des Ladezustands und automatische `DONE`-Event-Auslösung bei Wertänderung.

### 6. Typisierte fachliche Outcome-Events aus `call` (Cycle 56 Vorbereitung)
- **Kategorie:** Public API / Type-Safety
- **Vorschlag:** Unterstützung von `outcome('APPROVED', payload)` als Methoden-Rückgabewert:
  ```typescript
  _verifyCard: async (): Promise<FsmOutcome<'APPROVED' | 'REJECTED', CardData>> => ...
  ```
  TypeScript prüft zur Compile-Zeit, dass `'APPROVED'` und `'REJECTED'` gültige Matrix-Zeilen für diesen Zustand sind.

### 7. Interaktiver Browser-Live-Inspektor via DevTools Bridge
- **Kategorie:** Tooling / DX
- **Vorschlag:** Bereitstellung eines leichten Debug-Overlays (`provideFsmDevTools()`), das via `inspect()` Live-Events empfängt und den aktuellen Zustand farblich im generierten Mermaid-Diagramm hervorhebt.

### 8. Microtask-Queue für synchrone Child-Abschlüsse
- **Kategorie:** Internals (`@matrix-fsm/core`)
- **Vorschlag:** Terminale Child-Outputs werden über eine interne Microtask-Warteschlange abgearbeitet.
- **Nutzen:** Beseitigt Zero-Tick-Races in `onStateEnter`, da Parent-Zustandswechsel atomar abgeschlossen sind, bevor das Kind-Event feuert.

### 9. Gruppierungs-Shorthands (`transitions.group`)
- **Kategorie:** Public API
- **Vorschlag:** Helferfunktion für redundante Transitionen:
  ```typescript
  ...transitions.group(['step1', 'step2', 'step3'], 'CANCEL', 'cancelled')
  ```
  Generiert typensichere flache Zeilen, ohne komplexe Union-Typen in Spalte 1 zu erzwingen.

### 10. ESLint-Regel `require-effect-sandwich`
- **Kategorie:** Tooling / Linter
- **Vorschlag:** Neue Regel in `@matrix-fsm/eslint-plugin`: Erkennt, wenn `Effect`-Typen in einem Standard-`createMachineFeature` verwendet werden, und erzwingt `createEffectMachineFeature` aus `@matrix-fsm/angular/effect`.
