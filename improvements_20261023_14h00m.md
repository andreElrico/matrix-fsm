# Architekturanalyse & Spezifikation: Einheitliches Output-System, Spalten-Klarheit & KISS-Matrix-Design

**Datum:** 23. Oktober 2026  
**Status:** Verbindliche Entwurfs- und Planungsspezifikation  
**Fokus:** KISS-Prinzip (Keep It Simple, Stupid), visuelle Ruhe der Matrix, vollständige Beseitigung von `emit`, einheitliches Tupel-Outputting in Spalte 4 (`OPTIONS`) und semantische Klarheit von `finalState` und `awaiting`.

---

## 1. Motivation & Schmerzpunkte der bisherigen Syntax

In der bisherigen Umsetzung (v2) haben sich bei der praktischen Nutzung von Sub-Maschinen und Outputs drei wesentliche Schmerzpunkte herauskristallisiert:

### 1.1 Zerstörung des Matrix-Layouts durch Inline-Payloads in Spalte 3 (`TO`)
In `barista.feature.ts` führte Zeile 56 zu einem extremen Layout-Bruch:
```typescript
/* FROM            VIA      TO                                                                                                     OPTIONS */
['brewingCoffee',  'DONE',  finalState('COFFEE_READY', (ctx) => ({ drinkName: ctx.selectedDrink.name, result: ctx.baristaResult! }))],
```
* **Problem:** Ein 80-Zeichen langes Lambda in Spalte 3 zwang die gesamte Tabelle horizontal in die Breite. Alle anderen Zeilen benötigten massive Leerzeichen-Padding-Wüsten, um die Spaltenausrichtung zu halten.
* **Philosophischer Bruch:** Spalte 3 (`TO`) ist semantisch der **Zielort** (Wohin geht die Reise?). Berechnungen, Context-Mappings, Guards und Seiteneffekte gehören seit jeher ausnahmslos in **Spalte 4 (`OPTIONS`)**.

### 1.2 Begriffswirrwarr (`emit` vs. `output` vs. `finalState`)
* Im Feature-Vertrag hieß die Schnittstelle `outputs: BaristaOutputs`.
* Für terminale End-Events schrieben wir `finalState('COFFEE_READY')` in Spalte 3.
* Für nicht-terminale Zwischen-Events (z. B. Progress) bot der Core plötzlich `{ emit: 'PROGRESS' }` in Spalte 4.
* **Ergebnis:** Zwei völlig unterschiedliche APIs und Bezeichnungen für denselben konzeptionellen Kommunikationskanal nach außen.

### 1.3 Asymmetrie zwischen Terminal- und Zwischen-Outputs
* Warum stand bei `finalState` der Event-Name in Spalte 3, bei Zwischen-Outputs (`stay()`) aber in Spalte 4?
* Diese Asymmetrie erzeugte kognitive Reibung: Der Entwickler musste ständig überlegen, an welcher Stelle der Event-Name deklariert werden muss.

---

## 2. Die Leitprinzipien der Überarbeitung

1. **KISS (Keep It Simple, Stupid):**
   Keine unnötigen Zusatz-Begriffe. Angular-Entwickler kennen `input()` und `output()`. Wir werfen das Wort `emit` vollständig aus dem Vokabular der Library.
2. **Strikte Spalten-Integrität (The 4-Column Contract):**
   * **Spalte 1 (`FROM`):** Wo bin ich? *(Reiner Identifier)*
   * **Spalte 2 (`VIA`):** Was passiert? *(Reiner Identifier)*
   * **Spalte 3 (`TO`):** Wohin gehe ich? *(Reiner Ziel-Identifier: `stay()`, `finalState()`, `'stateName'`, `awaiting('stateName')`)*
   * **Spalte 4 (`OPTIONS`):** Was wird berechnet / ausgeführt? *(Logik & Daten: `guard`, `patch`, `call`, `input`, **`output`**)*
3. **Keine Magie / Keine unbenannten Payloads:**
   Sobald Daten an den Parent übertragen werden, muss der Event-Name im Tupel explizit deklariert sein. Das implizite `finalState()` hat **niemals** eine Payload.

---

