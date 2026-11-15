# Deep Dive: Architektur-Schwachstellen, "Inelegante" Lösungen & Aufgedeckte Bugs

## 1. Der `tasks` -> `{ call }` Migrations-Bruch (Cycle 55)

### Problem / Bug
In Cycle 55 wurde begonnen, das `tasks`-Objekt durch `{ call: (m) => m._method }` in Spalte 4 der Transitions-Matrix abzulösen. 
In [fsm.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/fsm.ts#L258) wird `awaitingCallSelectors` jedoch nur registriert, wenn eine Transition mit `options?.call` gefunden wird:
```typescript
if (isAwaitingNode(to)) {
  if (options?.call && !awaitingCallSelectors.has(to.state)) {
    awaitingCallSelectors.set(to.state, options.call);
  }
}
```
In [with-state-machine.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.ts#L1258):
```typescript
const effectiveSelector = callSelector ?? fsm.awaitingCallSelectors?.get(stateName) ?? null;
if (!effectiveSelector) return; // <-- Bricht lautlos ab!
```

### Konsequenzen & Ineleganz
1. **Stille No-Ops:** Existierende Features mit `tasks: () => ({ myTask: ... })` oder Transitions ohne explizites `{ call }` (z.B. Test *Cycle 14*) führen ihre asynchronen Operationen gar nicht mehr aus. Der State bleibt ewig in `awaiting` hängen.
2. **DRY-Verletzung bei Mehrfach-Eintritten:** Wenn Zustand `awaiting('loading')` von 3 verschiedenen Events angesprungen wird, muss jede Zeile `{ call: (m) => m._load }` duplizieren, oder man verlässt sich darauf, dass die erste Zeile die Map füllt.
3. **Elegante Lösung:**
   - Automatischer Fallback-Konvention: Wenn kein explizites `call` definiert ist, suche in `methods` nach `_<stateName>` oder `<stateName>`.
   - Beibehaltung von `config.tasks?.[stateName]` als Fallback für bestehende Maschinen (Rückwärtskompatibilität).

---

## 2. NgRx SignalStore Slice-Hydration Bug (Combinators / Sub-Actors)

### Problem / Bug
Beim Ausführen von Combinators (`all`, `race`) oder `restoreSnapshot`:
```text
@ngrx/signals: patchState was called with an unknown state slice 'barista'.
Ensure that all state properties are explicitly defined in the initial state.
Updates to properties not present in the initial state will be ignored.
```

### Ursache & Ineleganz
`@ngrx/signals` verbietet das dynamische Hinzufügen von State-Properties zur Laufzeit. 
Wird eine Sub-Maschine (`barista`) oder ein Combinator-Child dynamisch gemountet, existiert der State-Key im SignalStore nicht, wenn er nicht zuvor im `initialState` von `withState({...})` deklariert wurde.
- **Folge:** `restoreSnapshot` schlägt fehl (14 Tests in `with-state-machine.spec.ts` rot).
- **Elegante Lösung:**
  1. Entweder extrahiert `withStateMachine` vorab alle bekannten Sub-Machine-IDs und initialisiert sie im Root-State als `null`/`{}`.
  2. Oder Sub-Actors verwalten ihren Zustand in isolierten Child-Stores / privaten Signal-Maps statt direkt im Root-`patchState`.

---

## 3. Zero-Tick Synchronous Child Completion Race (Cycle 18)

### Problem
Wenn ein Child-Actor oder eine synchrone `call`-Methode unmittelbar während `onStateEnter` ihr Terminal-Event (`DONE` / Output) emittiert:
- Die Microstep-Pipeline des Parents befindet sich noch in der Abarbeitung des Zustandswechsels.
- Das Event wird entweder verschluckt oder gegen den noch nicht vollständig aktivierten Parent-Zustand ausgewertet.
- **Folge:** Zustand verharrt in `baristaZeroTick` statt nach `ready` zu wechseln.
- **Elegante Lösung:** Microtask-Scheduling / Queue-Mechanismus (`queueMicrotask` oder 2-Phasen-Commit-Queue), damit Enter-Hooks vollständig abgeschlossen sind, bevor Folge-Events dispatcht werden.

---

## 4. Effect-TS Sandwich Architektur (Cycle 58)

### Bewertung
- **Sehr elegant:** Die strikte Trennung via [packages/angular/src/effect/index.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/effect/index.ts) hält den Angular-Core frei von Effect-TS-Dependencies.
- **Gefahr:** Der `taskAdapter` greift nur, wenn `createEffectMachineFeature` genutzt wird. Wenn ein Entwickler `Effect.Effect` in einem regulären `createMachineFeature` zurückgibt, schlägt `result.then` fehl (da Effect kein Promise ist).
- **Vorschlag:** Linter-Regel oder aussagekräftige Runtime-Warnung: *"Effect returned in standard feature; use createEffectMachineFeature or runPromise()"*.

---

## 5. Syntax-Blocker in Core Tests

- [packages/core/src/lib/core.spec.ts#L59-L60](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/core.spec.ts#L59-L60):
  Duplizierte Typ-Deklaration `interface AuthMethods { interface AuthMethods {` verhindert Vitest-Ausführung in `@matrix-fsm/core`.
