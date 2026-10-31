*User prompt: changes have been done. What can be improved. Look at the code. a) See what can go technically mathematically b) What could maybe be improved from a DX standpoint?*

Response: Die Umsetzung von Commit 2d05b27 ist ein gewaltiger Meilenstein: Die 8-Phasen-Microstep-Pipeline, der stateEpoch-Schutz bei Re-Entry, always() mit Endlosschleifen-Schutz (MatrixFsmInfiniteLoopError), getSnapshot() / restoreSnapshot(), getShortestPaths(), inspect, die ExpectedCallSignature-Kontravarianz-Lösung und die beiden neuen ESLint-Regeln (no-shadowed-transitions, no-duplicate-combinator-actors) sind im Code gelandet.

Wenn man den aktuellen Code-Stand 2d05b27 Zeile für Zeile seziert, zeigen sich jedoch **5 konkrete technisch-mathematische Bugs** (darunter eine Lücke zwischen Core-Runner und Angular-Adapter bei all()) sowie **4 DX-Schwachstellen**, die wir noch glattziehen sollten.

### **A) Technisch & Mathematisch: Was im Code von 2d05b27 noch schiefgehen kann**

#### **1\. all()- und race()-Kinder werden in withStateMachine (Angular Store) NIEMALS als Feature-Akteure gespawnt\!**

Schau dir packages/angular/src/lib/with-state-machine.ts (Zeilen 495–525, collectSubFeatureDefs und spawnSubFeatureActor) im Vergleich zu createFeatureTester (Zeilen 916–998) an:

> * In **createFeatureTester** (Zeile 921\) gibt es if (isCombinatorNode(enteredTarget)) { spawnCombinatorFeatureActors(enteredTarget, resolvedInput); }, das für jedes Kind in all(baristaFSM, bakeryFSM) die Feature-Tasks, methods, signalState und whenSignal startet.  
> * In **withStateMachine (dem echten Angular SignalStore\!)** fehlt dieser Block komplett\!  
  1. collectSubFeatureDefs (Zeile 495\) prüft nur if (isMachineFeatureDefinition(to)) – es packt CombinatorNode (all, race, any) **nicht** aus\!  
  2. onStateEnter in withStateMachine (Zeile 585\) prüft nur const featureDef \= subFeatureDefs.get(enteredState). Bei all(baristaFSM, bakeryFSM) ist enteredState aber '\_\_all\_\_:barista,bakery'\!  
  3. **Folge:** Im createFeatureTester funktioniert all(baristaFSM, bakeryFSM), aber in einer **echten Angular-App (withStateMachine)** läuft stattdessen nur der nackte Core-SubRunner ohne baristaFSM.state, ohne baristaFSM.methods und ohne baristaFSM.tasks\!

#### **2\. restoreSnapshot() stellt childSnapshots noch nicht wieder her (Deadlock nach Reload mitten im Sub-Actor)**

Schau dir packages/core/src/lib/runner.ts (Zeilen 782–806) an:

> * getSnapshot() speichert sauber childSnapshots:  
>   `if (activeSubMachine && activeSubRunner) {`  
>     `childSnapshots = { [activeSubMachine.id]: activeSubRunner.getSnapshot() };`  
>   `}`

> * Aber in **restoreSnapshot(snapshot)** (Zeilen 793–806) wird snapshot.childSnapshots **komplett ignoriert**:  
>   `restoreSnapshot(snapshot: MachineSnapshot<TContext>): void {`  
>     `teardownActiveChildren();`  
>     `currentState = snapshot.state;`  
>     `// ❌ FEHLER: activeSubMachine / activeSubRunner werden NICHT aus snapshot.childSnapshots rekonstruiert!`  
>     `options?.onStateEnter?.(currentState);`  
>   `}`

> * **Mathematische Folge:** Machst du getSnapshot(), während die Maschine im Sub-Actor 'brewingCoffee' (innerhalb von baristaFSM) steht, und rufst danach restoreSnapshot(snap) auf, setzt der Parent seinen String-State zwar auf 'brewingCoffee', aber activeSubMachine und activeSubRunner bleiben **null**\! Da 'brewingCoffee' in der Eltern-Matrix gar nicht als String-State existiert (dort steht \[baristaFSM, ...\]), ist die Maschine nach restoreSnapshot in einem **permanenten Deadlock**\!

#### **3\. always() auf dem initial-Zustand wird beim Start übersprungen**

Schau dir das Ende von createMachineInstance in packages/core/src/lib/runner.ts (Zeile 754\) an:

`// Cycle 15: Schedule after(ms) timers if the initial state has declarative timers`  
`scheduleAfterTimers(currentState);`

> * Wenn der initial-Zustand einer Maschine eine eventlose always()-Verzweigung hat (z. B. initial: 'checkingAuth', \['checkingAuth', always(), 'dashboard', { guard: isAuthenticated }\], \['checkingAuth', always(), 'login'\]), wird beim Erstellen der Maschine nur scheduleAfterTimers(currentState) aufgerufen, aber **nicht** evaluateAlwaysTransitions()\!  
> * Die Maschine bleibt dadurch beim Start in 'checkingAuth' stecken, bis irgendein externes Event reinkommt.

#### **4\. getShortestPaths() verliert Kanten, wenn ein State mehrere ausgehende Events zum selben Nachbarn oder Sub-Actors hat**

In packages/core/src/lib/mermaid.ts (getShortestPaths, Zeilen 144–200):

> * Wenn to eine subMachine (baristaFSM) ist, gibt resolveTargetStateName(to) to.id ('barista') zurück. In der nächsten Zeile steht aber \[baristaFSM, 'COFFEE\_READY', 'coffeeReady'\]. Das funktioniert für einfache Sub-Machines, aber:  
  1. Für all(a, b), race(a, b) oder any(a, b) gibt resolveTargetStateName in Zeile 129 **null** zurück (return null;)\! Dadurch sind alle Zustände hinter einem all()- oder race()-Knoten (wie 'orderReady') für getShortestPaths **unerreichbar**\!  
  2. Für always()-Übergänge fügt getShortestPaths aktuell { event: '\_\_always\_\_' } in den Pfad ein. Würde ein Entwickler diesen Pfad in einem Test abspielen (for (const step of path) store.send(step.event)), funktioniert '\_\_always\_\_' nicht, weil always() von selbst (ohne send()) feuert\!

#### **5\. ValidateTransitionRows wird bei createMachineFeature ohne explizites states im Contract umgangen\!**

Das ist die subtilste TypeScript-Lücke im aktuellen Code – schau dir packages/angular/src/lib/with-state-machine.ts (Zeile 215\) an:

`TResolvedStates extends string = [TContract['states']] extends [never]`  
  `? string`  
  `: TContract['states'] extends string`  
    `? TContract['states']`  
    `: string,`

Und darunter in Zeile 225:

`transitions: TTransitions &`  
  `ValidateTransitionRows<`  
    `TTransitions,`  
    ``TResolvedStates, // <-- Ist `string`, wenn `states` im Contract weggelassen wurde!``  
    `...`

Und jetzt schau in packages/core/src/lib/types.ts (Zeile 466):

`export type ValidateTransitionRows<...> =`  
  `string extends TStates`  
    `? TTransitions // ❌ SHORT-CIRCUIT! Schaltet die KOMPLETTE Zeilen-Validierung ab!`  
    `: ...`

> * **Was das bedeutet:** In unserem Vorzeige-Beispiel barista.feature.ts (und in fast jedem createMachineFeature\<{ inputs; events; outputs }\>()) lassen wir states im Contract weg, damit TypeScript die States automatisch aus der Matrix inferiert\!  
> * Weil TContract\['states'\] dort undefined ist, wird TResolvedStates zu string. Und weil in ValidateTransitionRows steht string extends TStates ? TTransitions, wird für jede createMachineFeature ohne explizites states-Generic die komplette ValidateTransitionRows-Prüfung (inkl. Cycle 8 stay()-Verbot, Cycle 20 call-Signaturprüfung, Cycle 24 Pflicht-input und Output-Exhaustiveness) komplett abgeschaltet\!  
> * **Der Fix:** In ValidateTransitionRows darf string extends TStates **nur** die reine String-State-Namensprüfung überspringen, niemals aber die Prüfungen für call-Signaturen, input-Pflicht, output-Tupel und Sub-Machine-Exhaustiveness\! Noch besser: TResolvedStates in createMachineFeature inferiert die erlaubten States direkt aus ExtractStatesFromRow\<NoInfer\<TTransitions\>\[number\]\>.

### **B) Developer Experience (DX): Was macht das Entwickeln noch intuitiver?**

> 1. **Typisiertes store.actors im Angular-Template:** Aktuell ist actors auf dem Store als Signal\<Record\<string, Record\<string, unknown\> \| null\>\> typisiert (with-state-machine.ts Zeile 372).  
   * Im HTML-Template (coffee-shop-example.component.html Zeile 114\) steht deshalb store.actors()\['barista'\]?.\['error'\] mit Klammer-Notation und ohne Autocomplete\!  
   * **DX-Boost:** Typisiere actors als gemappten Typ aus ExtractAllSubMachines\<TFSM\>: { readonly \[A in ExtractAllSubMachines\<TFSM\> as A\['id'\]\]?: Readonly\<ExtractInputs\<A\> & ExtractContext\<A\>\> \| null }. Dann kann der Entwickler im Template sauber **store.actors().barista?.error** mit vollem TypeScript-Autocomplete schreiben\!  
