# Architekturanalyse & Roadmap v2: Perfekte Developer Experience (DX), das „Sandwich-Pattern“ & das Actor-Modell

**Datum:** 22. Oktober 2026  
**Status:** Verbindliche Handlungsanweisung für Agenten & Core-Team  
**Fokus:** Maximale Developer Experience, Reduktion von Zeremonie & Boilerplate, mathematische Integrität (Race-Condition-Schutz) & 100% TypeScript-Sicherheit.

---

## 1. Leitbild & Priorität #1: Developer Experience (DX)

> **„Die Nr. 1 Priorität ist eine einfache Syntax, die Spaß macht und intuitiv ist – bei gleichzeitig kompromissloser mathematischer Sauberkeit (Determinismus, Schutz vor Race Conditions und saubere Lifecycle-Interrupts).“**

Aktuell leidet die Benutzerfreundlichkeit unter einer zu dogmatischen Trennung von FSM-Topologie und Angular-Laufzeit. Entwickler müssen für einfache Sub-Prozesse zu viele Dateien anlegen und manuelle Verdrahtung vornehmen.

Das Ziel ist: **Jede Maschine (egal ob Sub-Prozess wie `baristaFSM` oder Haupt-Prozess wie `coffeeShopFSM`) kann als in sich geschlossenes „Sandwich“ (autonomer Akteur) in einer einzigen Datei definiert werden, das in einer Eltern-Matrix einfach eingesetzt wird und vollautomatisch („implizit“) läuft.**

---

## 2. Kritikpunkte am Status Quo (Schmerzpunkte)

### 2.1 File-Explosion & Zeremonie für Sub-Prozesse

- Für ein Sub-Feature wie den `Barista` mussten bisher 3–4 separate Dateien gepflegt werden (`barista.domain.ts`, `barista.machine.ts`, `barista.store.ts` sowie manuelle Verdrahtung im Parent-Store).
- Diese Zeremonie bremst den Entwicklungsfluss („Flow“) und fühlt sich nach unnötigem Overhead an.

### 2.2 Manuelle Provider- oder Feature-Kopplung

- Wenn `coffee-shop.machine.ts` bereits deklariert:
  ```typescript
  ['awaitingPayment', 'PAY', baristaFSM, { input: ... }],
  [baristaFSM,        'CANCEL', 'idle'],
  ```

````

ist dem System auf logischer Ebene bereits **vollständig bekannt**, dass `baristaFSM` hier als Sub-Maschine fungiert.

* Es ist kontraintuitiv und fehleranfällig, wenn der Entwickler zusätzlich in der Angular-Komponente `provideStateMachine(...)` oder im Parent-Store `withBarista()` und `...createBaristaTasks()` manuell verdrahten muss.

### 2.3 Dogmatische „0% Framework“-Trennung vs. Realer Nutzen

* In einem echten Angular-Projekt wollen Entwickler Angular-Features bauen und keine generischen Multi-Framework-Bibliotheken.
* Solange der Graph (die 4-Spalten-Matrix) oben im File als reine, statisch lesbare Struktur steht, gewinnt die Architektur massiv an Klarheit, wenn State, synchrone Methoden und asynchrone Tasks (`inject()`) direkt darunter im selben Artefakt gekapselt sind.

---

## 3. Die Ziel-Vision: Das universelle „Sandwich-Pattern“ (`createMachineFeature`)

Ein FSM-Feature ist wie ein Sandwich aufgebaut:

* **Oben (100% Deklarative Topologie):** Die pure 2D-Matrix `[FROM, VIA, TO, OPTIONS]`. Vollkommen typisiert, für Dokumentation analysierbar und mathematisch prüfbar.
* **Unten (Die Füllung – Angular Runtime & Actor-State):** Eigener State (`state`), synchrone Mutationen (`methods`) und asynchrone Tasks (`tasks: (api = inject(...)) => ({ ... })`).
* **Universell (Fraktal):** `createMachineFeature` funktioniert sowohl als **Sub-Akteur** innerhalb einer anderen Maschine als auch als **Top-Level-Store** für eine Angular-Komponente!

### 3.1 Das Zielbild im Code

#### A) Definition der Sub-Maschine in EINER kompakten Datei (`barista.feature.ts`):