## 3. Die einheitliche Tupel-Spezifikation (`output: ['NAME', (ctx) => payload]`)

Jeder Output, der Daten transportiert, wird **ausnahmslos in Spalte 4 (`OPTIONS`)** über ein schlankes 2-Elemente-Tupel definiert:

```typescript
output: ['EVENT_NAME', (ctx) => payloadSelector(ctx)]
```

### 3.1 Die vier Kern-Szenarien im Vergleich

#### Fall 1: Finaler State (Maschine terminiert + End-Output mit Payload)
Spalte 3 markiert rein den Abschluss der Maschine (`finalState()`). Spalte 4 liefert Event-Name und Payload:
```typescript
['brewingCoffee', 'DONE', finalState(), {
  output: ['COFFEE_READY', (ctx) => ({
    drinkName: ctx.selectedDrink.name,
    result: ctx.baristaResult!,
  })],
}],
```

#### Fall 2: Stay (Maschine bleibt im Zustand + Zwischen-Output / Streaming)
Die Maschine bleibt im Zustand `brewingCoffee` (z. B. auf einen internen Tick oder Task-Fortschritt), meldet aber Zwischenwerte nach oben:
```typescript
['brewingCoffee', 'TICK', stay(), {
  output: ['PROGRESS', (ctx) => ({ percent: ctx.progress })],
}],
```

#### Fall 3: Regulärer State-Wechsel mit Output
Die Maschine wechselt von `brewingCoffee` nach `'cleaning'`, sendet dabei aber gleichzeitig ein Signal an die Eltern-Maschine:
```typescript
['brewingCoffee', 'CLEAN_ALARM', 'cleaning', {
  output: ['MAINTENANCE_LOG', (ctx) => ({ cupsBrewed: ctx.cupsCount })],
}],
```

#### Fall 4: Vor und nach asynchronen Effekten (`awaiting`)
**Genialer Minimalismus:** `awaiting('state')` benötigt **keine** neuen Optionen oder Callbacks! Das Matrix-Modell deckt diesen Fall bereits nativ und vollständig ab:
* **Output VOR dem Start des Tasks:** Ist die Transition, die in den Awaiting-State *hineinführt*.
* **Output NACH dem Ende des Tasks:** Ist die Transition, die bei Task-Abschluss (`'DONE'`) aus dem Awaiting-State *hinausführt*.
* **Output WÄHREND des Tasks:** Ist eine `stay()`-Transition auf interne Ticks/Events.

```typescript
// prettier-ignore
transitions: [
  /* FROM            VIA              TO                          OPTIONS */

  // 1. VOR dem Effekt: Eintritt in awaiting -> meldet Start-Output nach oben
  ['ticketQueued',   'START_BREWING', awaiting('brewingCoffee'),  { output: ['BREWING_STARTED', (ctx) => ({ at: Date.now() })] }],

  // 2. WÄHREND des Effekts: Bleibt im State -> meldet Fortschritt
  ['brewingCoffee',  'PROGRESS_TICK', stay(),                     { output: ['PROGRESS', (ctx) => ({ percent: ctx.progress })] }],

  // 3. NACH dem Effekt: Task fertig (DONE) -> meldet Ergebnis und beendet Sub-Maschine
  ['brewingCoffee',  'DONE',          finalState(),               { output: ['COFFEE_READY', (ctx) => ({ result: ctx.baristaResult! })] }],
],
```

---

## 4. Die Shorthand-Regeln (Wenn kein Payload benötigt wird)

Wenn ein Output keine Daten transportiert (`void`), greifen extrem kompakte Shorthands, die Spalte 4 komplett einsparen:

### 4.1 Standard-Lifecycle `'DONE'` (Implizit)
Wird `finalState()` ohne Argumente und ohne `options.output` aufgerufen, feuert die Maschine beim Terminieren das Standard-Lifecycle-Event `'DONE'` an den Parent:
```typescript
['brewingCoffee', 'DONE', finalState()],
```

### 4.2 Spezifischer Event-Name ohne Payload
Soll die Maschine mit einem fachlichen Event-Namen abschließen (z. B. `'CANCELLED'`), für den im Contract `void` definiert ist:
```typescript
['brewingCoffee', 'CANCEL', finalState('CANCELLED')],
```

