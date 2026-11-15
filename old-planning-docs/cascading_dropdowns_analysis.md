# Kaskadierende Dropdowns (Country -> City -> Street) & Reset-Mechanismen

## 1. Problemstellung bei Kaskaden
Beim Wechsel eines übergeordneten Dropdowns (`SELECT_COUNTRY`) müssen alle untergeordneten Selektionen und Datenquellen atomar synchronisiert werden:
1. **Daten-Reset:** `city = null`, `street = null`, `streets = []`.
2. **Task-Abbruch:** Laufende HTTP-Requests (`_loadCities`, `_loadStreets`) müssen via `AbortSignal` sofort abgebrochen werden.
3. **Zustands-Rücksprung:** Egal in welchem Zwischenzustand sich die UI befindet (`loadingStreets`, `streetsReady`), muss die Kaskade sauber reinitialisiert werden.

---

## 2. Wie Matrix-FSM Kaskaden nach Cycles 51–55 löst

### A. Der "Anti-Hope-Driven"-Konflikt (Cycle 52 vs. Kaskaden-Reset)
- **Früherer Anti-Pattern:** Entwickler versuchten `[anyState(), 'SELECT_COUNTRY', awaiting('loadingCities')]`.
- **Cycle 52 Regel:** Verboten! `anyState()` darf nur zu `stay()`, `finalState()` oder bei `VIA === 'ERROR'` führen, um willkürliche Zustandssprünge zu verhindern.
- **Saubere Matrix-Lösung:**
  1. **Option A (Sub-Machine Kaskade):** Ein `addressSelectionFSM` kapselt die Schritte. Ein Abbruch/Reset des Parents beendet die Sub-Machine und räumt alle internen Timer und `AbortSignals` ab.
  2. **Option B (Explizite Reset-Pfade):**
     ```typescript
     const resetTransitions = transitions<AddressContract>([
       ['citiesReady',   'SELECT_COUNTRY', awaiting('loadingCities'), { call: (m) => m._loadCities }],
       ['loadingStreets','SELECT_COUNTRY', awaiting('loadingCities'), { call: (m) => m._loadCities }],
       ['streetsReady',  'SELECT_COUNTRY', awaiting('loadingCities'), { call: (m) => m._loadCities }],
     ]);
     ```

### B. Atomarer Reset im SignalStore (`methods` & `call`)
In Cycle 55 wird beim Aufruf von `awaiting('loadingCities')` die Methode `_loadCities` ausgeführt. 
Um "Zucken" oder inkonsistente UI-Zustände zu vermeiden, setzt `_loadCities` die nachgelagerten Store-Slices synchron zurück:

```typescript
methods: (store, api = inject(AddressApi)) => ({
  _loadCities: async (country: string, signal: AbortSignal) => {
    // 1. Synchroner Reset der nachgelagerten Kaskade
    patchState(store, {
      selectedCountry: country,
      selectedCity: null,
      selectedStreet: null,
      cities: [],
      streets: [],
    });
    // 2. Asynchroner Fetch mit AbortSignal
    return await api.fetchCities(country, signal);
  },
  _setCities: (cities: City[]) => patchState(store, { cities }),
  _loadStreets: async (city: string, signal: AbortSignal) => {
    patchState(store, { selectedCity: city, selectedStreet: null, streets: [] });
    return await api.fetchStreets(city, signal);
  },
  _setStreets: (streets: Street[]) => patchState(store, { streets }),
})
```

---

## 3. UI-Sicherheit via `store.can()` (Cycle 51)
Dank Cycle 51 liefert `store.can('SELECT_CITY')` und `store.can('SELECT_STREET')` jetzt verlässlich `false`, wenn die Guards fehlschlagen:
```typescript
['idle', 'SELECT_CITY', awaiting('loadingCities'), { guard: (ctx) => ctx.selectedCountry !== null }],
['idle', 'SELECT_CITY', stay()], // No-Op Fallback für ESLint -> can() gibt false zurück!
```
In der Angular-Template-Syntax:
```html
<select [disabled]="!store.can('SELECT_CITY')">...</select>
<select [disabled]="!store.can('SELECT_STREET')">...</select>
```
Keine inkonsistenten Auswahlen mehr möglich.