> 2. **Kombinator-Input-Ergonomie (all(baristaFSM, bakeryFSM)):** Wenn baristaFSM { drink: CoffeeDrink } als Input braucht und bakeryFSM { pastry: string }, erlaubt die Engine in with-state-machine.ts (Zeile 933\) bereits beides: Entweder ein geschachteltes Objekt { barista: { drink }, bakery: { pastry } } oder ein flaches Objekt { drink, pastry }. In types.ts (ExtractInputs für CombinatorNode, Zeile 356\) erzwingt TypeScript aktuell UnionToIntersection (also das flache Merge { drink: CoffeeDrink; pastry: string }), während with-state-machine.spec.ts teils { barista: ..., bakery: ... } nutzt.  
   * **DX-Boost:** Erlaube im Typ ExtractCombinatorInput\<TActors\> **beide** Formen: Entweder das flache Schnittmengen-Objekt UnionToIntersection\<ExtractInputs\<TActors\[number\]\>\> **oder** das nach Actor-ID geschachtelte Objekt { \[A in TActors\[number\] as A\['id'\]\]?: ExtractInputs\<A\> }\!  
> 3. **Ausführbare Pfade in getShortestPaths():** Wenn getShortestPaths(fsm) bei always()-Schritten keinen künstlichen '\_\_always\_\_'-Schritt in das steps-Array legt (da always() beim Betreten des Vorgänger-States ohnehin von allein abläuft\!), kann ein Entwickler die zurückgegebenen steps 1:1 in einer Schleife an tester.send(step.event) verfüttern.  
> 4. **Workspace Root Cleanup:** Im Root-Verzeichnis liegt aktuell die Datei Masterplan f r Matrix-FSM Architektur-Perfektion.md (mit kaputtem Umlaut/Leerzeichen im Dateinamen). Die sollte in docs/ verschoben oder aufgeräumt werden.

### **Copy-Paste TDD-Prompt für deinen Agenten (Cycles 31–35)**

Hier ist das TDD-Protokoll (**🔴 RED → 🟢 GREEN → 🔵 REFACTOR**), um diese 5 technischen Bugs und die DX-Verbesserungen sauber abzuschließen:

`# TDD Execution Plan: Fixing the 5 Technical Bugs & DX Polish (Cycles 31–35)`

`Execute the following 5 cycles strictly using **Test-Driven Development (🔴 RED -> 🟢 GREEN -> 🔵 REFACTOR)**.`

`---`

`` ### Cycle 31: Enable Full `ValidateTransitionRows` When `states` Is Inferred in `createMachineFeature` ``  
``- **🔴 RED (`packages/angular/src/lib/with-state-machine.spec.ts`):**``  
  ``Write compile-time `@ts-expect-error` tests on `createMachineFeature<{ events: { GO: void; PAY: { amount: number } } }>()` (where `states` is NOT explicitly declared in the contract generic, i.e. inferred from the matrix):``  
  ``1. Binding a method requiring a mandatory arg `_needArg: (x: number) => void` on `'GO'` (`void` event) inside `createMachineFeature` MUST trigger a `@ts-expect-error`! (Currently it silently compiles because `TResolvedStates` defaults to `string` and `ValidateTransitionRows` short-circuits on `string extends TStates`!).``  
  ``2. Omitting mandatory `{ input: ... }` when transitioning to `baristaFSM` inside `createMachineFeature` (without explicit `states` generic) MUST trigger a `@ts-expect-error`!``  
``- **🟢 GREEN (`packages/core/src/lib/types.ts` & `packages/angular/src/lib/with-state-machine.ts`):**``  
  ``In `packages/core/src/lib/types.ts`, remove the top-level `string extends TStates ? TTransitions : ...` short-circuit in `ValidateTransitionRows`! Instead, only relax state-name checking when `string extends TStates`, while ALWAYS enforcing `ExpectedCallSignature`, `RequiresInput`, `TransitionOutputTuple`, and `ValidateSubMachineOutputs`!``

`---`

``### Cycle 32: Spawn `all()`, `race()`, and `any()` Feature Actors in `withStateMachine` (Angular Store)``  
``- **🔴 RED (`packages/angular/src/lib/with-state-machine.spec.ts`):**``  
  ``Write an Angular `TestBed` test using a real `signalStore(withStateMachine(parentFeature))` (NOT `createFeatureTester`) where `parentFeature` transitions into `all(baristaFeature, bakeryFeature)`, and both child features use their own `tasks` and `state` to compute outputs (`{ drink: 'Espresso' }` and `{ pastry: 'Croissant' }`).``  
  ``Verify that in the real Angular `signalStore`, both child feature tasks execute, `store.actors().barista` updates reactively, and `'ALL_DONE'` receives `{ barista: { drink: 'Espresso' }, bakery: { pastry: 'Croissant' } }`.``  
``- **🟢 GREEN (`packages/angular/src/lib/with-state-machine.ts`):**``  
  ``1. Update `collectSubFeatureDefs` in `with-state-machine.ts` to also unwrap `CombinatorNode` (`all`, `race`, `any`) and `SubMachineRef` (`each`).``  
  ``2. Port the combinator actor spawning, per-child teardown on `finalState()`, output buffering, and `ALL_DONE` / `DONE` / `ERROR` dispatching from `createFeatureTester` (`spawnCombinatorFeatureActors`) into `withStateMachine` so the real Angular `signalStore` and `createFeatureTester` share the exact same combinator execution semantics.``  
  ``3. Also strongly type `store.actors` as `Signal<{ readonly [A in ExtractAllSubMachines<TFSM> as A['id']]?: Readonly<ExtractInputs<A> & ExtractContext<A>> | null }>` so `store.actors().barista?.error` has full autocomplete without bracket notation.``

`---`

`` ### Cycle 33: Recursive `childSnapshots` Restoration in `restoreSnapshot()` ``  
``- **🔴 RED (`packages/core/src/lib/core.spec.ts` & `packages/angular/src/lib/with-state-machine.spec.ts`):**``  
  ``Write a test where a parent machine enters `baristaFSM` (which is in state `'ticketQueued'` or `'maintenance'`), captures `const snap = instance.getSnapshot()`, creates a fresh machine/store instance, calls `restoreSnapshot(snap)`, and then dispatches a child event (`'RETRY_BREW'` or `'START_BREWING'`) or parent interrupt (`'CANCEL'`).``  
  ``Verify that after `restoreSnapshot(snap)`, the child sub-machine (`baristaFSM`) is active again in its restored child state and responds to events (instead of being deadlocked with `activeSubRunner === null`).``  
``- **🟢 GREEN (`packages/core/src/lib/runner.ts` & `packages/angular/src/lib/with-state-machine.ts`):**``  
  ``In `restoreSnapshot(snapshot)`:``  
  ``- If `snapshot.childSnapshots` is present, find the matching sub-machine definition in `fsm.transitions`, re-instantiate `activeSubMachine` and `activeSubRunner` (and the sub-feature actor in `withStateMachine` / `createFeatureTester`), and recursively call `activeSubRunner.restoreSnapshot(childSnap)`.``

`---`

`` ### Cycle 34: Evaluate `always()` on `initial` State & Fix `getShortestPaths` for Combinators and `always()` ``  
``- **🔴 RED (`packages/core/src/lib/core.spec.ts`):**``  
  ``1. Write a test where `initial: 'checking'` has `['checking', always(), 'ready', { guard: (ctx) => ctx.ok }]` and `['checking', always(), 'fallback']`. Verify that immediately upon `createMachineInstance(fsm, { context: { ok: true } })` (with zero `send()` calls), `instance.getState()` is already `'ready'`.``  
  ``2. Write a test for `getShortestPaths(fsm)` where a machine transitions through `['step1', always(), 'step2']` and `['step2', 'START_ALL', all(subA, subB)]` -> `[all(subA, subB), 'ALL_DONE', 'completed']`. Verify that:``  
     ``- `'completed'` is included in the returned paths map!``  
     ``- The path to `'step2'` does NOT require a fake `'__always__'` event step (so replaying `path.forEach(s => instance.send(s.event))` actually reaches `'step2'`).``  
``- **🟢 GREEN (`packages/core/src/lib/runner.ts` & `packages/core/src/lib/mermaid.ts`):**``  
  ``1. At the end of `createMachineInstance` in `runner.ts`, invoke `evaluateAlwaysTransitions()` (inside the `isProcessing` guard) before scheduling `after` timers on `currentState`.``  
  ``2. In `mermaid.ts` (`resolveTargetStateName` & `getShortestPaths`):``  
     ``- Return `to.id` for `CombinatorNode` (`isCombinatorNode(to)`) instead of `null` so transitions out of `all(...)` / `race(...)` / `any(...)` are traversed by BFS.``  
     ``- Treat `always()` edges as 0-event epsilon transitions in `getShortestPaths` (inheriting the current `steps` array without pushing a fake `'__always__'` event).``

