# Deep Research: FSM-Standardprobleme, XState-Vergleich & Matrix-FSM Gap-Analyse

## 1. Klassische FSM- & Statechart-Probleme: Matrix-FSM vs. Industriestandards

| Problemstellung | Klassische Lösung (Harel Statecharts / XState) | Matrix-FSM Steckspiel-Lösung | Bewertung & Trade-offs |
| :--- | :--- | :--- | :--- |
| **State Explosion** (Kombinatorische Explosion bei vielen parallelen Dimensionen) | Parallele Regionen (`type: 'parallel'`) in verschachteltem JSON-Baum. | **Policy-Driven Design** (`Record<Enum, Policy>`) für Orthogonales + `all`/`race`/`each` Combinators für parallele Sub-Maschinen. | **Exzellent:** Verhindert Pseudozustände in der FSM-Matrix; Daten bleiben im Context / in Domain Policies. |
| **Hierarchische Zustände (Nested / Compound States)** | Verschachtelte Konfigurationsobjekte (`parent.states.child`). Event-Bubbling von innen nach außen. | **Flache 2D-Matrix** mit rekursiven Sub-Maschinen (`[subFSM, OUTCOME, target]`). Kein Event-Bubbling, nur explizite Verträge. | **Reduziert kognitive Last:** Keine JSON-Verschachtelung. Sub-Maschinen sind 100% isolierte Einheiten (DIP/ISP). |
| **History States (`$history: 'shallow' | 'deep'`)** | Spezielle Pseudozustände, die beim Re-Entry den letzten aktiven Subzustand reaktivieren. | **Kein nativer History-State.** Zustand muss explizit in `context` persistiert oder über `restoreSnapshot()` restauriert werden. | **Prüfenswert:** Für typische Wizard-Back-Buttons oder Modals fehlt eine deklarative Kurzform; Snapshotting ist mächtig, aber schwergewichtiger. |
| **Event Race Conditions & Cancellation** | `spawnChild` mit Actor-Referenzen und manueller `stop(ref)` Action oder Transition-Cancellation. | **8-Phase Microstep Pipeline + Epoch Protection:** Re-Entry bricht vorherige `awaiting()`-Tasks atomar ab; Stale-Events werden via Epoch verworfen. | **Sehr robust:** Schutz vor Out-of-Order Responses bei schnellen UI-Eingaben (z.B. Typeahead-Suche). |
| **Delayed & Periodic Events** | `after: { 500: 'target' }` | `after(ms)` für Zustandswechsel, `every(ms)` für periodische Ticks (mit `stay()`). | **Klarere Semantik** durch getrennte Primitive (nach Zyklus 53). |
| **Dynamische Actor-Mengen** | Dynamisches Spawning via `spawnChild` im Actor-System. | Deklarativer `each()`-Combinator für Collections (`each({ items: (ctx) => ctx.items, machine: itemFSM })`). | **Einfacher zu typisieren**, deckt 90% der UI-Listen-Szenarien ab, aber weniger flexibel bei Ad-hoc-Netzwerken. |

---

## 2. Detaillierter Vergleich: `@matrix-fsm` vs. `XState v5`

### 2.1 Stärken von Matrix-FSM gegenüber XState
1. **Flache 4-Spalten-Matrix (`[FROM, VIA, TO, OPTIONS?]`):**
   - Extrem hohe Lesbarkeit (wie eine Entscheidungstabelle).
   - Kein "JSON-Hell" mit tief verschachtelten Objekten.
   - Visuell direkt 1:1 auf [Mermaid](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/mermaid.ts)-Diagramme abbildbar.
2. **First-Class Angular SignalStore Integration:**
   - Nahtlose Bindung an Signals (`store.state()`, `store.can()`, `store.send()`).
   - `withStateMachine` als native `signalStoreFeature`-Erweiterung mit DI-Support.
3. **Kompilier- und Linter-getriebene Robustheit (`@matrix-fsm/eslint-plugin`):**
   - Lückenlose Fallback-Prüfung (`require-fallback-transition`).
   - Verbot von illegalen `anyState()`-Sprüngen ("Anti-Hope-Driven Development").
   - Typ-Sicherheit für `awaiting()`-Handler und Event-Namen ohne generischen Overkill.

### 2.2 Was XState bietet, was Matrix-FSM (noch) fehlt

1. **History States:**
   - *XState:* Erlaubt Rücksprung in den exakten Unterzustand nach einer Pause/Unterbrechung (`target: 'hist'`).
   - *Matrix-FSM Status:* Fehlt als primitives Schlüsselwort. Muss manuell über `context.lastActiveState` und Guards modelliert werden.
   - *Bewertung:* **Sinnvoll als optionales Primitiv** (`historyState()` oder `previousState()`), um Standard-Workflows (z.B. Auth-Interruption -> Return to Origin) sauber zu lösen.
2. **Event Buffering / Queuing:**
   - *XState:* Kann Events puffern (`enqueueActions`, FIFO Event-Warteschlange während Microsteps).
   - *Matrix-FSM Status:* Verwirft Events, wenn der Zustand sie nicht erlaubt (`can() === false`), oder führt sie sofort synchron aus.
   - *Bewertung:* Oft gewolltes Verhalten (Drop unhandled inputs), aber für asynchrone Queues (z.B. Netzwerk-Offline -> Online Re-Sync) wäre ein deklaratives `buffer`-Flag wertvoll.
3. **Visueller interaktiver Live-Debugger:**
   - *XState:* `Stately Inspector` / `@xstate/inspect` mit Live-Tracing, Event-Injektion und Zeitleiste im Browser.
   - *Matrix-FSM Status:* `inspect`-Hook existiert im Core, exportiert Mermaid-Code, hat aber kein eigenständiges UI-Panel.
   - *Bewertung:* Mermaid deckt statische Visualisierung ab; ein SignalStore-DevTools-Plugin wäre der nächste logische Schritt.

---

## 3. Empfohlene Handlungsschritte für Matrix-FSM

1. **Kein Feature-Creep durch SCXML-Vollständigkeit:**
   - Die bewusste Ablehnung von verschachteltem JSON und SCXML-Overhead ist die Kernstärke von `@matrix-fsm`.
2. **`historyState()` Evaluieren:**
   - Prüfen, ob ein `history()`-Target in Spalte 3 (`TO`) für Sub-Maschinen ohne Kontext-Ballast integriert werden soll.
3. **Stabilisierung der Core- & Angular-Schnittstelle:**
   - Behebung des Syntaxfehlers in [core.spec.ts](file:///home/hanshannes/Development/matrix-fsm/packages/core/src/lib/core.spec.ts#L59) und der 14 Tests in [with-state-machine.spec.ts](file:///home/hanshannes/Development/matrix-fsm/packages/angular/src/lib/with-state-machine.spec.ts).
