# `@matrix-fsm` Best Practices & Agent Rules (V1 Architecture)

Dieses Dokument definiert die verbindlichen Design-, Formatierungs- und Architekturregeln für alle State Machines (`*.machine.ts`), Domain-Typen (`*.domain.ts`), Stores (`*.store.ts`) und Komponenten im `@matrix-fsm`-Ökosystem. Jeder KI-Agent und Entwickler **muss** diese Regeln vor dem Erstellen oder Anpassen einer FSM befolgen.

---

## 1. Zero JSON Dummy Objects & Named `FSMContract` in `createFSM` (ADR 1 & ADR 2)

1. **Keine Dummy-Objekte (`events: {} as ...` oder `context: { ... }`) & Named `FSMContract`:**
   - Events, Context, States und Store-Methoden werden als reine TypeScript-Typen in `*.domain.ts` (oder am Dateianfang) definiert und über die **curried** Signatur `createFSM<{ events?: ...; states?: ...; context?: ...; methods?: ... }>()({ ... })` übergeben.
   - Nach dem **Interface Segregation Principle (ISP)** deklariert jede Maschine nur die Facetten (`events`, `states`, `context`, `methods`), die sie tatsächlich direkt benötigt.
2. **Unified `createFSM` & Entkoppelte Sub-Maschinen (DIP & ISP):**
   - Jede FSM wird einheitlich mit `createFSM` erstellt. Ob eine Maschine eine Root-FSM oder eine Sub-FSM ist, entscheidet sich **ausschließlich durch ihren Einsatzkontext** (z. B. wenn `baristaFSM` in Spalte 1 `FROM`, Spalte 3 `TO` oder in `each('orders', baristaFSM)` einer Eltern-Matrix übergeben wird).
   - **Strikte Entkopplung:** Sub-Maschinen (`barista.machine.ts`, `barista.domain.ts`, `barista.store.ts`) dürfen **niemals** Typen aus der Eltern-Maschine (`coffee-shop.*`) importieren. `@matrix-fsm/core` aggregiert und schneidet (`UnionToIntersection`) `Context`, `Methods`, `States`, `Events` und `Tasks` aller eingebetteten Sub-Maschinen automatisch rekursiv zur Compile-Zeit.
   - Terminale Ergebnisse einer Sub-FSM werden mit `finalState('OUTCOME_NAME')` markiert und in der Eltern-Matrix in Spalte 2 (`VIA`) typsicher über `ExtractFinalOutcomes<typeof subFSM>` gematcht (`[baristaFSM, 'COFFEE_READY', 'coffeeReady']`), ohne dass `'COFFEE_READY'` in den Eltern-Events dupliziert werden muss.

```typescript
export const baristaFSM = createFSM<{
  events: BaristaEvents;
  states: BaristaStates;
  context: BaristaContext;
  methods: BaristaMethods;
}>()({
  id: 'barista',
  initial: 'ticketQueued',
  // prettier-ignore
  transitions: [
    /* FROM                 VIA               TO                            OPTIONS */
    ['ticketQueued',        'START_BREWING',  awaiting('brewingCoffee')],
    ['brewingCoffee',       'DONE',           finalState('COFFEE_READY')],
    ['brewingCoffee',       'ERROR',          'machineMaintenance',         { call: (m) => m._setBrewError }],
    ['machineMaintenance',  'RETRY_BREW',     awaiting('brewingCoffee')],
  ],
});
```

---

## 2. First-Class SignalStore Alignment: `withState`, `withMethods` (`call`) & Composable Features (ADR 3 & ADR 4)

1. **Keine doppelte State-Haltung:**
   - Der initiale State lebt **nicht** in `*.machine.ts`, sondern wird im SignalStore nativ über `withState<MyContext>(initialContext)` (bzw. wiederverwendbare `signalStoreFeature`-Helfer wie `withBarista()`) registriert.
   - Dadurch stehen alle State-Slices direkt als erstklassige SignalStore-Signale (`store.selectedDrink()`, `store.customerCard()`, etc.) sowie gebündelt über `store.fsmContext()` bereit.
2. **Store-Methoden per `{ call: (m) => m._methodName }` statt riesiger Inline-`patch`-Lambdas:**
   - Synchrone State-Mutationen werden in `withMethods((store) => ({ _selectDrink: ... }))` mit `patchState(store, ...)` definiert.
   - Methoden mit führendem Unterstrich (`_selectDrink`, `_markPaid`, `_setBrewError`) werden von `@ngrx/signals` automatisch nach außen hin privat gehalten, werden aber von `withStateMachine` zur Compile-Zeit über alle Eltern- und Sub-Maschinen hinweg erzwungen und über `{ call: (m) => m._selectDrink }` typsicher aufgerufen.
   - **Verboten (Anti-Pattern):** Niemals mehrere Methoden in einem `call`-Selektor aufrufen (`{ call: (m) => { m._a(); m._b(); } }`) oder HTTP-/Async-Side-Effects in `withMethods` verstecken. Asynchrone Operationen gehören ausschließlich in `tasks: { awaitingState: ... }`!

---

## 3. Entkoppelte Task-Runner: Promises, RxJS Observables & Optionales Effect-TS (ADR 5)