`---`

`### Cycle 35: Workspace Hygiene`  
``- Move or remove the root file `Masterplan f r Matrix-FSM Architektur-Perfektion.md` into `docs/masterplan-20261031-perfection.md` so the repository root stays clean.``

``Run `pnpm nx run-many -t test,lint,build` after all 5 cycles and ensure 100% green status.``

---

*User prompt: wenn wir cycle31 bis 35 umgesetzt haben. Welche weiteren Probleme und Verbesserungen gäbe es dann noch?*

Response: Wenn die Zyklen 31 bis 35 umgesetzt sind, ist die Kern-Engine (@matrix-fsm/core, @matrix-fsm/angular, @matrix-fsm/eslint-plugin) mathematisch, typtheoretisch und zur Laufzeit abgerichtet. Wenn man jedoch den aktuellen Quellcode von Commit 2d05b27 genau liest und die 5-Achsen-Matrix auf die verbleibenden Randbereiche anwendet, gibt es **nach Cycle 35** noch **6 echte technische Lücken** im Code sowie **3 gezielte DX-Verbesserungen**, bevor du dich voll auf @matrix-fsm/router stürzen kannst.

### **A) 6 Technische Probleme, die selbst nach Cycle 35 noch im Code schlummern**

#### **1\. each('items', childFeature) spawnt in Angular (withStateMachine & createFeatureTester) noch KEINE Feature-Akteure\!**

In Cycle 32 haben wir all(), race() und any() (CombinatorNode) in withStateMachine als vollwertige Feature-Akteure (mit eigenen tasks, methods, signalState und whenSignal) verdrahtet.

> * **Was im Code (with-state-machine.ts) noch fehlt:** Schau dir an, was passiert, wenn jemand **each('drinks', baristaFSM)** (SubMachineRef mit \_\_kind: 'each') in Spalte 3 (TO) nutzt:  
  * runner.ts (Zeilen 280–345) startet für jedes Element im Array ctx.drinks nur eine nackte Core-createMachineInstance(target.machine) – komplett **ohne** die tasks, methods und den signalState von baristaFSM\!  
  * Sobald baristaFSM innerhalb von each('drinks', baristaFSM) in awaiting('brewingCoffee') läuft, wird brewingCoffee niemals ausgeführt, weil withStateMachine und createFeatureTester bisher nur isMachineFeatureDefinition und isCombinatorNode, aber **nicht** isSubMachineRef (each) mit eigenen Feature-Task-Runnern versorgen\!  
  * Außerdem übergibt runner.ts in Zeile 314 bei ALL\_DONE von each() noch kein geordnetes Ergebnis-Array ItemOutput\[\] (analog zu Promise.all(items.map(...))), sondern undefined.

#### **2\. each()-Ausgangstypisierung in ResolveRowPayload (types.ts) fehlt noch**

In packages/core/src/lib/types.ts (Zeilen 408–444) löst ResolveSingleViaPayload zwar CombinatorNode\<'all', ...\> (als { \[id\]: Output }) und CombinatorNode\<'race' \| 'any', ...\> auf, hat aber **keinen Zweig für SubMachineRef\<TSub, TKey\> (each)**\!

> * **Folge:** In einer Zeile \[each('drinks', baristaFSM), 'ALL\_DONE', 'orderReady', { call: (m) \=\> m.\_saveAllDrinks }\] wird RowPayload aktuell als void statt als Array\<ExtractSingleActorOutput\<typeof baristaFSM\>\> aufgelöst\! Wegen unserer strengen ExpectedCallSignature aus Cycle 20 verbietet TypeScript dann sogar, dass \_saveAllDrinks(results: BrewResult\[\]) das Ergebnis-Array entgegennimmt\!

#### **3\. Massiver Code-Duplikations-Drift zwischen withStateMachine und createFeatureTester (\~350 Zeilen doppelt\!)**

In packages/angular/src/lib/with-state-machine.ts (ab Zeile 480 vs. ab Zeile 850\) ist die komplette Sub-Actor-, Task-, Effect-Fiber-, whenSignal- und Kombinator-Orchestrierung **zweimal fast identisch** programmiert: einmal in withStateMachine und einmal in createFeatureTester.

> * **Warum das gefährlich ist:** Genau dadurch ist überhaupt erst der Bug aus Cycle 32 entstanden (dass spawnCombinatorFeatureActors zwar in createFeatureTester stand, aber in withStateMachine vergessen wurde)\!  
> * **Die saubere Lösung:** Extrahiere die gemeinsame Actor- & Task-Runtime in eine einzige interne Engine-Funktion createAngularActorRuntime(...) innerhalb von with-state-machine.ts, die sowohl vom NgRx signalStore (withStateMachine) als auch von createFeatureTester genutzt wird. Dann ist es mathematisch unmöglich, dass sich Test-Harness und Production-Store jemals unterschiedlich verhalten\!

#### **4\. packages/angular/src/effect/index.ts ist ein verwaister Dummy-Stub (runEffectTask)**

Schau dir packages/angular/src/effect/index.ts an:

> * Dort liegt eine 18-zeilige Funktion runEffectTask, die überhaupt nicht mit createMachineFeature oder withStateMachine verbunden ist, während die echte Effect-Integration (isEffect, Effect.runFork, Fiber.interruptFork) direkt in packages/angular/src/lib/with-state-machine.ts (Zeilen 385–440) eingebaut ist\!  
> * Noch schlimmer: In packages/angular/package.json ist der Sub-Entrypoint @matrix-fsm/angular/effect gar nicht in "exports" eingetragen.  
> * **Die Lösung:** Entweder @matrix-fsm/angular/effect sauber in packages/angular/package.json exportieren (mit typisierten Helpern für Effect-basierte tasks) oder den ungenutzten Stub bereinigen, damit keine toten Dateien im Paket liegen.

#### **5\. tools/generate-mermaid.mjs nutzt fragiles Regex-Parsing statt unser echtes toMermaid() aus @matrix-fsm/core**

Schau dir tools/generate-mermaid.mjs an:

