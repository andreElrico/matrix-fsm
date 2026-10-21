- serialize statemachine to continue at a certain state
- undo redo---

## ☕ Architektur-Diskussion: Sub-Machines vs. Actor-Modell vs. 1:N-Skalierung

### 1. Ausgangslage & Problemstellung

Im Refactoring des Coffee Shops wurde der Barista als hierarchische Sub-FSM eingebunden.

- **Aktueller Stand:** In der Matrix steht `baristaFSM` in Spalte 3 (`TO`) und Spalte 1 (`FROM`). Im Angular-Store registriert `withBarista()` State, Methods und Tasks (`withMachineTasks`).
- **Die offene Frage:** Warum muss der Parent-Store den Barista überhaupt kennen (`withBarista()`)? Warum kann der Barista nicht autark als eigener Aktor agieren? Wie kommunizieren zwei Maschinen sauber ohne Magic Strings? Was passiert bei mehreren Baristas (1:N) oder Kaffeeketten?

---

### 2. Die drei Architektur-Muster im Vergleich

| Muster                                                            | Wie es funktioniert                                                                                        | Vorteile                                                                                                                                                                                                                   | Nachteile / Grenzen                                                                                                                                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A) Hierarchische Sub-Machine (Statechart)** _(Aktueller Stand)_ | Barista ist ein temporärer Unterzustand des Coffee Shops (`baristaFSM`).                                   | - **Group-Interrupts:** Parent bricht Child-Tasks (`brewingCoffee`) sofort atomar ab.<br>- **Typsicher:** Outcomes (`COFFEE_READY`) sind compile-time geprüft, 0 % Magic Strings.<br>- Visuell 1:1 in Mermaid darstellbar. | - Bindet den Parent an den Child-Lifecycle.<br>- Nur 1:1 abbildbar (Shop kann nicht parallel neue Kunden bedienen, während der Barista brüht).                                   |
| **B) Typed Actor Delegation (Actor Model)**                       | Coffee Shop und Barista sind zwei getrennte Services/Stores. Shop delegiert Auftrag an Barista.            | - **Entkopplung:** Coffee Shop hat 0 % Barista-Code/State im Store.<br>- Barista ist überall wiederverwendbar (Dashboard, Queue, andere Shops).                                                                            | - **Race Conditions bei Cancel:** Storniert der Shop während der Barista fertig wird, drohen Geister-Kaffees.<br>- Benötigt Korrelations-IDs (`orderId`) und Ack/Nack-Protokoll. |
| **C) Dynamic Process Pools (`each(...)`)**                        | Shop hat eine Liste von Bestellungen (`orders: Order[]`), jede Bestellung hat eine eigene Barista-Instanz. | - **Löst das 1:N-Problem:** 5 Baristas können parallel 5 Kaffees brühen.<br>- `ALL_DONE`-Event, wenn alle fertig sind.                                                                                                     | - Etwas komplexeres Context-Management im Parent (Listen-Synchronisation).                                                                                                       |

---

### 3. Keine Sackgasse: Wie typisierte Kommunikation ohne "Magic Strings" funktioniert

Kommunikation zwischen Maschinen braucht **keine** Magic Strings, sondern nutzt typisierte Contracts:

1. **Input Contract (Parent → Child):**
   ```ts
   // Der Child-Aktor deklariert exakt, was er zum Starten braucht:
   export type BaristaInput = { readonly drink: CoffeeDrink };
   ```
2. **Output Contract (Child → Parent):**
   ```ts
   // Der Child-Aktor definiert seine terminalen Ergebnisse typisiert:
   export type BaristaOutput = { readonly result: BrewResult };
   ```
3. **Event-Protokoll via Matrix:**
   - In TypeScript wird `ExtractFinalOutcomes<typeof childFSM>` automatisch ausgelesen.
   - Spalte 2 (`VIA`) akzeptiert nur echte, typisierte Outcomes des Children. Tippfehler werden vom Compiler sofort rot markiert.

---

### 4. Empfehlungen für den nächsten Schritt

1. **Kurzfristig (V1): Sub-Machine beibehalten, da es für sequentielle Abläufe ideal ist.**
   - Für den aktuellen Coffee Shop (1 Kunde an der Kasse $\rightarrow$ Barista brüht $\rightarrow$ Kunde nimmt Kaffee) ist die hierarchische Sub-Machine die robusteste Lösung: Sie garantiert saubere Abbrüche und einfache Synchronisation.
2. **Mittelfristig (V2): Typed Actor Ports für unabhängige Domänen einführen.**
   - Einführung von `actor(baristaFSM, { input, onDone })`, sodass der Parent-Store weder State noch Tasks des Aktors importieren muss. Der Aktor läuft in einem eigenen Injection-Scope.
3. **Für Nebenläufigkeit: `each('orders', baristaFSM)` nutzen.**
   - Wenn mehrere Baristas parallel arbeiten sollen, ist `each()` bereits im Core vorhanden und orchestriert N parallele Kind-Maschinen sauber.
