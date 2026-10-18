# `@matrix-fsm` Best Practices & Agent Rules

Dieses Dokument definiert die verbindlichen Design-, Formatierungs- und Architekturregeln für alle State Machines (`*.machine.ts`), Stores (`*.store.ts`) und Komponenten im `@matrix-fsm`-Ökosystem. Jeder KI-Agent und Entwickler **muss** diese Regeln vor dem Erstellen oder Anpassen einer FSM befolgen.

---

## 1. Matrix-Spalten-Alignment (Warum es `@matrix-fsm` heißt!)

Das Kernprinzip von `@matrix-fsm` ist die **visuelle 2D-Matrix**. Eine Transitionstabelle ist **keine** vertikal umgebrochene JSON-/Array-Liste, sondern eine spaltenbasiert ausgerichtete Tabelle.

### Verbindliche Formatierungsregeln für `transitions`:
1. **Die ersten 3 Spalten (`FROM`, `VIA`, `TO`) stehen IMMER in einer Zeile** und sind über alle Zeilen der Tabelle hinweg **exakt vertikal spaltenbündig** ausgerichtet.
2. **Die 4. Spalte (`OPTIONS`: `{ guard, patch }`)** darf entweder:
   - rechts neben `TO` in derselben Zeile stehen (bei kurzen Guards wie `{ guard: hasSelectedDrink }`), **oder**
   - auf der **Zeile direkt darunter** (`\n`) stehen und dort nach normalen TypeScript-/Prettier-Regeln formatiert werden (ideal für mehrzeilige `patch`-Objekte).
