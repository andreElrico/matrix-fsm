# Codebase Analysis & Research Findings (2026-11-07)

## 1. Akute Fehler & Blocker (Sofortige Stabilität)

- **Syntax-Fehler in Test-Suite (`@matrix-fsm/core`):**
  - [packages/core/src/lib/core.spec.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/core.spec.ts#L59-L60): Duplizierte Zeile `interface AuthMethods { interface AuthMethods {` verhindert Kompilierung via Vite/OXC.
- **Fehlschlagende Tests in `@matrix-fsm/angular` (14 Tests RED):**
  - **SignalStore Unknown Slices:** `@ngrx/signals: patchState was called with an unknown state slice ('barista', 'bakery', ...)` bei Combinator-Restoration (`restoreSnapshot`).
  - **Zero-Tick Completion:** Synchrone Sub-Actor-Abschlüsse in `onStateEnter` hinterlassen unerwarteten Zustand (`baristaZeroTick` statt Zielzustand `ready`).
  - **Epoch Protection & Self-Transition:** Re-Entry bricht Tasks ab, aber Zustand springt verfrüht oder ignoriert Re-Entry-Initialisierung.

---

## 2. Public API Schwachstellen & Verbesserungsvorschläge

### A. Typ-Sicherheit & API-Konsistenz
- **Diskrepanz zwischen Matrix-Format und Methoden-Binding:**
  - `awaiting('state')` vs. `{ call: (m) => m._method }`: Unklarheit, ob Rückgabewerte explizit als Payload (`DONE`) oder typspezifische Events (`APPROVED`) deklariert werden müssen.
  - **Vorschlag:** Explizite Rückgabetypen `FsmOutcome<TEventMap>` für `call`-Handler, um ungültige Event-Namen zur Compile-Zeit zu verhindern.
- **Timer-Semantik (`after` vs. `every`):**
  - `after(ms)` mit `stay()` stiftete Verwirrung (Zyklus 53).
  - **Vorschlag:** Typ-Ebene-Guard: `after(ms)` darf typmäßig niemals `stay()` als Target akzeptieren; nur `every(ms)` erlaubt `stay()`.
- **`can()`-Verhalten bei Guard-Fallbacks:**
  - `store.can('EVENT')` gab `true` für reine No-Op-`stay()`-Zeilen zurück.
  - **Vorschlag:** Bereitstellung von `can(event, { includeFallbacks: false })` bzw. strikte Standard-Filterung von No-Op-Fallbacks.

---

## 3. Internals & Laufzeit-Architektur

### A. SignalStore Integration (`@matrix-fsm/angular`)
- **Slice-Initialisierung für Sub-Actors:**
  - SignalStore ignoriert dynamische Slices, wenn sie nicht im Root-State definiert sind.
  - **Vorschlag:** Automatisches Vormerken von Child-State-Slices im `withState`-Initialisierer oder Isolierung von Sub-Actors in getrennte Scopes anstelle von Root-`patchState`.
- **Microstep-Pipeline & Re-entrancy:**
  - Synchrones Abfeuern von Child-Outputs blockiert Parent-Transitions.
  - **Vorschlag:** Microtask-Queue oder 2-Phasen-Commit für Child-Events, um Deadlocks bei synchroner Ausführung zu vermeiden.

### B. ESLint Rules (`@matrix-fsm/eslint-plugin`)
- **Regeln schärfen:**
  - `valid-any-state-target`: Sollte zusätzlich Warnungen für `anyState()` mit asynchronen Seiteneffekten ausgeben.
  - `require-awaiting-handlers`: Sollte auf statische Rückgabetypen von `call` prüfen.