- **`@matrix-fsm/angular` (Core Adapter, 0 % Effect-TS-Abhängigkeit):**
  - Unterstützt nativ Standard-**Promises** (`async/await` + `AbortSignal`) sowie **RxJS `Observable`** (inkl. automatischem `unsubscribe()` beim Verlassen/Abbrechen eines `awaiting`-Zustands).
  - Unterstützt Tagged-Error-Routing (`err._tag` oder benannte `Error`-Klassen) direkt in Spalte 2 (`VIA`) ohne Effect-TS-Zwang.
- **`@matrix-fsm/angular/effect` (Optionaler Secondary Entrypoint):**
  - Stellt `effectTaskAdapter` und `runEffect` für Teams bereit, die Effect-TS Fibers und `Data.TaggedError` einsetzen möchten.

---

## 4. Matrix-Spalten-Alignment (Warum es `@matrix-fsm` heißt!)

Das Kernprinzip von `@matrix-fsm` ist die **visuelle 2D-Matrix**. Eine Transitionstabelle ist **keine** vertikal umgebrochene JSON-/Array-Liste, sondern eine spaltenbasiert ausgerichtete Tabelle.

### Verbindliche Formatierungsregeln für `transitions`:
1. **Die ersten 3 Spalten (`FROM`, `VIA`, `TO`) stehen IMMER in einer Zeile** und sind über alle Zeilen der Tabelle hinweg **exakt vertikal spaltenbündig** ausgerichtet.
2. **Die 4. Spalte (`OPTIONS`: `{ guard, call, patch }`)** steht durch die schlanken `{ call: (m) => m._... }`-Referenzen im Regelfall direkt in derselben Zeile als 4. Spalte (oder darf bei Bedarf auf die Zeile direkt darunter umbrechen).
3. **Schutz vor Standard-Formattern (Prettier):**
   - `**/*.machine.ts` ist in [`.prettierignore`](file:///Users/andreellrich/private/matrix-fsm/.prettierignore) eingetragen.
   - Zusätzlich wird über jedem `transitions: [`-Block `// prettier-ignore` sowie der Spalten-Header `/* FROM ... VIA ... TO ... OPTIONS */` platziert.
   - Die ESLint-Regel `@matrix-fsm/align-matrix-columns` prüft und repariert (`eslint --fix`) das Spalten-Alignment der ersten drei Spalten automatisch.

---

## 5. Wann `transitions<...>([...])` ausgelagert werden darf (`> 3`-Fälle-Regel)

- **Verbindliche Schwellenwert-Regel:** Lagere eine `[FROM, VIA]`-Gruppe **nur dann** in eine eigene `transitions<...>([...])`-Variable aus, wenn sie **mehr als 3 Fälle (`> 3` Zeilen, also mindestens 4 Zeilen)** umfasst!
- `transitions` akzeptiert entweder ein `FSMContract`-Objekt (`transitions<{ context: MyContext; methods: MyMethods }>([...])`), eine Maschinen-Referenz (`transitions<typeof myFSM>([...])`) oder direkt den Context-Typ.
- Bei **2 oder 3 Zeilen** (z. B. ein `guard` + `stay()`-Fallback) **muss** die Gruppe direkt inline in der `transitions`-Matrix stehen (`@matrix-fsm/complete-extracted-groups`, `minRows: 4`).

---

## 6. Alle 8 AST-Linter-Regeln (`@matrix-fsm/eslint-plugin`)

| # | Regel | Beschreibung |
|---|-------|--------------|
| 1 | `align-matrix-columns` | Erzwingt, dass `[FROM, VIA, TO]` in einer Zeile stehen und über alle Zeilen vertikal spaltenbündig ausgerichtet sind (`OPTIONS` darf in derselben oder der nächsten Zeile stehen). |
| 2 | `group-contiguous-transitions` | Gleiche `[FROM, VIA]`-Paare müssen direkt untereinander stehen; keine Array-Listen in Spalte 1. |
| 3 | `require-fallback-transition` | Jede bewachte (`guard`) `[FROM, VIA]`-Gruppe muss mit einer unbewachten Fallback-Zeile enden. |
| 4 | `no-unreachable-transitions` | Keine unbewachte Zeile darf vor einer weiteren Zeile derselben `[FROM, VIA]`-Gruppe stehen. |
| 5 | `require-awaiting-handlers` | Jeder `awaiting('x')`-Zustand benötigt mindestens einen `'DONE'`- und einen `'ERROR'`-Übergang. |
| 6 | `awaiting-naming-convention` | Jeder Zustand in `awaiting('...')` muss auf `-ing` enden (z. B. `'checkingLoyalty'`, `'brewingCoffee'`). |
| 7 | `complete-extracted-groups` | `transitions([...])`-Variablen dürfen eine `[FROM, VIA]`-Gruppe nicht aufteilen und sind erst ab **> 3 Zeilen** (`minRows: 4`) erlaubt. |
| 8 | `pure-machine-definition` | Verbietet `@angular/*`, Service- oder Store-Imports sowie `inject()` in `*.machine.ts` und stellt sicher, dass `call` eine einzelne Methodenreferenz `(m) => m._method` ist. |