```typescript
import { inject } from '@angular/core';
import { patchState } from '@ngrx/signals';
import { awaiting, createMachineFeature, finalState, stay } from '@matrix-fsm/angular';
import { CoffeeShopApiService } from './coffee-shop-api.service';
import type { CoffeeDrink, BrewResult } from './coffee-shop.domain';

export const baristaFSM = createMachineFeature<{
  // 1. INPUTS: Welche Daten braucht der Akteur beim Start vom Parent?
  inputs: {
    drink: CoffeeDrink;
    tableNumber?: number;
  };

  // 2. EVENTS: Welche internen Aktionen/Trigger existieren?
  events: {
    START_BREWING: void;
    RETRY_BREW: void;
    REPORT_LOW_CUPS: { remaining: number };
  };

  // 3. OUTPUTS: Welche Signale & Ergebnisse meldet der Akteur an den Parent?
  outputs: {
    COFFEE_READY: { baristaResult: BrewResult };
    CUPS_LOW: { remaining: number };
  };
}>()({
  id: 'barista',
  initial: 'ticketQueued',

  // 1. Reine Matrix-Topologie (linter-geprüft, mathematisch sauber)
  // prettier-ignore
  transitions: [
    /* FROM                 VIA                 TO                            OPTIONS */
    ['ticketQueued',        'START_BREWING',    awaiting('brewingCoffee')],
    ['ticketQueued',        'REPORT_LOW_CUPS',  stay(),                       { emit: 'CUPS_LOW' }],
    ['brewingCoffee',       'DONE',             finalState('COFFEE_READY', (ctx) => ({ baristaResult: ctx.baristaResult! }))],
    ['brewingCoffee',       'ERROR',            'machineMaintenance',         { call: (m) => m._setBrewError }],
    ['machineMaintenance',  'RETRY_BREW',       awaiting('brewingCoffee')],
  ],

  // 2. Kapselung des internen Zustands (Autonomer Actor State)
  state: {
    baristaResult: null as BrewResult | null,
    error: null as string | null,
  },

  // 3. Kapselung der State-Mutationen (store implementiert WritableStateSource -> natives patchState funktioniert!)
  methods: (store) => ({
    _setBrewError: (err: Error) => patchState(store, { error: err.message }),
  }),

  // 4. Kapselung der asynchronen Tasks inkl. Angular DI (ctx = Readonly<Inputs & State>)
  tasks: (api = inject(CoffeeShopApiService)) => ({
    brewingCoffee: async (ctx, signal) => {
      // ctx.drink kommt sicher typisiert aus `inputs`!
      const result = await api.brewCoffee(ctx.drink, signal);
      return { baristaResult: result, error: null };
    },
  }),
});

````

#### B) Verwendung in der Eltern-Maschine (`coffee-shop.machine.ts`) – 0% Boilerplate:

```typescript
transitions: [
  // ...
  // Vollkommen implizit: Der Barista-Akteur wird beim Betreten automatisch im DI-Kontext gestartet.
  // Input-Übergabe erfolgt sauber und typsicher (Pflichtfeld, wenn baristaFSM `inputs` definiert!):
  [
    'checkingLoyalty',
    'DONE',
    baristaFSM,
    {
      guard: isFreeDrink,
      input: (ctx) => ({ drink: ctx.selectedDrink! }),
    },
  ],
  [
    'awaitingPayment',
    'PAY',
    baristaFSM,
    {
      input: (ctx) => ({ drink: ctx.selectedDrink! }),
      call: (m) => m._markPaid,
    },
  ],

  // Output-Handling des Akteurs (Typ-geprüft: Payload von COFFEE_READY wird an _handleDrinkPrepared übergeben!):
  [
    baristaFSM,
    'COFFEE_READY',
    'coffeeReady',
    { call: (m) => m._handleDrinkPrepared },
  ],
  [baristaFSM, 'CUPS_LOW', stay(), { call: (m) => m._orderNewCups }],

  // Group-Interrupt (Hard Kill): Bricht den gesamten Barista-Akteur + laufende Tasks sofort ab:
  [baristaFSM, 'CANCEL', 'idle'],
];
```

#### C) Verwendung in der Komponente (`coffee-shop-example.component.ts`):

```typescript
@Component({
  // KEIN provideStateMachine(baristaFSM, ...) nötig!
  // Die Engine instanziiert baristaFSM automatisch über den EnvironmentInjector des Parent-Stores.
  providers: [CoffeeShopStore],
  templateUrl: './coffee-shop-example.component.html',
})
export class CoffeeShopExampleComponent {
  readonly store = inject(CoffeeShopStore);
}
```

---

## 4. Technische Architektur-Details (Lösungen für alle Edge-Cases)

### 4.1 TypeScript Inference-Reihenfolge in `createMachineFeature` (`NoInfer`)

Da `transitions` im Konfigurations-Objekt **oberhalb** von `state` und `methods` steht, muss die Signatur von `createMachineFeature` verhindern, dass `m` in `{ call: (m) => m._setBrewError }` zu `unknown` wird:

- TypeScript inferiert zuerst `TState` aus `state: TState` und `TMethods` aus `methods: (store: WritableStateSource<TState> & ReadonlySignals<TInputs & TState>) => TMethods`.
- In `transitions` wird `NoInfer<TMethods>` und `NoInfer<TInputs & TState>` verwendet. Dadurch löst TypeScript garantiert zuerst `state` und `methods` auf und bietet in `transitions` oberhalb davon volles Autocomplete für `call: (m) => m._setBrewError` und `guard: (ctx) => ...`!

### 4.2 Echter `@ngrx/signals` `patchState`-Support ohne Memory Leaks

Damit Entwickler in `methods: (store) => ({ ... })` eines Sub-Akteurs das gewohnte `patchState(store, ...)` aus `@ngrx/signals` nutzen können, **ohne** bei jedem Sub-Machine-Eintritt einen schweren Angular-Injector zu leaken:

- Der leichtgewichtige Actor-State-Container implementiert intern das `WritableStateSource<TState>`-Protokoll von `@ngrx/signals` (oder nutzt einen isolierten `signalState(initialState)` aus `@ngrx/signals`).
- `signalState()` aus `@ngrx/signals` erzeugt **keine** DI-Provider-Leaks, ist ein reines Signal-Primitiv und zu 100 % kompatibel mit `patchState(store, ...)`!
- Beim Eintritt in `baristaFSM` wird ein frischer `signalState({ ...baristaFSM.state, ...resolvedInputs })` erstellt und die `tasks`-Factory innerhalb von `runInInjectionContext(parentInjector, ...)` aufgerufen.

### 4.3 Wie End-Outputs (`finalState`) und Zwischen-Outputs (`emit`) funktionieren

1. **End-Outputs via `finalState(outputName, selector?)`:**

- Signatur: `finalState<TName extends string, TContext = any, TPayload = void>(name: TName, payloadSelector?: (ctx: Readonly<TContext>) => TPayload)`
- Wird `payloadSelector` angegeben (`finalState('COFFEE_READY', (ctx) => ({ baristaResult: ctx.baristaResult! }))`), berechnet die Engine den Output-Payload daraus und übergibt ihn als Event-Payload an die Eltern-Transition `[baristaFSM, 'COFFEE_READY', 'coffeeReady', { call: (m) => m._handleDrinkPrepared }]`.
- Wird `payloadSelector` weggelassen (`finalState('COFFEE_READY')`), übergibt die Engine automatisch den aktuellen Actor-Context `ctx` als Payload (sofern der Output-Typ in `outputs` `void` ist oder strukturell durch `ctx` erfüllt wird).

2. **Zwischen-Outputs (während der Akteur weiterläuft) via `{ emit: 'OUTPUT_KEY' }`:**

- In `TransitionOptions` gibt es die Option `emit?: keyof TOutputs | { type: keyof TOutputs; payload: (ctx: Readonly<TContext>, eventPayload: any) => any }`.
- Feuert eine Transition mit `emit: 'CUPS_LOW'`, bleibt der Sub-Akteur aktiv (z. B. via `stay()`), und die Engine dispatches synchron das Output-Event `'CUPS_LOW'` (mit dem aktuellen Event-Payload) an die Eltern-Maschine (`[baristaFSM, 'CUPS_LOW', stay(), { call: (m) => m._orderNewCups }]`).

### 4.4 Wie das Angular-Template auf den aktiven Sub-Akteur zugreift

Damit das HTML-Template flach und intuitiv bleibt:

1. **`store.fsmState()`** liefert weiterhin flach den aktiven Blatt-Zustand (`CoffeeShopStates | BaristaStates`, also z. B. `'ticketQueued' | 'brewingCoffee' | 'machineMaintenance'`).
2. **`store.send(...)`** akzeptiert sowohl Eltern-Events als auch die `events` aller eingebetteten Sub-Akteure und leitet sie automatisch an den aktiven Sub-Akteur weiter.
3. **`store.actors.<subMachineId>()` (oder Signal-Read-Zugriff):** Für den isolierten State des Sub-Akteurs (z. B. `error` oder `baristaResult` während der Barista läuft) exponiert `withStateMachine` unter `store.actors` (z. B. `store.actors.barista()`) ein reaktives Signal mit dem aktuellen Context (`Readonly<BaristaInputs & BaristaState> | null`) des Sub-Akteurs.

### 4.5Die 3 Schutzwälle für Output-Exhaustiveness & Input-Safety

1. **Schutzwall 1: TypeScript Compile-Time Enforcement (Datei-übergreifend!):**

- **Input-Check:** Hat `baristaFSM` in seinem Contract nicht-leere `inputs` deklariert, erzwingt `ValidateTransitionRows` in jeder Zeile `['...', '...', baristaFSM, options]`, dass `options` zwingend `{ input: (ctx: Readonly<ParentContext>) => BaristaInputs }` enthält.
- **Output-Exhaustiveness-Check:** Wird `baristaFSM` in einer Eltern-Maschine als Ziel (`TO`) verwendet, prüft ein Typ-Validator `ValidateSubMachineOutputs<TTransitions>` auf dem `transitions`-Array zur Compile-Zeit, dass **jeder Key aus `baristaFSM`'s `outputs**` (`'COFFEE_READY' | 'CUPS_LOW'`) mindestens einmal in einer Zeile `[baristaFSM, OutputKey, ...]` in Spalte 2 abgefangen wird! Fehlt ein Output-Key in der Eltern-Matrix, kompiliert TypeScript nicht!

2. **Schutzwall 2: ESLint AST-Support für `createMachineFeature`:**

- Da ESLint immer nur den AST einer einzelnen Datei sieht (ohne langsames Type-Aware Linting), übernimmt **TypeScript** die Datei-übergreifende Prüfung der `outputs`-Keys, während `@matrix-fsm/eslint-plugin` (`ast-utils.ts`) so erweitert wird, dass alle 7 Matrix-Regeln (`align-matrix-columns`, `require-fallback-transition`, `require-awaiting-handlers`, `awaiting-naming-convention`, etc.) automatisch auch für `createMachineFeature` greifen!

3. **Schutzwall 3: Runtime Fail-Fast (Dev-Mode Guard):**

- Emittiert ein Sub-Akteur zur Laufzeit ein Output-Event, für das die Eltern-Maschine im aktuellen Zustand keine passende Transition `[subMachine, outputKey, ...]` besitzt, wirft die Engine sofort einen klaren Fehler:
  `[MatrixFSM Error]: Sub-machine '${sub.id}' emitted output '${outputKey}', but parent '${parent.id}' has no matching transition. Prevented silent deadlock!`

### 4.6 Hard Kill vs. Cooperative Cancel bei `CANCEL`

Wenn ein Event (z. B. `CANCEL`) gesendet wird, während `baristaFSM` aktiv ist:

1. **Cooperative Cancel:** Prüfe zuerst, ob `baristaFSM` in seinem aktuellen Zustand selbst eine Transition für `CANCEL` definiert hat. Falls ja, verarbeitet der Barista das Event selbst.
2. **Hard Kill (Parent Interrupt):** Falls nein, prüfe, ob die Eltern-Maschine eine Transition `[baristaFSM, 'CANCEL', ...]` besitzt. Falls ja:

- Rufe sofort `AbortController.abort()` / Fiber-Interrupt für alle laufenden `awaiting`-Tasks des Baristas auf.
- Zerstöre die Laufzeit-Instanz des Sub-Akteurs (setzt ein `destroyed = true` Flag, sodass verspätete Callbacks garantiert ignoriert werden – 0% Race Conditions!).
- Führe den Übergang der Eltern-Maschine nach `'idle'` aus.

---

## 5. Visualisierung & Mermaid: Node-CLI statt Runtime-Ballast

- Es ist kein Runtime-Requirement, dass die Browser-Engine komplexe Sub-Maschinen-Graphen dynamisch zur Laufzeit zusammensetzt.
- Stattdessen gibt es ein leichtgewichtiges Node-Skript (`tools/generate-mermaid.mjs`, aufrufbar via `pnpm mermaid`), das Maschinen-Dateien für READMEs und Architektur-Dokumentation in Mermaid-Diagramme übersetzt.

---

## 6. Konkrete Arbeitsaufträge für den Agenten

1. **`@matrix-fsm/core` erweitern (`types.ts`, `primitives.ts`, `fsm.ts`, `runner.ts`):**

- Erweitere `FSMContract` um optionale `inputs?: Record<string, any>` und `outputs?: Record<string, any>`.
- Erweitere `finalState(name, payloadSelector?)` um den optionalen Payload-Selector `(ctx) => outputPayload`.
- Erweitere `TransitionOptions` um `{ input?: (ctx) => SubInputs; emit?: keyof TOutputs }`.
- Implementiere in `ValidateTransitionRows`:

1. Pflicht-Prüfung für `{ input: (ctx) => SubInputs }`, wenn `TO` eine Sub-Maschine mit nicht-leeren `inputs` ist.
2. Compile-Time Output-Exhaustiveness (`ValidateSubMachineOutputs`): Jede als `TO` verwendete Sub-Maschine mit deklarierten `outputs` muss für **jeden** ihrer Output-Keys mindestens eine `[subMachine, OutputKey, ...]`-Zeile in der Eltern-Matrix besitzen.
3. Korrekte Payload-Typisierung für `call: (m) => m._handler` in Zeilen `[subMachine, OutputKey, ...]`, sodass `_handler` exakt den in `outputs[OutputKey]` deklarierten Payload-Typ empfängt.

- Implementiere den Runtime Fail-Fast Guard im Runner, wenn ein Sub-Machine-Output vom Parent nicht abgefangen wird.

2. **`createMachineFeature` in `@matrix-fsm/angular` implementieren:**

- Baue `createMachineFeature<{ inputs?: ...; events?: ...; outputs?: ...; states?: ... }>()({ id, initial, transitions, state, methods, tasks })`.
- Nutze `signalState` aus `@ngrx/signals` für den isolierten Actor-State, damit natives `patchState(store, ...)` in `methods: (store) => ({ ... })` ohne Injector-Memory-Leaks funktioniert.
- Stelle sicher, dass `NoInfer` auf `transitions` genutzt wird, damit `m` in `call: (m) => m._method` und `ctx` in `guard: (ctx) => ...` sauber aus `state`, `inputs` und `methods` inferiert werden, obwohl `transitions` im Objekt-Literal ganz oben steht.
- Erweitere `withStateMachine` so, dass eingebettete `MachineFeature`-Akteure beim Betreten automatisch im `EnvironmentInjector` des Parent-Stores instanziiert werden (mit ihren eigenen `state`, `methods` und `tasks`), ihre `inputs` übergeben bekommen, bei Parent-Interrupt (`Hard Kill`) sofort abgebrochen (`AbortController.abort()`) werden und unter `store.actors.<id>()` ihr aktiver State für das Template lesbar ist.

3. **`@matrix-fsm/eslint-plugin` aktualisieren (`ast-utils.ts`):**

- Erweitere `isCreateFSMCall` in `packages/eslint-plugin/src/lib/ast-utils.ts`, sodass auch `createMachineFeature` erkannt wird und alle bestehenden Matrix-Linter-Regeln automatisch auf `createMachineFeature`-Matrizen angewendet werden.

4. **Coffee-Shop Playground refactoren (`apps/playground/src/app/features/coffee-shop/`):**

- Ersetze `barista.domain.ts`, `barista.machine.ts` und `barista.store.ts` durch eine einzige, in sich geschlossene Datei **`barista.feature.ts`** mit `createMachineFeature` (exakt nach dem Muster in Abschnitt 3.1).
- Aktualisiere `coffee-shop.domain.ts`, `coffee-shop.machine.ts`, `coffee-shop.store.ts` und `coffee-shop-example.component.html`, sodass `CoffeeShopStore` keinerlei Barista-Methoden oder Barista-Tasks mehr importieren muss, sondern `baristaFSM` völlig autonom als Sub-Akteur mit `inputs` und `outputs` läuft.

5. **Tests & Verifikation:**

- Schreibe Unit- und Compile-Time-Type-Tests (`@ts-expect-error`) für:
- Fehlendes `{ input: ... }` beim Betreten einer Sub-Maschine mit `inputs`.
- Fehlenden Output-Handler `[baristaFSM, 'COFFEE_READY', ...]` in der Eltern-Matrix (Exhaustiveness-Error).
- Automatische Ausführung und Abbruch (`AbortSignal`) eines `createMachineFeature`-Sub-Akteurs inkl. Output-Payload-Übergabe und Runtime Fail-Fast Guard.

- Führe `pnpm nx run-many -t test,lint,build` aus, bis alle Pakete und die Playground-App fehlerfrei grün sind.