### 4.3 Strikte Ausschluss-Regel (Kein Mischen von Shorthand und Spalte 4!)
* Wird `finalState('NAME')` mit Argument in Spalte 3 genutzt, ist in Spalte 4 **kein `output` erlaubt**.
* Sobald Daten übergeben werden, **muss** Spalte 3 `finalState()` heißen und Spalte 4 das Tupel `output: ['NAME', (ctx) => ...]` enthalten.
* Das implizite `'DONE'` hat **niemals** eine Payload.

---

## 5. Vorher-Nachher-Vergleich (`barista.feature.ts`)

### Vorher (v2 – unruhig, breite Zeile 56, Inline-Lambda in Spalte 3):
```typescript
// prettier-ignore
transitions: [
  /* FROM            VIA               TO                                                                                                     OPTIONS */
  ['ticketQueued',   'START_BREWING',  awaiting('brewingCoffee')],
  ['brewingCoffee',  'DONE',           finalState('COFFEE_READY', (ctx) => ({ drinkName: ctx.selectedDrink.name, result: ctx.baristaResult! }))],
  ['brewingCoffee',  'ERROR',          'maintenance',                                                                                         { call: (m) => m._setBrewError }],
  ['maintenance',    'RETRY_BREW',     awaiting('brewingCoffee')],
],
```

### Nachher (Zielbild – 100% sauber ausgerichtet, alle Logik in Spalte 4):
```typescript
// prettier-ignore
transitions: [
  /* FROM            VIA               TO                         OPTIONS */
  ['ticketQueued',   'START_BREWING',  awaiting('brewingCoffee')],
  ['brewingCoffee',  'DONE',           finalState(),              { output: ['COFFEE_READY', (ctx) => ({ drinkName: ctx.selectedDrink.name, result: ctx.baristaResult! })] }],
  ['brewingCoffee',  'ERROR',          'maintenance',             { call: (m) => m._setBrewError }],
  ['maintenance',    'RETRY_BREW',     awaiting('brewingCoffee')],
],
```

---

## 6. TypeScript-Typen & Compile-Time-Garantien

Für die Implementierung im `@matrix-fsm/core` gelten folgende Typ-Integritäten:

```typescript
// 1. Definition des Output-Tupels
export type TransitionOutputTuple<TOutputs, TContext, TPayload> = {
  [K in keyof TOutputs]: TOutputs[K] extends void
    ? K | readonly [K]
    : readonly [K, (ctx: ReadonlyContext<TContext>, eventPayload: TPayload) => TOutputs[K]];
}[keyof TOutputs];

// 2. Options-Erweiterung (Ersetzt das alte 'emit')
export interface TransitionOptions<TContext, TPayload, TMethods, TInput, TOutputs> {
  readonly guard?: (ctx: ReadonlyContext<TContext>, eventPayload: TPayload) => boolean;
  readonly patch?: (ctx: ReadonlyContext<TContext>, eventPayload: TPayload) => PatchResult<TContext>;
  readonly call?: (methods: TMethods) => ((eventPayload: TPayload) => void) | void;
  readonly input?: (ctx: ReadonlyContext<TContext>, eventPayload: TPayload) => TInput;
  
  /**
   * Universelles Outputting an die Eltern-Maschine.
   * Ersetzt 'emit' vollständig.
   * Beispiel: `output: ['COFFEE_READY', (ctx) => ({ result: ctx.baristaResult })]`
   */
  readonly output?: TransitionOutputTuple<TOutputs, TContext, TPayload>;
}
```

### Compile-Time-Prüfungen:
1. **Tippfehler-Schutz:** Der Event-Name im Tupel (`'COFFEE_READY'`) wird strikt gegen `keyof TOutputs` validiert.
2. **Payload-Exhaustiveness:** Verlangt `BaristaOutputs['COFFEE_READY']` ein Objekt `{ drinkName: string; result: BrewResult }`, verweigert TypeScript das Kompilieren, wenn der Selector fehlt oder einen inkompatiblen Typ zurückgibt.
3. **Kollisions-Schutz:** Steht `finalState('CANCELLED')` in Spalte 3, wird `options.output` per Typ-Constraint verboten.