3. **Schutz vor Standard-Formattern (Prettier):**
   - `**/*.machine.ts` ist in [`.prettierignore`](file:///Users/andreellrich/private/matrix-fsm/.prettierignore) eingetragen.
   - Zusätzlich wird über jedem `transitions: [`-Block `// prettier-ignore` sowie der Spalten-Header `/* FROM ... VIA ... TO */` platziert.
   - Die ESLint-Regel `@matrix-fsm/align-matrix-columns` prüft und repariert (`eslint --fix`) das Spalten-Alignment der ersten drei Spalten automatisch.

### ✅ Richtig (Echte Matrix-Formatierung):
```typescript
  // prettier-ignore
  transitions: [
    /* FROM                 VIA                         TO */
    ['customerBrowsing',    'SELECT_DRINK',             stay(),
      {
        patch: (_ctx, payload: { drink: CoffeeDrink }) => ({
          selectedDrink: payload.drink,
          finalPrice: payload.drink.price,
          error: null,
        }),
      }],
    ['customerBrowsing',    'PLACE_ORDER',              awaiting('checkingLoyalty'),  { guard: hasSelectedDrink }],
    ['customerBrowsing',    'PLACE_ORDER',              stay(),
      { patch: () => ({ error: 'Please select a coffee first!' }) }],

    ['checkingLoyalty',     'DONE',                     baristaFSM,                   { guard: isFreeDrink }],
    ['checkingLoyalty',     'DONE',                     'awaitingPayment'],
  ],
```

### ❌ Falsch (Durch Prettier vertikal zerstörte Tupel):
```typescript
  // NIEMALS FROM, VIA und TO auf einzelne Zeilen umbrechen!
  transitions: [
    [
      'customerBrowsing',
      'SELECT_DRINK',
      stay(),
      { patch: ... },
    ],
  ],
```

---

## 2. Wann `transitions<TContext>([...])` ausgelagert werden darf (`> 3`-Fälle-Regel)

Der Helper `transitions<TContext>([...])` dient dazu, **große** Entscheidungsblöcke auszulagern.
- **Verbindliche Schwellenwert-Regel:** Lagere eine `[FROM, VIA]`-Gruppe **nur dann** in eine eigene `transitions([...])`-Variable aus, wenn sie **mehr als 3 Fälle (`> 3` Zeilen, also mindestens 4 Zeilen)** umfasst!
- Bei **2 oder 3 Zeilen** (z. B. ein einfacher `guard` + `stay()`-Fallback) **muss** die Gruppe direkt inline in der `transitions`-Matrix stehen. Das Auslagern von 2-Zeilen-Gruppen zwingt den Leser zum Hin- und Herspringen im Code und verschlechtert die Lesbarkeit der Matrix.
- Diese Regel wird durch `@matrix-fsm/complete-extracted-groups` (`minRows: 4`) statisch per AST-Linter erzwungen.

---

## 3. Hierarchische Strukturierung (`subMachine` statt riesiger flacher Listen)

Vermeide es, unabhängige Rollen, Subsysteme oder mehrstufige Teilprozesse in eine einzige, endlose flache FSM zu quetschen.

### Wann eine `subMachine({...})` Pflicht ist:
1. **Eigene Rolle / eigener Akteur / eigene Station:** Wenn im Domänenmodell ein klar abgegrenzter Akteur übernimmt (z. B. im Coffee Shop: nach Bestellung & Kasse übernimmt der **Barista** an der Siebträgermaschine -> `baristaFSM`).
2. **Gemeinsamer Gruppen-Abbruch (Group-Interrupt):** Wenn mehrere Schritte eines Teilprozesses durch ein einziges Eltern-Event abgebrochen werden können (`[baristaFSM, 'CANCEL', 'customerBrowsing']`).
3. **Skalierbarkeit auf parallele Instanzen (`each()`):** Eine `subMachine` bildet einen sauberen Baumknoten. Wenn später statt einem Barista mehrere Baristas parallel arbeiten sollen, kann dieselbe `baristaFSM` ohne Umbau der internen Zustände mit `each('orders', baristaFSM)` parallelisiert werden.

```typescript
export const baristaFSM = subMachine({
  id: 'barista',
  initial: 'ticketQueued',
  events: {} as {
    START_BREWING: void;
    RETRY_BREW: void;
  },
  context: {} as CoffeeShopContext,
  // prettier-ignore
  transitions: [
    /* FROM                 VIA               TO */
    ['ticketQueued',        'START_BREWING',  awaiting('brewingCoffee')],
    ['brewingCoffee',       'DONE',           finalState('COFFEE_READY')],
    ['brewingCoffee',       'ERROR',          'machineMaintenance',
      { patch: (_ctx, err: Error) => ({ error: err.message }) }],
    ['machineMaintenance',  'RETRY_BREW',     awaiting('brewingCoffee')],
  ],
});
```

---

## 4. Die 3-Schichten-Architektur & 8 Linter-Gesetze (`@matrix-fsm/eslint-plugin`)

### Schichten-Trennung:
- **Layer 1 (`core`):** Globale Stores, API-Services, Effect-TS `Data.TaggedError`-Klassen.
- **Layer 2 (`domain`):** 100 % reine TypeScript-Funktionen, Berechnungen, Menüs und `Record<Enum, Policy>`-Tabellen (`0 % Angular DI`).
- **Layer 3 (`features/<feature-name>/`):** Jedes Beispiel/Feature ist sauber in einem eigenen Ordner gekapselt:
  - `*.machine.ts`: Reine FSM- und Sub-FSM-Definitionen (`0 % Angular DI`, keine Service-/Store-Imports).
  - `*.store.ts`: `signalStore` mit `withStateMachine(fsm, { syncContext, tasks })`.
  - `*-example.component.ts/.html/.css`: Dumb View mit `@switch (store.fsmState())` (und `@switch (store.fsmSubState())` für aktive Sub-Machines).

### Alle 8 AST-Linter-Regeln (`@matrix-fsm/eslint-plugin`):
| # | Regel | Beschreibung |
|---|-------|--------------|
| 1 | `align-matrix-columns` | Erzwingt, dass `[FROM, VIA, TO]` in einer Zeile stehen und über alle Zeilen vertikal spaltenbündig ausgerichtet sind (`OPTIONS` darf in derselben oder der nächsten Zeile stehen). |
| 2 | `group-contiguous-transitions` | Gleiche `[FROM, VIA]`-Paare müssen direkt untereinander stehen; keine Array-Listen in Spalte 1. |
| 3 | `require-fallback-transition` | Jede bewachte (`guard`) `[FROM, VIA]`-Gruppe muss mit einer unbewachten Fallback-Zeile enden. |
| 4 | `no-unreachable-transitions` | Keine unbewachte Zeile darf vor einer weiteren Zeile derselben `[FROM, VIA]`-Gruppe stehen. |
| 5 | `require-awaiting-handlers` | Jeder `awaiting('x')`-Zustand benötigt mindestens einen `'DONE'`- und einen `'ERROR'`-Übergang. |
| 6 | `awaiting-naming-convention` | Jeder Zustand in `awaiting('...')` muss auf `-ing` enden (z. B. `'checkingLoyalty'`, `'brewingCoffee'`). |
| 7 | `complete-extracted-groups` | `transitions([...])`-Variablen dürfen eine `[FROM, VIA]`-Gruppe nicht aufteilen und sind erst ab **> 3 Zeilen** (`minRows: 4`) erlaubt. |
| 8 | `pure-machine-definition` | Verbietet `@angular/*`, Service- oder Store-Imports sowie `inject()` in `*.machine.ts`. |