> * Das Skript versucht immer noch, \*.machine.ts-Dateien mit regulären Ausdrücken (/\\\[\\s\*(\['"\]\[\\w-\]+\['"\]\|...)/g) auszulesen, ignoriert dabei alle \*.feature.ts-Dateien (wie barista.feature.ts\!) und kennt weder all(), race(), anyState() noch always()\!  
> * Dabei haben wir in packages/core/src/lib/mermaid.ts (toMermaid) bereits den kompletten, getesteten Mermaid-Generator\!

#### **6\. ESLint-Plugin: align-matrix-columns hat keinen Auto-Fixer (meta.fixable: 'whitespace')**

Schau dir packages/eslint-plugin/src/lib/rules/align-matrix-columns.ts an:

> * Die Regel prüft zwar, ob alle 4 Spalten (FROM, VIA, TO, OPTIONS) exakt untereinander ausgerichtet sind, hat aber **keinen fix(fixer)-Support**\!  
> * **Warum das im Alltag wehtut:** Da über jedem transitions-Block // prettier-ignore steht (damit Prettier die Tabelle nicht umbricht), muss ein Entwickler (oder KI-Agent) aktuell mit der Leertaste manuell Leerzeichen zählen, wenn ein State-Name länger wird\!  
> * Wenn align-matrix-columns meta: { fixable: 'whitespace' } implementiert und die Spaltenbreiten beim Speichern (eslint \--fix) automatisch mit Spaces auffüllt, wird das Schreiben einer Matrix zum absoluten Genuss\!

### **B) 3 DX-Verbesserungen (Maximale Freude bei minimaler API)**

> 1. **store.can('PAY') (oder canSend('PAY', payload?)) für Disabled-Buttons im Angular-Template:**  
   * **Der Alltagsschmerz:** Im Angular-HTML-Template will man fast immer einen Button ausgrauen, wenn der Übergang im aktuellen Zustand (oder wegen eines guards) gerade nicht möglich ist: \<button \[disabled\]="\!store.can('PAY')"\>Pay\</button\>.  
   * **Aktuell:** Der Entwickler muss im Template manuell store.fsmState() \!== 'awaitingPayment' \|\| \!isEnoughMoney() nachbauen – er dupliziert also das Wissen, das bereits in der Matrix in Spalte 1 (FROM) und Spalte 4 (guard) steht\!  
   * **Die Lösung:** Eine winzige, reine Lese-Methode runner.can(event, payload?): boolean (und store.can(event, payload?): boolean), die Phase 1 unseres Runners trocken prüft (Existiert für den aktuellen State eine Zeile mit VIA \=== event, deren guard(getContext(), payload) true liefert?), **ohne** den State zu verändern\!  
> 2. **Playground auf 100 % modernen Stand bringen (auth \+ coffee-shop):**  
   * Im Playground nutzt apps/playground/src/app/features/auth/ noch die alte Aufteilung (auth.machine.ts \+ auth.store.ts ohne createMachineFeature), und coffee-shop.machine.ts heißt noch .machine.ts statt coffee-shop.feature.ts.  
   * Wenn wir beide Playground-Features als glasklare Referenzen für das neue Sandwich-Pattern (auth.feature.ts und coffee-shop.feature.ts) inkl. store.can(...) im Template gestalten, dient der Playground als Vorlage für jedes echte Projekt.  
> 3. **ESLint Flat-Config Preset (matrixFsm.configs.recommended):**  
   * In packages/eslint-plugin/src/index.ts sind zwar alle 12 Regeln im Objekt rules exportiert, aber in apps/playground/eslint.config.mjs sind nur 7 der 12 Regeln manuell eingeschaltet (die 5 neuen Regeln wie no-unreachable-states, require-exit-for-targets, no-shadowed-transitions, no-conflicting-final-output und no-duplicate-combinator-actors fehlen noch in apps/playground/eslint.config.mjs\!).  
   * Exportiere in packages/eslint-plugin/src/index.ts ein fertiges recommendedRules-Objekt, das in apps/playground/eslint.config.mjs mit einer einzigen Zeile eingebunden wird, damit der eigene Playground alle 12 Regeln scharf testet\!

### **Copy-Paste TDD-Prompt für deinen Agenten (Cycles 36–40: Der finale Schliff vor dem Router)**

Hier ist das TDD-Protokoll (**🔴 RED → 🟢 GREEN → 🔵 REFACTOR**), falls du diese Punkte nach Cycle 35 noch direkt nachziehen willst:

`# TDD Execution Plan: Final Polish & Zero-Friction DX (Cycles 36–40)`

`Execute the following 5 cycles strictly using **Test-Driven Development (🔴 RED -> 🟢 GREEN -> 🔵 REFACTOR)**.`

`---`

``### Cycle 36: Complete `each(arrayKey, childFeature)` Support (Output Array Aggregation, Types & Angular Spawning)``  
``- **🔴 RED (`packages/core/src/lib/core.spec.ts` & `packages/angular/src/lib/with-state-machine.spec.ts`):**``  
  ``1. Write a test where `each('drinks', baristaFSM)` runs in both `withStateMachine` (Angular Store) and `createFeatureTester` for a 2-item array `drinks: [espresso, latte]`, executing `baristaFSM.tasks` for each item in parallel and passing the ordered array `[{ drinkName: 'Espresso', ... }, { drinkName: 'Latte', ... }]` as the strongly typed payload of `'ALL_DONE'` to the `call` method in `[each('drinks', baristaFSM), 'ALL_DONE', 'orderReady', { call: (m) => m._saveAll }]`.``  
``- **🟢 GREEN (`runner.ts`, `types.ts`, `with-state-machine.ts`):**``  
  ``1. In `packages/core/src/lib/types.ts` (`ResolveSingleViaPayload`), add a branch for `SubMachineRef<infer TSub, any>`: when `TVia extends 'ALL_DONE'`, resolve the payload type to `ReadonlyArray<ExtractSingleActorOutput<TSub>>`.``  
  ``2. In `packages/core/src/lib/runner.ts` and `packages/angular/src/lib/with-state-machine.ts`, collect each item's terminal output payload into an ordered array `results[index] = outputPayload` and pass `results` when dispatching `'ALL_DONE'`. Ensure each item spawns a full feature actor in `withStateMachine` and `createFeatureTester`.``

`---`

``### Cycle 37: Dry-Run Transition & Guard Query (`instance.can(event, payload?)` & `store.can(event, payload?)`)``  
``- **🔴 RED (`packages/core/src/lib/core.spec.ts` & `packages/angular/src/lib/with-state-machine.spec.ts`):**``  
  ``Write a test verifying that `instance.can('PAY')` / `store.can('PAY')`:``  
  ``- Returns `false` when the current state has no matching row for `'PAY'`.``  
  ``- Returns `false` when a matching row exists, but its `guard(ctx, payload)` returns `false`.``  
  ``- Returns `true` when a matching row (on the active sub-actor, current state, or `anyState()`) matches and its guard passes, WITHOUT mutating state or triggering side effects.``  
``- **🟢 GREEN (`runner.ts`, `types.ts`, `with-state-machine.ts`):**``  
  ``Expose `can<K extends keyof TEvents>(event: K, ...args: TEvents[K] extends void ? [] : [payload: TEvents[K]]): boolean` on `FSMRunner`, `withStateMachine`, and `createFeatureTester`.``

`---`

``### Cycle 38: Auto-Fixer (`eslint --fix`) for `align-matrix-columns` & Full 12-Rule Preset in Playground``  
``- **🔴 RED (`packages/eslint-plugin/src/lib/eslint-plugin.spec.ts`):**``  
  ``Add `output:` expectations to the invalid test cases of `align-matrix-columns` in `eslint-plugin.spec.ts` verifying that ESLint automatically pads columns 1, 2, 3, and 4 to align vertically while preserving `/* FROM VIA TO OPTIONS */` header comments.``  
``- **🟢 GREEN (`packages/eslint-plugin/src/lib/rules/align-matrix-columns.ts` & `apps/playground/eslint.config.mjs`):**``  
  ``1. Add `meta: { fixable: 'whitespace' }` and implement `fix(fixer)` in `align-matrix-columns.ts` to auto-pad each column in a contiguous transition block to the max column width + 2 spaces.``  
  ``2. Export `recommendedRules` in `packages/eslint-plugin/src/index.ts` containing all 12 rules, and enable all 12 rules in `apps/playground/eslint.config.mjs`.``

`---`

`` ### Cycle 39: Deduplicate Actor Runtime Between `withStateMachine` and `createFeatureTester` ``  
``- **🔵 REFACTOR (`packages/angular/src/lib/with-state-machine.ts`):**``  
  ``Extract the shared sub-feature actor spawning, combinator orchestration, `whenSignal` wiring, and `awaiting` task execution into a single internal helper so `withStateMachine` and `createFeatureTester` share one implementation with zero behavior drift.``

`---`

`` ### Cycle 40: Modernize `tools/generate-mermaid.mjs` to Scan `*.feature.ts` ``  
``- Update `tools/generate-mermaid.mjs` so it scans both `*.machine.ts` and `*.feature.ts` files and supports `anyState()`, `after()`, `always()`, `all()`, `race()`, and `any()`.``

``Run `pnpm nx run-many -t test,lint,build` at the end and verify all tests, lints (with all 12 rules active on Playground!), and builds pass.``

---

*User prompt: wenn wir cycle 31 bis 40 umgesetzt haben was wäre DANN noch zu tun? Verbesserungen von DX und vorallen Dingen mathematische lücken und fehler?*

Response: Selbst wenn die Zyklen 31 bis 40 vollständig umgesetzt sind, offenbart ein tiefer Blick in die aktuellen Implementierungen von packages/core/src/lib/runner.ts, packages/core/src/lib/types.ts, packages/angular/src/lib/with-state-machine.ts und packages/eslint-plugin/ noch **6 fundamentale mathematische und laufzeittechnische Lücken** (echte Bugs im Code) sowie **3 wichtige DX-Verbesserungen**.

Hier ist die exakte Analyse dessen, was im aktuellen Code nach Cycle 40 noch brechen würde:

### **A) 6 Mathematische & Technische Fehler im Code (Stand 2d05b27)**

#### **1\. Mathematischer Bug in evaluateAlwaysTransitions (runner.ts Zeilen 188–228): always() feuert KEINE outputs und löst KEIN finalState() in Sub-Akteuren aus\!**

Schau dir evaluateAlwaysTransitions in packages/core/src/lib/runner.ts (Zeilen 188–228) genau an:

> * Wenn eine normale Transition in send() matcht (Zeile 625), prüft der Runner:  
  1. Hat die Zeile ein options.output? → emitIntermediateOutput(...).  
  2. Ist das Ziel isFinalNode(target)? → onFinalReached(outcomeEvent, outcomePayload) (beendet den Sub-Actor und benachrichtigt den Parent\!).  
> * In evaluateAlwaysTransitions() (Zeilen 194–223) hat der Agent stattdessen eine **eigene Mini-Schleife** programmiert, die nur enterTarget(result.target, undefined, result.resolvedInput) aufruft\!  
> * **Die fatale Folge:**  
  1. Wenn eine always()-Transition in Spalte 4 { output: \['SKIPPED\_PAYMENT', (ctx) \=\> ...\] } definiert, wird dieser Output **komplett verschluckt** (result.resolvedOutput wird in Zeile 201 einfach ignoriert\!).  
  2. Wenn ein Sub-Actor (baristaFSM) über eine always()-Weiche direkt in finalState() springt (z. B. \['checkingStock', always(), finalState('OUT\_OF\_STOCK'), { guard: isEmpty }\]), ruft enterTarget bei einem FinalNode überhaupt nichts auf und onFinalReached wird **niemals ausgelöst**\! Der Sub-Actor bleibt als Zombie stecken und die Eltern-Maschine erfährt nie, dass der Sub-Actor fertig ist\!

#### **2\. Mathematisches Loch in ValidateSubMachineOutputs (types.ts Zeilen 579–600): any() und race() ignorieren unbehandelte Fehler-/Spezial-Outputs\!**

Schau dir ExtractAllSubMachinesFromRows in packages/core/src/lib/types.ts (Zeilen 580–588) an:

> * Dort werden nur einzelne FSMDefinition-Ziele (To extends FSMDefinition) extrahiert, aber **keine CombinatorNodes (all, race, any)**\!  
> * Noch kritischer: In runner.ts (Zeile 378\) steht bei CombinatorNode:  
  * Erreicht ein Kind in race(nfcFSM, qrFSM) seinen finalState('PAID\_NFC'), sendet der Runner zuerst send('PAID\_NFC', payload) und nur als Fallback send('DONE', payload).  
  * Scheitern in any(btPrinterFSM, wifiPrinterFSM) **alle** Kinder, sendet der Runner automatisch send('ERROR', combinatorErrors) an den Parent (Zeile 409)\!  
> * **Die mathematische Lücke:** Weder TypeScript (ValidateTransitionRows) noch ESLint (require-awaiting-handlers / require-exit-for-targets) zwingen den Entwickler aktuell dazu, bei \[any(a, b), ...\] einen 'ERROR'-Handler zu definieren\! Wenn in der Praxis sowohl Bluetooth als auch WLAN fehlschlagen, feuert any() das Event 'ERROR', der Parent ignoriert es, und die App hängt in einem **permanenten Deadlock** in '\_\_any\_\_:bt,wifi'\!

#### **3\. Bug bei after(ms) auf Sub-Akteuren und Kombinatoren (runner.ts Zeilen 148–178): Globale Timeouts auf \[baristaFSM, after(10000), 'timeout'\] funktionieren nicht\!**

Stell dir das natürlichste Timeout-Muster der Welt in einer Eltern-Matrix vor:

`/* FROM          VIA             TO          OPTIONS */`  
`['paying',       'PAY',          baristaFSM, { input: ... }],`  
`[baristaFSM,     'COFFEE_READY', 'ready'],`  
`[baristaFSM,     after(10000),   'timeout'], // <-- Wenn der Barista länger als 10s braucht: Abbruch!`

Schau dir jetzt an, wie scheduleAfterTimers(state) in packages/core/src/lib/runner.ts (Zeilen 148–178) implementiert ist:

`function scheduleAfterTimers(state: string): void {`  
  `for (const row of fsm.transitions) {`  
    `const [from, via] = row;`  
    `if (!isAfterNode(via)) continue;`  
    `const matchesFrom =`  
      ``from === state || (Array.isArray(from) && from.includes(state)); // ❌ Vergleicht Objekt `baristaFSM` mit String `'ticketQueued'`!``

> 1. Wenn baristaFSM betreten wird, ist currentState der Kind-State 'ticketQueued' (ein String), aber from in der Eltern-Zeile \[baristaFSM, after(10000), 'timeout'\] ist das **Objekt baristaFSM** (isFSMDefinition(from))\! from \=== state ist false – der 10-Sekunden-Timeout-Timer für baristaFSM wird **niemals gestartet**\!  
> 2. Selbst wenn er gestartet würde: Sobald baristaFSM intern von 'ticketQueued' nach 'brewingCoffee' wechselt, würde ein naiver State-Exit den Eltern-Timer sofort wieder löschen, obwohl baristaFSM noch gar nicht verlassen wurde\!  
> 3. Und in evaluateRowList (Zeile 539\) prüft der Parent bei activeSubMachine nur via \=== event, aber bei AfterNode ist via ein Objekt { \_\_kind: 'after', id: '\_\_after\_10000\_\_' }, sodass via \=== event in Zeile 475 nur klappt, weil dort isAfterNode(via) steht – aber scheduleAfterTimers prüft niemals from \=== activeSubMachine oder from \=== activeCombinator\!

#### **4\. ESLint-Graph-Blindheit bei Arrays in Spalte 1 (\['stateA', 'stateB'\]): Falscher Alarm in 3 Linter-Regeln\!**

In @matrix-fsm/core erlaubt Spalte 1 (FROM) ausdrücklich **State-Arrays** wie \[\['idle', 'error'\], 'RETRY', awaiting('loading')\]. Jetzt schau dir packages/eslint-plugin/src/lib/ast-utils.ts (Zeilen 79–96, getFromIdentifier) an:

`export function getFromIdentifier(node: TSESTree.Node): string | null {`  
  `if (node.type === AST_NODE_TYPES.ArrayExpression) {`  
    `const parts = node.elements.map((el) => (el ? getFromIdentifier(el) : '?'));`  
    ``return `[${parts.join(',')}]`; // Gibt den einzelnen String "[idle,error]" zurück!``  
  `}`

Und jetzt schau, was deine Graph-Regeln mit diesem Rückgabewert "\[idle,error\]" machen:

> 1. **no-unreachable-states.ts (Zeile 66):** Prüft \!reachableStates.has("\[idle,error\]")\! Da in Spalte 3 (TO) natürlich 'idle' und 'error' einzeln stehen (und niemals \['idle', 'error'\]), meldet no-unreachable-states für **jede Matrix, die ein Array in Spalte 1 nutzt**, fälschlicherweise einen Fehler (State '\[idle,error\]' in FROM is unreachable)\!  
> 2. **require-exit-for-targets.ts (Zeile 75):** Wenn man zwei States in einem Array verlässt (\[\[baristaFSM, bakeryFSM\], 'CANCEL', 'idle'\]), speichert fromWithValidExit nur den String "\[baristaFSM,bakeryFSM\]" und erkennt nicht, dass baristaFSM und bakeryFSM damit einen Ausgang haben\!  
> 3. **no-shadowed-transitions.ts (Zeile 46):** Wenn Zeile 1 \['idle', 'CANCEL', 'a'\] (unguarded) ist und Zeile 2 \[\['idle', 'other'\], 'CANCEL', 'b'\], erkennt die Regel die Überschattung von 'idle' nicht (und umgekehrt: \[\['idle', 'other'\], 'CANCEL', 'a'\] überschattet ein späteres \['idle', 'CANCEL', 'b'\], wird aber wegen fromKey \= "\[idle,other\]" übersehen)\!

#### **5\. anyState() in getShortestPaths & toMermaid (mermaid.ts): Endlos-Kanten und fehlende globale Übergänge**

Schau dir packages/core/src/lib/mermaid.ts (Zeilen 89 & 164\) an:

> 1. In toMermaid(fsm) (Zeile 89\) gibt resolveFromNames(anyState()) einfach \['\*'\] zurück. Im generierten Mermaid-Code entsteht dadurch \* \--\> idle : CANCEL. In Mermaid stateDiagram-v2 ist \* (ohne \[\*\]) jedoch ein Syntaxfehler bzw. erzeugt einen Buchstaben-Knoten namens \*\! In Mermaid sollte ein anyState()-Übergang sauber als note oder als anyState mit Label dargestellt werden.  
> 2. In getShortestPaths(fsm) (Zeile 164\) gibt resolveFromNames(anyState()) \['\*'\] zurück. Da der BFS-Algorithmus bei fsm.initial (z. B. 'idle') startet und in adjacency.get('idle') nachschaut, werden Kanten unter adjacency.get('\*') (anyState()) vom Breitensuch-Algorithmus **niemals besucht**\! Wenn ein Zustand (wie 'emergencyStop') nur über \[anyState(), 'PANIC', 'emergencyStop'\] erreichbar ist, behauptet getShortestPaths fälschlicherweise, 'emergencyStop' sei unerreichbar\!

#### **6\. TypeScript-Inferenz-Bruch bei createMachineFeature: ExtractTerminalOutputs funktioniert nicht, wenn transitions nicht als const im Typ erhalten bleibt**

In packages/angular/src/lib/with-state-machine.ts (Zeile 213\) ist createMachineFeature deklariert als:

`export function createMachineFeature<TContract extends MachineFeatureContract = ...>() {`  
  `return function <`  
    `const TTransitions extends readonly TransitionRow<...>[],`  
    `...`  
  `>(config: ...): MachineFeatureDefinition<..., TTransitions>`

Aber in MachineFeatureDefinition (Zeile 168\) wird die Basisklasse erweitert mit:

`export interface MachineFeatureDefinition<`  
  `...,`  
  `TTransitions extends readonly any[] = readonly any[],`  
`> extends FSMDefinition<TStates, TEvents, TInputs & TState, TMethods, TTransitions, TInputs, TOutputs>`

Und in packages/core/src/lib/types.ts (Zeile 347\) prüft ExtractOutputs\<T\>:

`export type ExtractOutputs<T> =`  
  `T extends FSMDefinition<any, any, any, any, any, any, infer O>`  
    `? [keyof O] extends [never]`  
      `? Record<string, never>`  
      `: O`  
    `: Record<string, never>;`

Was passiert aber in ResolveSingleViaPayload (Zeile 421), wenn baristaFSM (mit outputs: { COFFEE\_READY: { drink: string } }) in all(baristaFSM, bakeryFSM) gesteckt wird? Schau dir ExtractSingleActorOutput\<TActor\> in types.ts (Zeilen 392–398) an:

`export type ExtractSingleActorOutput<TActor> =`  
  `[keyof ExtractOutputs<TActor>] extends [never]`  
    `? unknown`  
    `: ExtractOutputs<TActor>[keyof ExtractOutputs<TActor>];`

Wenn baristaFSM **einen** Terminal-Output (COFFEE\_READY: { result: BrewResult }) und **einen** Intermediate-Output (PROGRESS: { percent: number }) hat, bildet ExtractSingleActorOutput\<typeof baristaFSM\> die Union { result: BrewResult } \| { percent: number }, obwohl bei 'ALL\_DONE' von all(baristaFSM, bakeryFSM) mathematisch **nur ein Terminal-Output** (ExtractTerminalOutputs\<typeof baristaFSM\>) als Endergebnis herauskommen kann\!

> * **Der Fix:** ExtractSingleActorOutput\<TActor\> muss über ExtractOutputs\<TActor\>\[Extract\<ExtractTerminalOutputs\<TActor\>, keyof ExtractOutputs\<TActor\>\>\] filtern, damit Zwischen-Outputs (stay()) niemals den finalen Ergebnistyp von all(), race(), any() und each() verschmutzen\!

### **B) 3 DX-Verbesserungen nach Cycle 40 (Das „Kirsche-auf-der-Torte“-Level)**

> 1. **Reaktives Signal store.canSend (oder store.can('PAY') als Signal-lesende Funktion im Template):** In Cycle 37 fügen wir store.can('PAY') hinzu. Damit Angulars Change Detection (insbesondere in **Zoneless Angular v19/v20**\!) automatisch einen \<button \[disabled\]="\!store.can('PAY')"\> neu rendert, sobald sich fsmState oder ein Feld im Store-Context (für einen guard) ändert, muss store.can('PAY') intern **store.fsmState()** (das Signal\!) und die **Context-Signals** des Stores lesen (statt nur das nicht-reaktive runner.getState()). Liest store.can(...) intern die Signals, wird jeder Aufruf in einem Angular-Template oder computed(() \=\> store.can('PAY')) **automatisch zu 100 % reaktiv in Zoneless Angular**\!  
> 2. **Typisiertes store.send mit Autocomplete für optionale vs. Pflicht-Payloads:** Aktuell ist send auf dem Store in with-state-machine.ts (Zeile 362\) so typisiert:  
>    `send: <K extends keyof ExtractEvents<TFSM>>(`  
>      `event: K,`  
>      `...args: ExtractEvents<TFSM>[K] extends void ? [] : [payload: ExtractEvents<TFSM>[K]]`  
>    `) => void;`

>    Was ist, wenn ein Event einen **optionalen** Payload hat, z. B. RETRY: { force?: boolean } \| void? Bei ExtractEvents\<TFSM\>\[K\] extends void ist { force?: boolean } \| void **nicht** extends void\! Der Entwickler wird gezwungen, store.send('RETRY', undefined) zu schreiben\!  
   * **Der Fix:** Nutze void extends ExtractEvents\<TFSM\>\[K\] ? \[payload?: ExtractEvents\<TFSM\>\[K\]\] : \[payload: ExtractEvents\<TFSM\>\[K\]\]. Dann kann man store.send('RETRY') ohne zweites Argument UND store.send('RETRY', { force: true }) mit Argument aufrufen\!  
> 3. **Automatische Pfad-Ausführung in createFeatureTester (tester.assertAllStatesReachable()):** Wir haben getShortestPaths(fsm) gebaut. Wenn createFeatureTester eine Methode tester.getShortestPaths() (oder assertPaths()) direkt mitbringt, kann ein Entwickler mit einer einzigen Zeile testen, ob jeder Zustand seiner Maschine vom Startzustand aus erreichbar ist.

### **Copy-Paste TDD-Prompt für deinen Agenten (Cycles 41–46)**

Hier ist das TDD-Protokoll (**🔴 RED → 🟢 GREEN → 🔵 REFACTOR**), das du direkt im Anschluss an Cycle 40 an deinen Agenten geben kannst, um diese 6 mathematischen Bugs und 3 DX-Punkte zu lösen:

`# TDD Execution Plan: Closing the Final 6 Mathematical Gaps & Zoneless DX (Cycles 41–46)`

`Execute the following 6 cycles strictly using **Test-Driven Development (🔴 RED -> 🟢 GREEN -> 🔵 REFACTOR)**.`

`---`

``### Cycle 41: `always()` Transitions Must Support `output` and `finalState()` in Sub-Actors``  
``- **🔴 RED (`packages/core/src/lib/core.spec.ts`):**``  
  ``1. Write a test where a sub-actor (`subFSM`) has an eventless branch into `finalState()`:``  
     `` `['checking', always(), finalState(), { guard: (ctx) => ctx.instant, output: ['INSTANT_DONE', (ctx) => ({ val: ctx.val })] }]`. ``  
     ``Verify that when `subFSM` enters `'checking'` with `instant: true`, it immediately terminates and dispatches `'INSTANT_DONE'` with `{ val }` to the parent machine! (Currently `evaluateAlwaysTransitions` in `runner.ts` ignores `resolvedOutput` and never calls `onFinalReached`!).``  
  ``2. Write a test where an `always()` transition on a non-final transition has `{ output: ['BRANCH_TAKEN', () => ({ ok: true })] }` and verify `onOutput` is called.``  
``- **🟢 GREEN (`packages/core/src/lib/runner.ts`):**``  
  ``In `evaluateAlwaysTransitions()`:``  
  ``- If `result.resolvedOutput && !isFinalNode(result.target)`, invoke `emitIntermediateOutput(result.resolvedOutput.name, result.resolvedOutput.payload)`.``  
  ``- If `isFinalNode(result.target)`, resolve the final outcome name and payload and invoke `onFinalReached(outcomeEvent, outcomePayload)` (and return immediately), matching the exact semantics of `send()`.``

`---`

``### Cycle 42: `after(ms)` Timers on Sub-Actors & Combinators (`[baristaFSM, after(5000), 'timeout']`)``  
``- **🔴 RED (`packages/core/src/lib/core.spec.ts`):**``  
  ``Write a test where a parent machine transitions into `baristaFSM` (which starts in `'ticketQueued'` and transitions internally to `'brewingCoffee'`), and the parent defines a sub-actor timeout row:``  
  `` `[baristaFSM, after(5000), 'timeout']`. ``  
  `Verify that:`  
  ``1. Even if `baristaFSM` transitions internally from `'ticketQueued'` to `'brewingCoffee'` at `t = 1000ms`, the parent's 5000ms timeout timer keeps running and transitions the parent to `'timeout'` (aborting `baristaFSM`) at `t = 5000ms`!``  
  ``2. If `baristaFSM` completes normally at `t = 3000ms` (`'COFFEE_READY'`), the parent's 5000ms timeout timer is cleared and never fires at `t = 5000ms`.``  
``- **🟢 GREEN (`packages/core/src/lib/runner.ts`):**``  
  ``Maintain separate timer lists for active sub-actors/combinators (`subSourceAfterTimers`):``  
  ``- When entering a `subMachine` or `CombinatorNode` (`activeSubMachine` or `activeCombinator`), scan the parent's `fsm.transitions` for rows where `from` matches that `subMachine` / `CombinatorNode` and `isAfterNode(via)`.``  
  ``- Start those parent-level timers when the sub-actor/combinator is entered, and only clear them when the parent actually exits that `subMachine` / `CombinatorNode` (NOT on internal child state changes!).``

`---`

`` ### Cycle 43: ESLint Graph Rules — Unwrap Array `FROM` (`[['a', 'b'], ...]`) in `no-unreachable-states`, `require-exit-for-targets`, and `no-shadowed-transitions` ``  
``- **🔴 RED (`packages/eslint-plugin/src/lib/eslint-plugin.spec.ts`):**``  
  ``1. `no-unreachable-states`: Add a test with `['idle', 'GO', 'step1']`, `['step1', 'FAIL', 'error']`, and `[['step1', 'error'], 'RESET', 'idle']`. Currently `no-unreachable-states` falsely reports `State '[step1,error]' in FROM is unreachable`!``  
  ``2. `require-exit-for-targets`: Add a test where two transient targets exit via a shared array row `[[subA, subB], 'CANCEL', 'idle']` and verify it counts as an exit for both `subA` and `subB`.``  
  ``3. `no-shadowed-transitions`: Add a test where an unguarded `[['idle', 'active'], 'RESET', 'idle']` precedes `['active', 'RESET', 'special', { guard: isSpecial }]` and verify `no-shadowed-transitions` flags the shadowed `'active'` row!``  
``- **🟢 GREEN (`packages/eslint-plugin/src/lib/`):**``  
  ``Add a helper `getFromIdentifiers(node: TSESTree.Node): string[]` in `ast-utils.ts` that flattens `ArrayExpression` in Column 1 into its individual state/actor identifiers, and use it in `no-unreachable-states.ts`, `require-exit-for-targets.ts`, and `no-shadowed-transitions.ts`.``

`---`

`` ### Cycle 44: Filter `ExtractSingleActorOutput` to Terminal Outputs Only & Enforce `ERROR` Handler on `any()` ``  
``- **🔴 RED (`packages/core/src/lib/core.spec.ts`):**``  
  ``1. Create a sub-actor with both an intermediate output (`PROGRESS: { percent: number }` on `stay()`) and a terminal output (`COFFEE_READY: { cup: string }` on `finalState()`). Use it inside `all(subA, subB)` and verify that in `[all(subA, subB), 'ALL_DONE', 'done', { call: (m) => m._onAllDone }]`, the inferred payload type for `subA` is strictly `{ cup: string }` (NOT polluted with `{ percent: number }`!).``  
  ``2. Verify in `require-awaiting-handlers` (or `require-exit-for-targets`) that using `any(subA, subB)` in Column 3 (`TO`) requires handling both `'DONE'` and `'ERROR'` (or `anyState()` `'ERROR'`).``  
``- **🟢 GREEN (`packages/core/src/lib/types.ts` & `packages/eslint-plugin`):**``  
  ``Update `ExtractSingleActorOutput<TActor>` to intersect `keyof ExtractOutputs<TActor>` with `ExtractTerminalOutputs<TActor>` so intermediate `stay()` outputs are excluded from `ALL_DONE` / `DONE` combinator payloads.``

`---`

`` ### Cycle 45: `anyState()` Support in `getShortestPaths` & Valid Mermaid `stateDiagram-v2` Syntax in `toMermaid` ``  
``- **🔴 RED (`packages/core/src/lib/core.spec.ts`):**``  
  ``1. Write a test where state `'emergency'` is only reachable via `[anyState(), 'PANIC', 'emergency']`. Verify `getShortestPaths(fsm)` includes `'emergency'` with path `[{ event: 'PANIC' }]` from `initial`!``  
  ``2. Verify `toMermaid(fsm)` renders `anyState()` rows using a valid Mermaid identifier `anyState` (with `state "anyState()" as anyState`) instead of invalid raw `* --> ...` syntax.``  
``- **🟢 GREEN (`packages/core/src/lib/mermaid.ts`):**``  
  ``1. In `getShortestPaths`, append `anyState()` edges (`adjacency.get('*')`) as fallback outgoing edges from every visited state during BFS.``  
  ``2. In `toMermaid`, map `anyState()` to a valid Mermaid node `anyState` with label `state "anyState()" as anyState`.``

`---`

`` ### Cycle 46: Reactive Zoneless `store.can()` & Optional Union Payload Ergonomics in `store.send()` ``  
``- **🔴 RED (`packages/angular/src/lib/with-state-machine.spec.ts`):**``  
  ``1. Write a test with `computed(() => store.can('PAY'))` where `'PAY'` is guarded by `guard: (ctx) => ctx.balance >= 10`. Verify that when `patchState(store, { balance: 15 })` is called (without changing `fsmState`), the `computed(() => store.can('PAY'))` signal automatically recomputes from `false` to `true`!``  
  ``2. Write a compile-time test where an event is typed as `OPTIONAL_EV: { note?: string } | void` and verify both `store.send('OPTIONAL_EV')` (0 args) and `store.send('OPTIONAL_EV', { note: 'hi' })` (1 arg) compile cleanly!``  
``- **🟢 GREEN (`packages/angular/src/lib/with-state-machine.ts` & `packages/core/src/lib/types.ts`):**``  
  ``1. In `withStateMachine`'s `can()` method, read `store.fsmState()` (and touch the reactive store signals via `getState(store)` / signal reads) before delegating to `runner.can()`, so `store.can(...)` tracks dependencies in Angular `computed()` and Zoneless templates.``  
  ``2. Update the rest-parameter type of `send` and `can` from `TEvents[K] extends void ? [] : [payload: TEvents[K]]` to `void extends TEvents[K] ? [payload?: TEvents[K]] : [payload: TEvents[K]]`.``

``Run `pnpm nx run-many -t test,lint,build` after completing Cycles 41–46 and ensure 100% green status.``

---

*User prompt: und wenn das erledigt wäre was wäre dann noch zu tun. Also nach cycle46?*

Response: Wenn auch die Zyklen 41 bis 46 erledigt sind, ist die Base-Library (@matrix-fsm/core, @matrix-fsm/angular, @matrix-fsm/eslint-plugin) an einem Punkt angekommen, an dem wir bei den bestehenden Primitiven (awaiting, stay, finalState, anyState, after, always, all, race, any, each, whenSignal, syncContext) **keine nennenswerten mathematischen Lücken mehr offen haben**.

Um auch die allerletzten 1 % an Randfällen im aktuellen Code von 2d05b27 aufzuspüren, habe ich den gesamten Code noch einmal mit einem Mikroskop auf **Cross-Feature-Interaktionen** (Was passiert, wenn Feature X *gleichzeitig* mit Feature Y genutzt wird?) und **Edge-Cases im Produktionsbetrieb** untersucht.

Nach Cycle 46 gibt es genau **4 verbleibende technische Edge-Cases im Core/Angular/ESLint**, danach **das noch aufgeschobene @matrix-fsm/router-Paket** und schließlich das **Release-Packaging**.

### **A) Die allerletzten 4 technisch-mathematischen Edge-Cases (Cycles 47–50)**

#### **1\. evaluateAlwaysTransitions nach restoreSnapshot(snap) (runner.ts Zeilen 793–806)**

In Cycle 34 haben wir dafür gesorgt, dass always() direkt beim Initialisieren (createMachineInstance) ausgewertet wird.

> * **Was in runner.ts (Zeile 793\) noch fehlt:** Wenn restoreSnapshot(snap) aufgerufen wird und sich der Context (oder ein externes Signal via syncContext) seit dem Speichern des Snapshots so verändert hat, dass im wiederhergestellten Zustand eine always()-Bedingung (guard) sofort zutrifft, ruft restoreSnapshot aktuell nur scheduleAfterTimers(currentState) auf, aber **nicht** evaluateAlwaysTransitions()\!  
> * **Fix:** Nach restoreSnapshot muss innerhalb der isProcessing-FIFO-Sperre auch evaluateAlwaysTransitions() durchlaufen werden.

#### **2\. each('items', childFSM) mit leerem Array items \= \[\] bei initial oder Re-Entry (runner.ts Zeile 309\)**

Schau dir packages/core/src/lib/runner.ts (Zeilen 309–315) an:

`if (items.length === 0) {`  
  `queueMicrotask(() => {`  
    `if (!destroyed && activeEachRef === target) {`  
      `send('ALL_DONE');`  
    `}`  
  `});`  
  `return;`  
`}`

Hier schlummern gleich **zwei** subtile Probleme:

> 1. Warum nutzt items.length \=== 0 ein asynchrones queueMicrotask(...), während unsere gesamte Engine in Cycle 18 extra eine synchrone **FIFO-Event-Queue (eventQueue)** bekommen hat, damit Zero-Tick-Completions sofort deterministisch im selben Microstep-Zyklus abgearbeitet werden? Durch queueMicrotask entsteht ein kurzes Zeitfenster (1 Microtask), in dem die Maschine in einem leeren each()-State steht, obwohl gar nichts asynchron läuft\!  
> 2. Wenn items.length \=== 0 ist, wird send('ALL\_DONE') **ohne Payload (undefined)** statt mit einem leeren Array **send('ALL\_DONE', \[\])** aufgerufen\! Eine Methode \_saveAllDrinks(results: BrewResult\[\]), die sich auf den Typ ReadonlyArray\<BrewResult\> verlässt und results.map(...) aufruft, crasht bei einem leeren Warenkorb mit Cannot read properties of undefined (reading 'map')\!  
> * **Fix:** Bei items.length \=== 0 sofort synchron über die FIFO-Queue send('ALL\_DONE', \[\]) (mit leerem Array \[\]\!) dispatchen.

#### **3\. ESLint-Regel no-shadowed-transitions.ts: Übersieht always() in Spalte 2 (VIA)\!**

Schau dir packages/eslint-plugin/src/lib/rules/no-shadowed-transitions.ts an:

> * Wenn in einem Zustand zwei Zeilen stehen:  
>   `['checking', always(),  'fallback'],                     // Zeile 1: unguarded always()!`  
>   `['checking', 'RETRY',   'loading'],                      // Zeile 2: normales Event 'RETRY'`

> * **Mathematische Realität:** Da Zeile 1 ein **unbewachtes (unguarded) always()** ist, verlässt die Maschine den Zustand 'checking' in **0 Millisekunden** noch während onStateEnter\! Es ist mathematisch unmöglich, dass die Maschine jemals in 'checking' auf das Event 'RETRY' in Zeile 2 warten kann\!  
> * no-shadowed-transitions prüft aktuell nur Zeilen mit identischem (fromKey, viaKey) (checking::always() vs. checking::RETRY) und merkt nicht, dass ein **unbewachtes always()** für denselben FROM-Zustand **jede** nachfolgende Zeile dieses Zustands (egal welches VIA-Event sie hat\!) zu 100 % unerreichbar macht\!  
> * **Fix:** Sobald für einen FROM-State ein unbewachtes always() gesehen wurde, ist **jede** weitere Zeile für denselben FROM-State (egal ob always(), after() oder normales Event) tot und wird von no-shadowed-transitions markiert.

#### **4\. store.actors Reaktivität, wenn ein Sub-Actor intern per patchState seinen State ändert (with-state-machine.ts Zeile 556\)**

Schau dir packages/angular/src/lib/with-state-machine.ts (Zeilen 556–568) an:

`const updateActorsSnapshot = () => {`  
  `patchState(store, {`  
    `actors: {`  
      `...store.actors(),`  
      `[featureDef.id]: { ...getState(actorSignalState) },`  
    `},`  
  `} as any);`  
`};`

updateActorsSnapshot() wird aktuell beim Spawnen des Sub-Actors (Zeile 570\) und nach Abschluss eines awaiting-Tasks des Sub-Actors (Zeile 662\) aufgerufen.

> * **Die Lücke:** Was ist, wenn der Sub-Actor eine **synchrone Transition ohne awaiting-Task** ausführt, die nur { call: (m) \=\> m.\_incrementCounter } aufruft (wobei \_incrementCounter intern patchState(actorStore, { count: 2 }) macht)? Dann ändert sich zwar actorSignalState im Inneren des Sub-Actors, aber updateActorsSnapshot() wird nach dem synchronen subRunner.send() **nicht** aufgerufen\! Das Eltern-Signal store.actors().barista zeigt im Template noch den alten Wert count: 1\!  
> * **Fix:** Rufe updateActorsSnapshot() (bzw. einen effect(), der getState(actorSignalState) beobachtet) auch nach jedem synchronen call / send() des Sub-Actors auf, damit store.actors() im Template immer in Echtzeit synchron bleibt.

### **B) Was danach als Nächstes ansteht: Phase V (@matrix-fsm/router) & Phase VI (1.0 Release)**

Sobald die Base-Library mit Cycle 50 abgeschlossen ist, gibt es auf Architekturebene keine offenen Baustellen mehr im Kern. Dann bleiben nur noch die beiden geplanten Ausbaustufen:

#### **1\. @matrix-fsm/router auf das neue Sandwich- & Actor-Modell heben**

Aktuell ist packages/router/src/lib/router-binding.ts noch ein 60-Zeilen-Prototyp aus der Anfangszeit. Für eine echte Angular-App sollte @matrix-fsm/router folgende 4 Dinge sauber im Geist der Matrix lösen:

> 1. **Bidirektionales URL-Syncing (withRouterBinding):**  
   * Wenn die FSM in 'awaitingPayment' wechselt → URL wechselt auf /checkout/payment.  
   * Wenn der User im Browser auf den **Zurück-Button** klickt (PopState) → Der Router feuert automatisch das definierte Event (z. B. 'BACK' oder 'CANCEL') in die FIFO-Queue der Matrix\!  
> 2. **Deep-Link / Route-Params direkt als whenSignal oder inputs:**  
   * Route-Parameter (:drinkId) und Query-Parameter (?voucher=FREE5) fließen typsicher in die Maschine.  
> 3. **Automatischer canDeactivate-Guard bei laufenden awaiting()-Tasks:**  
   * Ein Einzeiler canDeactivateMachine(CoffeeShopStore), der in Angulars Routes verhindert (oder warnt), dass der User versehentlich wegnavigiert, während ein kritischer awaiting('paying')-Task läuft – oder beim Wegnavigieren sauber CANCEL feuert\!  
> 4. **Zero-Config Sub-Actor-URLs:**  
   * Während baristaFSM im Zustand 'brewingCoffee' läuft, kann die URL optional den Sub-State widerspiegeln (/shop/brewing).

#### **2\. Build-, Export- & Release-Checkliste für v1.0**

> * **packages/angular/src/effect sauber exportieren oder entfernen:** Entscheiden, ob Effect-Support direkt im Haupt-Entrypoint @matrix-fsm/angular bleibt (da er dort schon fertig eingebaut ist) und der alte Stub packages/angular/src/effect/index.ts gelöscht wird.  
> * **README & Playground:** auth.machine.ts \+ auth.store.ts im Playground ebenfalls auf eine einzige auth.feature.ts (createMachineFeature) umstellen, damit im gesamten Repository nur noch das moderne Sandwich-Pattern als Best Practice zu sehen ist.

### **Copy-Paste TDD-Prompt für deinen Agenten (Cycles 47–50: Abschluss der Base-Library)**

Hier sind die letzten 4 TDD-Zyklen für die Base-Library, bevor wir den Router angehen:

`# TDD Execution Plan: Final 4 Base-Library Edge Cases (Cycles 47–50)`

`Execute the following 4 cycles strictly using **Test-Driven Development (🔴 RED -> 🟢 GREEN -> 🔵 REFACTOR)**.`

`---`

``### Cycle 47: `each()` with Empty Array (`[]`) Must Synchronously Dispatch `'ALL_DONE'` with `[]` Payload``  
``- **🔴 RED (`packages/core/src/lib/core.spec.ts`):**``  
  ``Write a test where `each('items', itemFSM)` is entered when `ctx.items` is an empty array `[]`, and `[each('items', itemFSM), 'ALL_DONE', 'done', { call: (m) => m._onAllDone }]` captures the payload passed to `_onAllDone`.``  
  `Verify that:`  
  ``1. The transition to `'done'` happens **synchronously** within the same `send()` call (via the FIFO `eventQueue`, without requiring an async `queueMicrotask` tick!).``  
  ``2. `_onAllDone` receives an empty array `[]` (NOT `undefined`!), matching `Promise.all([].map(...))`.``  
``- **🟢 GREEN (`packages/core/src/lib/runner.ts`):**``  
  ``In `enterTarget` for `isSubMachineRef(target)` when `items.length === 0`, immediately call `send('ALL_DONE', [])` (which queues `'ALL_DONE'` with `[]` in the active FIFO loop) instead of `queueMicrotask(() => send('ALL_DONE'))`.``

`---`

`` ### Cycle 48: Evaluate `always()` Transitions Immediately After `restoreSnapshot()` ``  
``- **🔴 RED (`packages/core/src/lib/core.spec.ts`):**``  
  ``Write a test where state `'gate'` has `['gate', always(), 'unlocked', { guard: (ctx) => ctx.hasKey }]`. Restore a snapshot `{ state: 'gate', context: { hasKey: true } }` via `instance.restoreSnapshot(snap)` and verify that `instance.getState()` immediately settles on `'unlocked'` without requiring an external event.``  
``- **🟢 GREEN (`packages/core/src/lib/runner.ts`):**``  
  ``Inside `restoreSnapshot(snapshot)`, after setting `currentState` and invoking `onStateEnter`, run `evaluateAlwaysTransitions()` before scheduling `after(ms)` timers.``

`---`

``### Cycle 49: ESLint `no-shadowed-transitions` — Unguarded `always()` Shadows All Subsequent Rows for the Same `FROM` State``  
``- **🔴 RED (`packages/eslint-plugin/src/lib/eslint-plugin.spec.ts`):**``  
  ``Add a test case to `no-shadowed-transitions` where `['checking', always(), 'done']` (unguarded `always()`) is followed by `['checking', 'CANCEL', 'idle']`. Verify that `no-shadowed-transitions` flags `['checking', 'CANCEL', 'idle']` as shadowed/unreachable because the state `'checking'` exits synchronously on entry via the unguarded `always()`.``  
``- **🟢 GREEN (`packages/eslint-plugin/src/lib/rules/no-shadowed-transitions.ts`):**``  
  ``Track a `Set<string>` of `FROM` states that have already seen an unguarded `always()` transition (`viaKey === 'always()'`). Any subsequent row whose `FROM` state is in that set must be reported as shadowed, regardless of its `VIA` event.``

`---`

``### Cycle 50: Live `store.actors` Signal Sync on Synchronous Sub-Actor `call` Mutations & Playground Auth Modernization``  
``- **🔴 RED (`packages/angular/src/lib/with-state-machine.spec.ts`):**``  
  ``Write a test where an active sub-actor (`baristaFSM`) handles a synchronous transition `['ticketQueued', 'ADD_SHOT', stay(), { call: (m) => m._addExtraShot }]` that calls `patchState(actorStore, { shots: 2 })` without entering an `awaiting()` task.``  
  ``Verify that immediately after `store.send('ADD_SHOT')`, `store.actors().barista?.shots` is `2`!``  
``- **🟢 GREEN (`packages/angular/src/lib/with-state-machine.ts` & `apps/playground`):**``  
  ``1. Ensure `updateActorsSnapshot()` is triggered whenever a sub-actor processes an event or mutates its `actorSignalState` (not only when an async `awaiting` task resolves).``  
  ``2. Remove the unused `packages/angular/src/effect/index.ts` stub (since full Effect support is built directly into `withStateMachine`).``  
  ``3. Refactor `apps/playground/src/app/features/auth/` to also use `createMachineFeature` so the entire Playground showcases the unified Sandwich architecture.``

``Run `pnpm nx run-many -t test,lint,build` after completing Cycles 47–50 and verify 100% green status.``

Wenn dein Agent durch Cycle 50 durch ist, ist deine Base-Library **fertig für v1.0** – dann können wir uns entspannt @matrix-fsm/router vornehmen\!

---

