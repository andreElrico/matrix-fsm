# Das Manifest von Matrix-FSM: Der Geist der Library & Das 3-Spalten-Steckspiel

> **Motto:** *„Schluss mit verschachtelter JSON- & SCXML-Bürokratie: Eine flache 2D-Entscheidungsmatrix, die man auf einen Blick versteht.“*

---

## 1. Die Kernprämisse (Der Geist von `@matrix-fsm`)

State Machines in modernen Webanwendungen scheitern oft nicht an der Logik, sondern an der **kognitiven Last ihrer Repräsentationen**:
- **SCXML / XState JSON-Hell:** Tief verschachtelte Bäume, in denen Übergänge, Aktionen, Guards und Services über zig Hierarchie-Ebenen verstreut sind.
- **Entscheidungstabellen-Ideal:** Jeder Entwickler und Product Owner versteht sofort eine flache Tabelle:
  1. **Wo bin ich?** (FROM)
  2. **Was passiert?** (VIA)
  3. **Wo lande ich?** (TO)
  4. *(Optional)* **Was führe ich dabei aus?** (OPTIONS / `{ call, guard, output }`)

---

## 2. Die Anatomie der 3(+1)-Spalten-Matrix

Jede Maschine folgt dem unverrückbaren Steckspiel-Format:

```typescript
//               [ SPALTE 1 ]       [ SPALTE 2 ]         [ SPALTE 3 ]              [ SPALTE 4 (OPTIONAL) ]
//               FROM               VIA                  TO                        OPTIONS
transitions: [
  /* 01 */      ['idle',            'FETCH_DATA',        awaiting('loading'),      { call: (m) => m._loadData }],
  /* 02 */      ['loading',         'DONE',              'ready',                  { call: (m) => m._setData }],
  /* 03 */      ['loading',         'ERROR',             'errorView',              { call: (m) => m._setError }],
  /* 04 */      ['ready',           'RESET',             'idle',                   { call: (m) => m._reset }],
  /* 05 */      ['errorView',       'RETRY',             awaiting('loading'),      { call: (m) => m._loadData }],
]
```

### Die 3 Kernspalten:
1. **Spalte 1 (`FROM`):** Der Ausgangszustand (oder Sub-Machine / `anyState()`).
2. **Spalte 2 (`VIA`):** Das auslösende Event, der Timer (`after(ms)`, `every(ms)`) oder Sub-Machine-Abschluss.
3. **Spalte 3 (`TO`):** Der Zielzustand, Wartezustand (`awaiting(...)`), Verbleib (`stay()`) oder Endzustand (`finalState()`).

### Die optionale 4. Spalte (`OPTIONS`):
- **Keine eigenständigen Logikblöcke:** Keine Inline-Async-Callbacks oder verstreuten `tasks`-Blöcke.
- **Steckspiel-Verdrahtung:**
  - `guard: (ctx) => boolean` (Bedingte Transition)
  - `call: (m) => m._method` (Aufruf synchroner oder asynchroner Methoden aus dem Store)
  - `output: ['NAME', payload]` (Event-Emission für Sub-Maschinen)

---

## 3. Die Evolution: Vereinigung von `tasks` und `methods` (Cycle 55)

Im vorherigen Design gab es zwei getrennte Welten:
- `methods`: Für synchrone Seiteneffekte via `{ call: (m) => m._sync }`.
- `tasks`: Ein zweiter, separater Block für asynchrone Wartezustände, gekoppelt nur über String-Namensgleichheit.

**Der neue Geist ab Cycle 55:**
- `tasks` entfällt vollständig!
- **Alles ist eine Method:** Asynchrone Operationen werden direkt an der Transition in Spalte 4 via `{ call: (m) => m._asyncMethod }` eingehängt.
- **Automatischer Typenfluss:** Der Return-Wert von `m._asyncMethod` wird typsicher als Payload an das nachfolgende `DONE`-Event übergeben.

---

## 4. Warum Anti-SCXML?

| Merkmal | SCXML / XState | Matrix-FSM |
| :--- | :--- | :--- |
| **Leserichtung** | Vertikal & horizontal verschachtelt (Baum) | Strikt zeilenweise (Flache Tabelle) |
| **Visualisierung** | Benötigt Parser & Layout-Engine | Direkt lesbar + 1:1 Mermaid-Export |
| **Lernkurve** | Wochen (Statechart-Spezifikation) | Minuten (3 Spalten verstehen) |
| **Refactoring** | Fehleranfällig bei Tiefenänderungen | Zeilen kopieren, sortieren, fertig |
| **Linter-Fokus** | Typen-Validierung | Formale Vollständigkeitsprüfung (`require-fallback-transition`) |
