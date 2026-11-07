import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  after,
  all,
  always,
  any,
  anyState,
  awaiting,
  createFSM,
  createMachineInstance,
  each,
  every,
  finalState,
  getShortestPaths,
  MatrixFsmInfiniteLoopError,
  race,
  stay,
  toMermaid,
  transitions,
  type ExtractAllContext,
  type ExtractAllMethods,
  type ExtractAwaitingNodes,
  type ExtractContext,
  type ExtractEvents,
  type ExtractFinalOutcomes,
  type ExtractInputs,
  type ExtractMethods,
  type ExtractStates,
  type ExtractTerminalOutputs,
  type RequiredTasksMap,
} from '../index.js';

interface AuthContext {
  credentials: { email: string; password: string };
  user: { id: string; email: string } | null;
  policy: {
    showUpsellAds: boolean;
    canBypassApproval: boolean;
    discountPercent: number;
    maxProjects: number;
  };
  error: string | null;
}

type AuthStates =
  | 'loginView'
  | 'authenticating'
  | 'proUpsellPromo'
  | 'offlineRetryView'
  | 'loggedIn';

type AuthEvents = {
  LOGIN: void;
  DISMISS_PROMO: void;
  CANCEL: void;
  NetworkTimeoutError: { message: string };
};

interface AuthMethods {
  _authenticate(): void;
  _setInvalidEmail(): void;
  _setError(err: Error): void;
}

const hasValidInput = (ctx: AuthContext) => ctx.credentials.email.includes('@');
const shouldShowPromo = (ctx: AuthContext) => ctx.policy.showUpsellAds;

const authFSM = createFSM<{
  events: AuthEvents;
  context: AuthContext;
  states: AuthStates;
  methods: AuthMethods;
}>()({
  id: 'auth',
  initial: 'loginView',
  transitions: [
    ['loginView',         'LOGIN',                awaiting('authenticating'), { guard: hasValidInput, call: (m) => m._authenticate }],
    ['loginView',         'LOGIN',                stay(),                     { call: (m) => m._setInvalidEmail }],
    ['authenticating',    'CANCEL',               'loginView'],
    ['authenticating',    'DONE',                 'proUpsellPromo',           { guard: shouldShowPromo }],
    ['authenticating',    'DONE',                 'loggedIn'],
    ['authenticating',    'NetworkTimeoutError',  'offlineRetryView'],
    ['authenticating',    'ERROR',                'loginView',                { call: (m) => m._setError }],
    ['proUpsellPromo',    'DISMISS_PROMO',        'loggedIn'],
  ],
});

describe('@matrix-fsm/core', () => {
  it('extracts states, awaiting nodes, and required tasks from curried createFSM without dummy objects', () => {
    expect(authFSM.id).toBe('auth');
    expect(authFSM.initial).toBe('loginView');
    expect([...authFSM.awaitingStates]).toEqual(['authenticating']);
    expect(authFSM.states.has('loginView')).toBe(true);
    expect(authFSM.states.has('authenticating')).toBe(true);
    expect(authFSM.states.has('proUpsellPromo')).toBe(true);
    expect(authFSM.states.has('loggedIn')).toBe(true);
    expect(authFSM.states.has('offlineRetryView')).toBe(true);

    type States = ExtractStates<typeof authFSM>;
    type Awaiting = ExtractAwaitingNodes<typeof authFSM>;
    type Ctx = ExtractContext<typeof authFSM>;
    type Tasks = RequiredTasksMap<typeof authFSM>;

    expectTypeOf<Awaiting>().toEqualTypeOf<'authenticating'>();
    expectTypeOf<keyof Tasks>().toEqualTypeOf<'authenticating'>();
    expectTypeOf<Ctx>().toEqualTypeOf<AuthContext>();
    expectTypeOf<'authenticating'>().toExtend<States>();
    expectTypeOf<'loggedIn'>().toExtend<States>();
  });

  it('evaluates First-Match-Wins, handles stay(), and executes call selectors on methods', () => {
    const initialCtx: AuthContext = {
      credentials: { email: '', password: '' },
      user: null,
      policy: {
        showUpsellAds: true,
        canBypassApproval: false,
        discountPercent: 0,
        maxProjects: 3,
      },
      error: null,
    };

    const instance = createMachineInstance(authFSM, {
      initialContext: initialCtx,
      methods: {
        _setInvalidEmail: () => {
          instance.patchContext({ error: 'Invalid email' });
        },
        _setError: (err: Error) => {
          instance.patchContext({ error: err.message });
        },
      },
    });
    expect(instance.state()).toBe('loginView');

    // Invalid email -> matches 2nd row (stay() + call _setInvalidEmail)
    instance.send('LOGIN');
    expect(instance.state()).toBe('loginView');
    expect(instance.context().error).toBe('Invalid email');
    expect(instance.isPending()).toBe(false);

    // Valid email -> matches 1st row (awaiting('authenticating'))
    instance.patchContext({
      credentials: { email: 'user@example.com', password: 'secret' },
      error: null,
    });
    instance.send('LOGIN');
    expect(instance.state()).toBe('authenticating');
    expect(instance.isPending()).toBe(true);

    // DONE with showUpsellAds: true -> transitions to proUpsellPromo
    instance.send('DONE');
    expect(instance.state()).toBe('proUpsellPromo');
    expect(instance.isPending()).toBe(false);

    // DISMISS_PROMO -> loggedIn
    instance.send('DISMISS_PROMO');
    expect(instance.state()).toBe('loggedIn');
  });

  it('supports unified createFSM as a sub-machine, infers finalState outcomes without parent event duplication, and rejects typo outcomes', () => {
    // Sub-machine that omits `context` in FSMContract and only declares events, states, and methods
    interface PaymentMethods {
      _chargeCard(): void;
      _onPaymentError(err: Error): void;
    }
    const paymentSub = createFSM<{
      events: { PAY: void };
      states: 'enteringCard' | 'chargingCard';
      methods: PaymentMethods;
    }>()({
      id: 'payment',
      initial: 'enteringCard',
      transitions: [
        ['enteringCard',  'PAY',    awaiting('chargingCard'), { call: (m) => m._chargeCard }],
        ['chargingCard',  'DONE',   finalState('PAID')],
        ['chargingCard',  'ERROR',  'enteringCard',          { call: (m) => m._onPaymentError }],
      ],
    });

    type PaymentOutcomes = ExtractFinalOutcomes<typeof paymentSub>;
    expectTypeOf<PaymentOutcomes>().toEqualTypeOf<'PAID'>();
    // Omitted context defaults safely to `Record<never, never>` without index signature pollution:
    expectTypeOf<ExtractContext<typeof paymentSub>>().toEqualTypeOf<
      Record<never, never>
    >();

    const uploadChild = createFSM<{
      events: { START: void };
      context: { progress: number };
      methods: { _upload(): void };
    }>()({
      id: 'uploadItem',
      initial: 'queued',
      transitions: [
        ['queued',     'START',  awaiting('uploading'), { call: (m) => m._upload }],
        ['uploading',  'DONE',   finalState('UPLOADED')],
        ['uploading',  'ERROR',  'failed'],
      ],
    });

    interface CheckoutContext {
      files: string[];
    }
    interface CheckoutMethods {
      _resetCart(): void;
    }

    // Notice: 'PAID' is NOT in Checkout events — it is inferred directly from `paymentSub`'s `finalState('PAID')`!
    const checkoutFSM = createFSM<{
      events: { UPLOAD_FILES: void; CANCEL: void };
      context: CheckoutContext;
      methods: CheckoutMethods;
    }>()({
      id: 'checkout',
      initial: 'cart',
      transitions: [
        ['cart',                     'UPLOAD_FILES',  each('files', uploadChild)],
        [each('files', uploadChild), 'ALL_DONE',      paymentSub],
        [paymentSub,                 'CANCEL',        'cart',          { call: (m) => m._resetCart }],
        [paymentSub,                 'PAID',          'orderConfirmed'],
      ],
    });

    // Verify Scope Invariant encapsulation: ExtractContext & ExtractMethods only extract own machine facets
    // while ExtractAllContext & ExtractAllMethods provide the full tree intersection when needed:
    expectTypeOf<ExtractContext<typeof checkoutFSM>>().toEqualTypeOf<CheckoutContext>();
    expectTypeOf<ExtractMethods<typeof checkoutFSM>>().toEqualTypeOf<CheckoutMethods>();
    expectTypeOf<ExtractAllContext<typeof checkoutFSM>>().toEqualTypeOf<
      CheckoutContext & { progress: number }
    >();
    expectTypeOf<ExtractAllMethods<typeof checkoutFSM>>().toEqualTypeOf<
      CheckoutMethods & PaymentMethods & { _upload(): void }
    >();
    expectTypeOf<ExtractEvents<typeof checkoutFSM>>().toEqualTypeOf<
      'UPLOAD_FILES' | 'CANCEL' | 'PAY' | 'START'
    >();
    expectTypeOf<'enteringCard'>().toExtend<ExtractStates<typeof checkoutFSM>>();
    expectTypeOf<'cart'>().toExtend<ExtractStates<typeof checkoutFSM>>();
    expectTypeOf<'PAID'>().not.toExtend<ExtractStates<typeof paymentSub>>();
    expectTypeOf<'PAID'>().not.toExtend<ExtractStates<typeof checkoutFSM>>();
    expect(paymentSub.states.has('PAID')).toBe(false);

    // Compile-time check: invalid outcome on sub-machine row triggers @ts-expect-error
    createFSM<{
      events: { CANCEL: void };
      context: CheckoutContext;
    }>()({
      id: 'invalidOutcomeTest',
      initial: 'cart',
      transitions: [
        ['cart',     'CANCEL',       paymentSub],
        [paymentSub, 'PAID',         'orderConfirmed'],
        // @ts-expect-error - 'TYPO_OUTCOME' is not a finalState of paymentSub or an event of parent
        [paymentSub, 'TYPO_OUTCOME', 'orderConfirmed'],
      ],
    });

    const exitedStates: string[] = [];
    const instance = createMachineInstance(checkoutFSM, {
      initialContext: { files: ['f1', 'f2'] },
      onExit: {
        enteringCard: () => exitedStates.push('enteringCard'),
      },
    });
    expect(instance.state()).toBe('cart');

    instance.send('UPLOAD_FILES');
    expect(instance.state()).toBe('each:files');

    instance.send('ALL_DONE');
    expect(instance.state()).toBe('payment');
    expect(instance.subState()).toBe('enteringCard');

    // Group interrupt from parent invokes onExit for active sub-state
    instance.send('CANCEL');
    expect(instance.state()).toBe('cart');
    expect(instance.subState()).toBeNull();
    expect(exitedStates).toContain('enteringCard');

    // Re-enter and complete payment
    instance.send('UPLOAD_FILES');
    instance.send('ALL_DONE');
    expect(instance.state()).toBe('payment');
    instance.send('PAY');
    expect(instance.subState()).toBe('chargingCard');
    expect(instance.isPending()).toBe(true);
    instance.send('DONE');
    expect(instance.state()).toBe('orderConfirmed');

    const mermaid = toMermaid(checkoutFSM);
    expect(mermaid).toContain('stateDiagram-v2');
    expect(mermaid).toContain('state "⚡ chargingCard" as chargingCard');
    expect(mermaid).toContain('state payment {');
    expect(mermaid).toContain('each_files');
  });

  it('supports extracted transitions() groups (> 3 rows) with FSMContract, machine typeof, or context', () => {
    const handleOrderSubmit = transitions<{
      context: AuthContext;
      methods: AuthMethods;
    }>([
      ['loginView', 'LOGIN', 'ssoRedirect',             { guard: hasValidInput }],
      ['loginView', 'LOGIN', 'mfaChallenge',            { guard: shouldShowPromo }],
      ['loginView', 'LOGIN', awaiting('authenticating'), { guard: hasValidInput, call: (m) => m._authenticate }],
      ['loginView', 'LOGIN', stay(),                    { call: (m) => m._setInvalidEmail }],
    ]);

    const handleByMachineType = transitions<typeof authFSM>([
      ['loginView', 'LOGIN', 'ssoRedirect',             { guard: hasValidInput }],
      ['loginView', 'LOGIN', 'mfaChallenge',            { guard: shouldShowPromo }],
      ['loginView', 'LOGIN', awaiting('authenticating'), { guard: hasValidInput, call: (m) => m._authenticate }],
      ['loginView', 'LOGIN', stay(),                    { call: (m) => m._setInvalidEmail }],
    ]);

    expect(handleOrderSubmit).toHaveLength(4);
    expect(handleByMachineType).toHaveLength(4);
  });

  it('generates Mermaid diagram with ⚡ awaiting badges and stay labels', () => {
    const diagram = toMermaid(authFSM);
    expect(diagram).toContain('stateDiagram-v2');
    expect(diagram).toContain('[*] --> loginView');
    expect(diagram).toContain('state "⚡ authenticating" as authenticating');
    expect(diagram).toContain(
      'loginView --> authenticating : LOGIN [hasValidInput]',
    );
    expect(diagram).toContain('loginView --> loginView : LOGIN (stay)');
    expect(diagram).toContain(
      'authenticating --> proUpsellPromo : DONE [shouldShowPromo]',
    );
    expect(diagram).toContain('authenticating --> loggedIn : DONE');
  });

  it('enforces compile-time input contracts, output exhaustiveness (ValidateSubMachineOutputs), unified output tuple selectors, intermediate outputs, dual (ctx, eventPayload) signature, collision guards, and runtime fail-fast guards', () => {
    interface BaristaInputs {
      readonly selectedDrink: string;
    }
    type BaristaOutputs = {
      COFFEE_READY: { readonly drinkName: string; readonly temp: number };
      BEAN_EMPTY: { readonly reason: string };
      PROGRESS: { readonly percent: number };
      STEAM_READY: void;
      CLEAN_ALERT: void;
      CANCELLED: void;
    };

    const strictBarista = createFSM<{
      inputs: BaristaInputs;
      events: {
        START_BREWING: void;
        TICK_PROGRESS: { readonly delta: number };
        NEEDS_CLEANING: void;
        OUT_OF_BEANS: void;
        ABORT_BREW: void;
      };
      outputs: BaristaOutputs;
      context: BaristaInputs & { temp: number; percent: number };
      states: 'ticketQueued' | 'brewingCoffee' | 'cleaning';
      methods: {
        _startBrewing(): void;
        _tickProgress(ev: { readonly delta: number }, ctx: BaristaInputs & { temp: number; percent: number }): void;
      };
    }>()({
      id: 'barista',
      initial: 'ticketQueued',
      // prettier-ignore
      transitions: [
        ['ticketQueued',  'START_BREWING',  awaiting('brewingCoffee'), { call: (m) => m._startBrewing, output: 'STEAM_READY' }],
        ['brewingCoffee', 'TICK_PROGRESS',  stay(),                    { call: (m) => m._tickProgress, output: ['PROGRESS', (ctx) => ({ percent: ctx.percent })] }],
        ['brewingCoffee', 'NEEDS_CLEANING', 'cleaning',                { output: ['CLEAN_ALERT'] }],
        ['brewingCoffee', 'DONE',           finalState(),              { output: ['COFFEE_READY', (ctx) => ({ drinkName: ctx.selectedDrink, temp: ctx.temp })] }],
        ['brewingCoffee', 'OUT_OF_BEANS',   finalState(),              { output: ['BEAN_EMPTY', () => ({ reason: 'Hopper empty' })] }],
        ['brewingCoffee', 'ABORT_BREW',     finalState('CANCELLED')],
        ['brewingCoffee', 'ERROR',          'ticketQueued'],
      ],
    });

    // Compile-time verification:
    // 0. Compile-time error tests on `output` and `finalState` collision guard:
    createFSM<{
      events: { GO: void; CANCEL: void };
      outputs: BaristaOutputs;
      context: { selectedDrink: string; temp: number };
      states: 'idle';
    }>()({
      id: 'outputCompileErrorChecks',
      initial: 'idle',
      transitions: [
        // @ts-expect-error - 'UNKNOWN_OUTPUT' is not in BaristaOutputs
        ['idle', 'GO',     finalState(),            { output: ['UNKNOWN_OUTPUT', () => ({})] }],
        // @ts-expect-error - Selector return type does not match BaristaOutputs['COFFEE_READY']
        ['idle', 'GO',     finalState(),            { output: ['COFFEE_READY', () => ({ wrongKey: 123 })] }],
        // @ts-expect-error - Collision guard: finalState('CANCELLED') cannot be combined with options.output
        ['idle', 'CANCEL', finalState('CANCELLED'), { output: 'CANCELLED' }],
      ],
    });

    // 1. Omitting `{ input: (ctx) => ... }` when entering `strictBarista` must be a compile error!
    createFSM<{
      events: { PAY: void };
      context: { drink: string };
    }>()({
      id: 'missingInputTest',
      initial: 'idle',
      transitions: [
        // @ts-expect-error - Missing required `{ input: (ctx) => BaristaInputs }` for sub-machine with `inputs`
        ['idle',        'PAY',          strictBarista],
        [strictBarista, 'COFFEE_READY', 'done'],
        [strictBarista, 'BEAN_EMPTY',   'idle'],
        [strictBarista, 'PROGRESS',     stay()],
        [strictBarista, 'STEAM_READY',  stay()],
        [strictBarista, 'CLEAN_ALERT',  stay()],
        [strictBarista, 'CANCELLED',    'idle'],
      ],
    });

    // 2. Omitting a declared output handler row (`BEAN_EMPTY`) on `strictBarista` must be a compile error!
    createFSM<{
      events: { PAY: void };
      context: { drink: string };
    }>()({
      id: 'missingOutputHandlerTest',
      initial: 'idle',
      transitions: [
        // @ts-expect-error - Missing required transition rows for sub-machine output(s)
        ['idle',        'PAY',          strictBarista, { input: (ctx) => ({ selectedDrink: ctx.drink }) }],
        [strictBarista, 'COFFEE_READY', 'done'],
      ],
    });

    // 3. Valid parent handling all outputs + strongly typed payload on `call: (m) => m._onReady`
    let readyOutput: { readonly drinkName: string; readonly temp: number } | null = null;
    let lastProgress = 0;
    let steamCount = 0;
    let cleanAlertCount = 0;
    let cancelCount = 0;

    interface ParentMethods {
      _onReady(output: { readonly drinkName: string; readonly temp: number }): void;
      _onProgress(output: { readonly percent: number }): void;
      _onSteam(): void;
      _onCleanAlert(): void;
      _onCancelled(): void;
    }

    const validShop = createFSM<{
      events: { PAY: void };
      context: { drink: string };
      methods: ParentMethods;
    }>()({
      id: 'coffeeShop',
      initial: 'idle',
      transitions: [
        ['idle',        'PAY',          strictBarista, { input: (ctx) => ({ selectedDrink: ctx.drink }) }],
        [strictBarista, 'STEAM_READY',  stay(),        { call: (m) => m._onSteam }],
        [strictBarista, 'PROGRESS',     stay(),        { call: (m) => m._onProgress }],
        [strictBarista, 'CLEAN_ALERT',  stay(),        { call: (m) => m._onCleanAlert }],
        [strictBarista, 'COFFEE_READY', 'done',        { call: (m) => m._onReady }],
        [strictBarista, 'BEAN_EMPTY',   'maintenance'],
        [strictBarista, 'CANCELLED',    'idle',        { call: (m) => m._onCancelled }],
      ],
    });

    const instance = createMachineInstance(validShop, {
      initialContext: { drink: 'Flat White', temp: 68, percent: 10 } as any,
      methods: {
        _tickProgress: (ev: { readonly delta: number }, ctx: { percent: number }) => {
          instance.patchContext({ percent: ctx.percent + ev.delta } as any);
        },
        _onReady: (out: { readonly drinkName: string; readonly temp: number }) => {
          readyOutput = out;
        },
        _onProgress: (out: { readonly percent: number }) => {
          lastProgress = out.percent;
        },
        _onSteam: () => {
          steamCount++;
        },
        _onCleanAlert: () => {
          cleanAlertCount++;
        },
        _onCancelled: () => {
          cancelCount++;
        },
      },
    });

    instance.send('PAY');
    expect(instance.state()).toBe('barista');
    expect(instance.subState()).toBe('ticketQueued');

    // Intermediate `output: 'STEAM_READY'` triggers parent `stay()` without killing child!
    instance.send('START_BREWING');
    expect(steamCount).toBe(1);
    expect(instance.state()).toBe('barista');
    expect(instance.subState()).toBe('brewingCoffee');

    // Intermediate `stay()` + `patch` + `output: ['PROGRESS', (ctx, ev) => ...]` executes patch first, then output selector!
    instance.send('TICK_PROGRESS', { delta: 40 });
    expect(lastProgress).toBe(50);
    expect(instance.state()).toBe('barista');
    expect(instance.subState()).toBe('brewingCoffee');

    // Terminal `finalState()` + `output: ['COFFEE_READY', selector]` passes selector output to `_onReady` and terminates child!
    instance.send('DONE');
    expect(instance.state()).toBe('done');
    expect(instance.subState()).toBeNull();
    expect(readyOutput).toEqual({ drinkName: 'Flat White', temp: 68 });

    // Test intermediate output with state change (`'cleaning'` + `output: ['CLEAN_ALERT']`)
    instance.reset();
    instance.send('PAY');
    instance.send('START_BREWING');
    instance.send('NEEDS_CLEANING');
    expect(cleanAlertCount).toBe(1);
    expect(instance.state()).toBe('barista');
    expect(instance.subState()).toBe('cleaning');

    // Test terminal output without payload (`finalState('CANCELLED')`)
    instance.reset();
    instance.send('PAY');
    instance.send('START_BREWING');
    instance.send('ABORT_BREW');
    expect(cancelCount).toBe(1);
    expect(instance.state()).toBe('idle');
    expect(instance.subState()).toBeNull();

    // 4. Runtime Fail-Fast Guard when someone bypasses TypeScript via `as any`:
    const brokenShop = createFSM<{
      events: { PAY: void };
      context: { drink: string };
    }>()({
      id: 'coffeeShop',
      initial: 'idle',
      transitions: [
        ['idle',        'PAY',          strictBarista, { input: (ctx: { drink: string }) => ({ selectedDrink: ctx.drink }) }],
        [strictBarista, 'COFFEE_READY', 'done'],
      ] as any,
    });

    const brokenInstance = createMachineInstance(brokenShop, {
      initialContext: { drink: 'Espresso', temp: 65, percent: 0 } as any,
    });
    brokenInstance.send('PAY');
    expect(() => brokenInstance.send('START_BREWING')).toThrow(
      "[MatrixFSM Error]: Sub-machine 'barista' emitted output 'STEAM_READY', but parent 'coffeeShop' has no matching transition. Prevented silent deadlock!",
    );
  });

  it('processes synchronous re-entrant send() calls strictly in FIFO order (Run-to-Completion)', () => {
    const orderLog: string[] = [];

    const reentrantFSM = createFSM<{
      events: { START: void; AUTO_ADVANCE: void };
      states: 'idle' | 'step1' | 'step2';
      methods: { _onEnterStep1: () => void; _onEnterStep2: () => void };
    }>()({
      id: 'reentrant',
      initial: 'idle',
      transitions: [
        ['idle',  'START',        'step1', { call: (m) => m._onEnterStep1 }],
        ['step1', 'AUTO_ADVANCE', 'step2', { call: (m) => m._onEnterStep2 }],
      ],
    });

    const runnerRef = createMachineInstance(reentrantFSM, {
      context: {},
      methods: {
        _onEnterStep1: () => {
          orderLog.push(`in-method-1:state=${runnerRef.getState()}`);
          // Synchroner re-entranter send()-Aufruf NOCH WÄHREND der erste Übergang läuft!
          runnerRef.send('AUTO_ADVANCE');
          orderLog.push('after-nested-send-in-method-1');
        },
        _onEnterStep2: () => {
          orderLog.push(`in-method-2:state=${runnerRef.getState()}`);
        },
      },
    });

    runnerRef.send('START');

    // Erwartung:
    // 1. Erst läuft Transition 1 ('idle' -> 'step1') inkl. _onEnterStep1 KOMPLETT zu Ende.
    // 2. Erst DANACH wird das eingereihte 'AUTO_ADVANCE' ('step1' -> 'step2') aus der FIFO-Queue verarbeitet!
    expect(runnerRef.getState()).toBe('step2');
    expect(orderLog).toEqual([
      'in-method-1:state=step1',
      'after-nested-send-in-method-1',
      'in-method-2:state=step2',
    ]);
  });

  it('rejects inline patch option in column 4 in favor of call', () => {
    createFSM<{
      events: { INC: void };
      states: 'idle';
      context: { count: number };
    }>()({
      id: 'noPatch',
      initial: 'idle',
      // prettier-ignore
      transitions: [
        // @ts-expect-error — 'patch' does not exist in TransitionOptions; use 'call' instead
        ['idle', 'INC', stay(), { patch: (ctx: { count: number }) => ({ count: ctx.count + 1 }) }],
      ],
    });
  });

  it('emits structured debug trace logs when debug option is enabled', () => {
    const logs: string[] = [];
    const customLogger = (msg: string) => logs.push(msg);

    const fsm = createFSM<{
      events: { GO: void; IGNORED_EVENT: void };
      states: 'a' | 'b';
    }>()({
      id: 'debugMachine',
      initial: 'a',
      transitions: [['a', 'GO', 'b']],
    });

    const instance = createMachineInstance(fsm, {
      context: {},
      debug: customLogger,
    });

    instance.send('IGNORED_EVENT');
    instance.send('GO');

    expect(logs).toEqual([
      "[MatrixFSM:debugMachine] Ignored event 'IGNORED_EVENT' in state 'a'",
      "[MatrixFSM:debugMachine] Transition 'a' --(GO)--> 'b'",
    ]);
  });

  describe('declarative timers with after(ms)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('automatically transitions after the specified delay and cancels stale timers on early exit', () => {
      const timerFSM = createFSM<{
        events: { SHOW: void; DISMISS: void };
        states: 'idle' | 'toastVisible';
      }>()({
        id: 'toast',
        initial: 'idle',
        transitions: [
          ['idle',         'SHOW',      'toastVisible'],
          ['toastVisible', 'DISMISS',   'idle'],
          ['toastVisible', after(3000), 'idle'],
        ],
      });

      const instance = createMachineInstance(timerFSM, { context: {} });

      // 1. Besuch: Wird nach 2000ms manuell abgebrochen -> Timer MUSS gekillt werden!
      instance.send('SHOW');
      expect(instance.getState()).toBe('toastVisible');
      vi.advanceTimersByTime(2000);
      instance.send('DISMISS');
      expect(instance.getState()).toBe('idle');

      // 2. Besuch bei t=2500ms: Der alte Timer von Besuch 1 darf NICHT bei t=3000ms feuern!
      vi.advanceTimersByTime(500);
      instance.send('SHOW');
      expect(instance.getState()).toBe('toastVisible');

      vi.advanceTimersByTime(2999);
      expect(instance.getState()).toBe('toastVisible'); // Nach 2999ms im 2. Besuch noch offen!

      vi.advanceTimersByTime(1);
      expect(instance.getState()).toBe('idle'); // Exakt nach 3000ms im 2. Besuch geschlossen!
    });

    it('schedules after(ms) on the initial state without any prior send() call and cleans up sub-actor timers on parent Hard Kill (CANCEL)', () => {
      // 1. after(1000) on initial state 'splash' -> 'home' without any prior send() call
      const splashFSM = createFSM<{
        states: 'splash' | 'home';
      }>()({
        id: 'splashScreen',
        initial: 'splash',
        transitions: [
          ['splash', after(1000), 'home'],
        ],
      });

      const splashInstance = createMachineInstance(splashFSM);
      expect(splashInstance.state()).toBe('splash');

      vi.advanceTimersByTime(999);
      expect(splashInstance.state()).toBe('splash');

      vi.advanceTimersByTime(1);
      expect(splashInstance.state()).toBe('home');

      // 2. Sub-actor with internal after(5000) transition interrupted at t = 1000ms by parent CANCEL (Hard Kill)
      let subTimerFired = false;
      const timedSubActor = createFSM<{
        states: 'waitingInSub' | 'timedOut';
        methods: { _onSubTimeout(): void };
      }>()({
        id: 'timedSubActor',
        initial: 'waitingInSub',
        transitions: [
          ['waitingInSub', after(5000), finalState('DONE'), { call: (m) => m._onSubTimeout }],
        ],
      });

      const parentWithSubTimer = createFSM<{
        events: { START: void; CANCEL: void };
        states: 'idle' | 'completed';
      }>()({
        id: 'parentWithSubTimer',
        initial: 'idle',
        transitions: [
          ['idle',        'START',  timedSubActor],
          [timedSubActor, 'CANCEL', 'idle'],
          [timedSubActor, 'DONE',   'completed'],
        ],
      });

      const parentInst = createMachineInstance(parentWithSubTimer, {
        methods: {
          _onSubTimeout: () => {
            subTimerFired = true;
          },
        },
      });

      parentInst.send('START');
      expect(parentInst.state()).toBe('timedSubActor');
      expect(parentInst.subState()).toBe('waitingInSub');

      // Advance to t = 1000ms and interrupt via parent CANCEL (Hard Kill)
      vi.advanceTimersByTime(1000);
      parentInst.send('CANCEL');
      expect(parentInst.state()).toBe('idle');
      expect(parentInst.subState()).toBeNull();

      // Advance past t = 5000ms -> sub-actor timer was cleared and never fires!
      vi.advanceTimersByTime(5000);
      expect(subTimerFired).toBe(false);
      expect(parentInst.state()).toBe('idle');
    });
  });

  describe('Cycle 8: Mathematical Graph Conservation & Sub-Actor Finalization Safety', () => {
    it('enforces compile-time prohibition of stay() on terminal sub-machine outputs while allowing stay() on streaming outputs', () => {
      const streamingSub = createFSM<{
        events: { TICK: void; FINISH: void };
        states: 'working';
        outputs: { PROGRESS: number; COMPLETED: { total: number } };
      }>()({
        id: 'streamingSub',
        initial: 'working',
        transitions: [
          ['working', 'TICK',   stay(),       { output: ['PROGRESS', () => 50] }],
          ['working', 'FINISH', finalState(), { output: ['COMPLETED', () => ({ total: 100 })] }],
        ],
      });

      expectTypeOf<ExtractTerminalOutputs<typeof streamingSub>>().toEqualTypeOf<'COMPLETED'>();

      // Valid: stay() on streaming PROGRESS, transition on terminal COMPLETED
      createFSM<{
        events: { START: void };
        states: 'idle' | 'done';
      }>()({
        id: 'validParent',
        initial: 'idle',
        transitions: [
          ['idle',       'START',     streamingSub],
          [streamingSub, 'PROGRESS',  stay()],
          [streamingSub, 'COMPLETED', 'done'],
        ],
      });

      // Invalid: stay() on terminal COMPLETED (both direct and fallback)
      createFSM<{
        events: { START: void };
        states: 'idle' | 'done';
      }>()({
        id: 'invalidStayOnTerminal',
        initial: 'idle',
        transitions: [
          ['idle',       'START',     streamingSub],
          [streamingSub, 'PROGRESS',  stay()],
          // @ts-expect-error - stay() is forbidden when handling terminal sub-machine output 'COMPLETED'
          [streamingSub, 'COMPLETED', stay()],
        ],
      });
    });

    it('enforces parent handling of implicit DONE from bare finalState() and forbids finalState(NAME) for non-void outputs', () => {
      const bareDoneSub = createFSM<{
        events: { FINISH: void };
        states: 'active';
      }>()({
        id: 'bareDoneSub',
        initial: 'active',
        transitions: [['active', 'FINISH', finalState()]],
      });

      expectTypeOf<ExtractTerminalOutputs<typeof bareDoneSub>>().toEqualTypeOf<'DONE'>();

      // Missing 'DONE' handler triggers compile-time error on bareDoneSub in Column 3
      createFSM<{
        events: { GO: void };
        states: 'idle' | 'complete';
      }>()({
        id: 'missingImplicitDoneParent',
        initial: 'idle',
        transitions: [
          // @ts-expect-error - MissingSubMachineOutputs<'DONE'> because bare finalState() implicitly emits 'DONE'
          ['idle', 'GO', bareDoneSub],
        ],
      });

      // Passing non-void output key to finalState('NAME') triggers compile-time error
      createFSM<{
        events: { FINISH: void };
        states: 'active';
        outputs: { RESULT: { count: number }; CANCELLED: void };
      }>()({
        id: 'nonVoidShorthandCheck',
        initial: 'active',
        transitions: [
          // @ts-expect-error - 'RESULT' requires a payload and cannot use void shorthand finalState('RESULT')
          ['active', 'FINISH', finalState('RESULT')],
        ],
      });
    });

    it('throws a descriptive runtime Dev-Guard error if a parent responds to a terminal finalState() output with stay()', () => {
      const childSub = createFSM<{
        events: { COMPLETE: void };
        states: 'running';
      }>()({
        id: 'childSub',
        initial: 'running',
        transitions: [['running', 'COMPLETE', finalState()]],
      });

      const brokenParent = createFSM<any>()({
        id: 'brokenParent',
        initial: 'idle',
        transitions: [
          ['idle',   'START', childSub],
          [childSub, 'DONE',  stay()],
        ] as any,
      });

      const instance = createMachineInstance(brokenParent, { context: {} });
      instance.send('START');
      expect(() => instance.send('COMPLETE')).toThrowError(
        /Sub-machine 'childSub' terminated with final output 'DONE', but parent 'brokenParent' responded with stay\(\)/,
      );
    });
  });

  describe('Cycle 9: Global Event Handling with anyState()', () => {
    it('evaluates state-specific transitions before anyState() fallback rows and supports stay() vs target transitions', () => {
      const logs: string[] = [];
      const appFSM = createFSM<{
        events: { LOGOUT: void; PING: void; STEP: void };
        outputs: { loggedOut: void };
        states: 'idle' | 'editing' | 'unsavedWarning' | 'loggedOut';
        methods: {
          _warnUnsaved(): void;
          _forceLogout(): void;
          _recordPing(): void;
        };
      }>()({
        id: 'app',
        initial: 'idle',
        transitions: [
          ['idle',       'STEP',   'editing'],
          ['editing',    'LOGOUT', 'unsavedWarning', { call: (m) => m._warnUnsaved }],
          [anyState(),   'LOGOUT', finalState('loggedOut'), { call: (m) => m._forceLogout }],
          [anyState(),   'PING',   stay(),           { call: (m) => m._recordPing }],
        ],
      });

      // Compile-time check: anyState() is forbidden in Column 3 (TO)
      createFSM<{
        events: { GO: void };
        states: 'idle';
      }>()({
        id: 'invalidAnyStateTarget',
        initial: 'idle',
        transitions: [
          // @ts-expect-error - anyState() is only allowed in Column 1 (FROM), never in Column 3 (TO)
          ['idle', 'GO', anyState()],
        ],
      });

      const instance = createMachineInstance(appFSM, {
        context: {},
        methods: {
          _warnUnsaved: () => logs.push('warnUnsaved'),
          _forceLogout: () => logs.push('forceLogout'),
          _recordPing: () => logs.push('ping'),
        },
      });

      // 1. Global stay() does not leave current state
      instance.send('PING');
      expect(instance.state()).toBe('idle');
      expect(logs).toEqual(['ping']);

      // 2. Move to 'editing', where specific ['editing', 'LOGOUT', ...] overrides [anyState(), 'LOGOUT', ...]
      instance.send('STEP');
      expect(instance.state()).toBe('editing');

      instance.send('LOGOUT');
      expect(instance.state()).toBe('unsavedWarning');
      expect(logs).toEqual(['ping', 'warnUnsaved']);

      // 3. In 'unsavedWarning', no specific LOGOUT row exists -> falls back to [anyState(), 'LOGOUT', 'loggedOut']
      instance.send('LOGOUT');
      expect(instance.state()).toBe('loggedOut');
      expect(logs).toEqual(['ping', 'warnUnsaved', 'forceLogout']);

      // Mermaid rendering includes (*) wildcard node
      const diagram = toMermaid(appFSM);
      expect(diagram).toContain('state "(*)" as anyState');
      expect(diagram).toContain('anyState --> [*] : LOGOUT (loggedOut)');
    });
  });

  describe('Cycle 14: Recursive Type Extraction for Combinators (all, race, any)', () => {
    it('extracts child states and events from all(subA, subB) and enforces required inputs for combinator children', () => {
      const subA = createFSM<{
        inputs: { id: string };
        events: { EVENT_A: void };
        states: 'stateA1' | 'stateA2';
      }>()({
        id: 'subA',
        initial: 'stateA1',
        transitions: [
          ['stateA1', 'EVENT_A', 'stateA2'],
          ['stateA2', 'EVENT_A', finalState('DONE')],
        ],
      });

      const subB = createFSM<{
        events: { EVENT_B: void };
        states: 'stateB1' | 'stateB2';
      }>()({
        id: 'subB',
        initial: 'stateB1',
        transitions: [
          ['stateB1', 'EVENT_B', 'stateB2'],
          ['stateB2', 'EVENT_B', finalState('DONE')],
        ],
      });

      const parentFSM = createFSM<{
        events: { START: void };
        context: { itemId: string };
        states: 'idle' | 'completed';
      }>()({
        id: 'parentCombinator',
        initial: 'idle',
        transitions: [
          ['idle',          'START', all(subA, subB), { input: (ctx) => ({ id: ctx.itemId }) }],
          [all(subA, subB), 'DONE',  'completed'],
        ],
      });

      type ParentStates = ExtractStates<typeof parentFSM>;
      type ParentEvents = ExtractEvents<typeof parentFSM>;
      const comb = all(subA, subB);
      expectTypeOf<typeof comb.machines>().toEqualTypeOf<readonly [typeof subA, typeof subB]>();
      expectTypeOf<ExtractInputs<typeof comb>>().toEqualTypeOf<{ id: string }>();

      expectTypeOf<'stateA1' | 'stateA2' | 'stateB1' | 'stateB2'>().toExtend<ParentStates>();
      expectTypeOf<'EVENT_A' | 'EVENT_B' | 'START'>().toExtend<ParentEvents>();
      expect(race(subA, subB).__type).toBe('race');
      expect(any(subA, subB).__type).toBe('any');

      // Compile-time check: omitting required `{ input: ... }` when subA inside all(subA, subB) requires inputs: { id: string }
      createFSM<{
        events: { START: void };
        context: { itemId: string };
        states: 'idle' | 'completed';
      }>()({
        id: 'parentCombinatorMissingInput',
        initial: 'idle',
        transitions: [
          // @ts-expect-error - subA inside all(subA, subB) requires inputs: { id: string }
          ['idle',          'START', all(subA, subB)],
          [all(subA, subB), 'DONE',  'completed'],
        ],
      });
    });
  });

  describe('Cycle 18: 8-Phase Microstep Pipeline, Live Context Sync & Zero-Tick Child Safety', () => {
    it('executes call BEFORE input/output so input and output selectors immediately see the freshly mutated context', () => {
      const childFSM = createFSM<{
        inputs: { selectedDrink: string };
        events: { FINISH: void };
        context: { selectedDrink: string | null };
        states: 'brewing';
      }>()({
        id: 'barista',
        initial: 'brewing',
        context: { selectedDrink: null },
        transitions: [
          ['brewing', 'FINISH', finalState('COFFEE_READY')],
        ],
      });

      const parentFSM = createFSM<{
        events: { QUICK_ORDER: { drink: string } };
        context: { selectedDrink: string | null };
        outputs: { ORDER_STARTED: { drink: string } };
        states: 'idle' | 'done';
        methods: { _selectDrink(payload: { drink: string }): void };
      }>()({
        id: 'shop',
        initial: 'idle',
        context: { selectedDrink: null },
        transitions: [
          [
            'idle',
            'QUICK_ORDER',
            childFSM,
            {
              call: (m) => m._selectDrink,
              input: (ctx) => ({ selectedDrink: ctx.selectedDrink! }),
              output: ['ORDER_STARTED', (ctx) => ({ drink: ctx.selectedDrink! })],
            },
          ],
          [childFSM, 'COFFEE_READY', 'done'],
        ],
      });

      let liveCtx = { selectedDrink: null as string | null };
      let emittedOut: unknown = null;

      const instance = createMachineInstance(parentFSM, {
        getContext: () => liveCtx,
        methods: {
          _selectDrink: ({ drink }: { readonly drink: string }) => {
            liveCtx = { ...liveCtx, selectedDrink: drink };
          },
        },
        onStateChange: (_s, _c, info) => {
          if (info.emittedOutput) {
            emittedOut = info.emittedOutput;
          }
        },
      });

      instance.send('QUICK_ORDER', { drink: 'Espresso' });
      expect(instance.state()).toBe('barista');
      expect(instance.subContext()?.['selectedDrink']).toBe('Espresso');
      expect(emittedOut).toEqual({
        type: 'ORDER_STARTED',
        payload: { drink: 'Espresso' },
      });
    });
  });

  describe('Cycle 19: Self-Transition Re-Entry vs. stay() with Epoch Protection', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('resets after(ms) timer and invokes onExit/onEnter on explicit self-transition, whereas stay() does NOT', () => {
      const lifecycleLog: string[] = [];

      const activeFSM = createFSM<{
        events: { ACTIVITY: void; PING: void };
        states: 'active' | 'idle';
      }>()({
        id: 'activityTracker',
        initial: 'active',
        transitions: [
          ['active', 'ACTIVITY',  'active'],
          ['active', 'PING',      stay()],
          ['active', after(3000), 'idle'],
        ],
      });

      const instance = createMachineInstance(activeFSM, {
        onExit: { active: () => lifecycleLog.push('exit:active') },
        onEnter: { active: () => lifecycleLog.push('enter:active') },
      });

      expect(instance.state()).toBe('active');

      // Advance 2000ms and dispatch PING -> stay() does NOT reset after(3000) timer or trigger exit/enter!
      vi.advanceTimersByTime(2000);
      instance.send('PING');
      expect(lifecycleLog).toEqual([]);

      // Advance 500ms (total 2500ms) and dispatch ACTIVITY -> explicit self-transition resets after(3000) timer!
      vi.advanceTimersByTime(500);
      instance.send('ACTIVITY');
      expect(lifecycleLog).toEqual(['exit:active', 'enter:active']);
      expect((instance as any).epoch).toBeGreaterThanOrEqual(1);

      // Advance 1000ms (3500ms from initial, 1000ms from ACTIVITY) -> still 'active'!
      vi.advanceTimersByTime(1000);
      expect(instance.state()).toBe('active');

      // Advance remaining 2000ms (3000ms from ACTIVITY) -> transitions to 'idle'!
      vi.advanceTimersByTime(2000);
      expect(instance.state()).toBe('idle');
    });
  });

  describe('Cycle 20, 24 & 25: Row-Level Payload Type Safety (ExpectedCallSignature, guard, input, output & VIA Arrays)', () => {
    it('enforces strict row-level payload types for call, guard, input, and output and supports VIA arrays at runtime', () => {
      interface TestMethods {
        _reset: () => void;
        _logOptional: (reason?: string) => void;
        _selectDrink: (drink: { readonly id: string }) => void;
        _wrongParamType: (count: number) => void;
        _twoRequired: (a: { readonly id: string }, b: number) => void;
        _selectOptional: (drink?: { readonly id: string }) => void;
      }

      const childActor = createFSM<{
        inputs: { readonly itemId: string };
        events: { DONE_CHILD: void };
        outputs: { CHILD_READY: { readonly result: string } };
        states: 'working';
      }>()({
        id: 'childActor',
        initial: 'working',
        transitions: [
          [
            'working',
            'DONE_CHILD',
            finalState(),
            { output: ['CHILD_READY', () => ({ result: 'ok' })] },
          ],
        ],
      });

      const validFsm = createFSM<{
        context: { readonly count: number; readonly lastId: string | null };
        events: {
          CANCEL: void;
          RESET: void;
          SELECT: { readonly id: string };
        };
        outputs: {
          SELECTED_OUT: { readonly outId: string };
        };
        states: 'idle' | 'selected' | 'done';
        methods: TestMethods;
      }>()({
        id: 'rowPayloadSafety',
        initial: 'idle',
        transitions: [
          // 1. void event with parameterless method -> VALID
          ['idle', 'CANCEL', 'idle', { call: (m) => m._reset }],
          // 2. void event with optional parameter method -> VALID
          ['idle', 'RESET', 'idle', { call: (m) => m._logOptional }],
          // 3. typed payload event with matching parameter method, guard, and output -> VALID
          [
            'idle',
            'SELECT',
            'selected',
            {
              guard: (ctx, payload) => {
                const _checkId: string = payload.id;
                return ctx.count >= 0 && _checkId.length > 0;
              },
              call: (m) => m._selectDrink,
              output: [
                'SELECTED_OUT',
                (_ctx, payload) => {
                  const _checkId: string = payload.id;
                  return { outId: _checkId };
                },
              ],
            },
          ],
          // 4. typed payload event with parameterless method -> VALID (JavaScript functions can ignore extra args)
          ['selected', 'SELECT', 'selected', { call: (m) => m._reset }],
          // 5. typed payload event transitioning into sub-machine with input(ctx, payload) -> VALID
          [
            'selected',
            'SELECT',
            childActor,
            {
              input: (_ctx, payload) => {
                const _checkId: string = payload.id;
                return { itemId: _checkId };
              },
            },
          ],
          [childActor, 'CHILD_READY', 'done'],
          // 6. VIA array ['SELECT', 'CANCEL'] (Union `{ id: string } | void`) with optional parameter method -> VALID
          [
            'selected',
            ['SELECT', 'CANCEL'],
            'idle',
            { call: (m) => m._selectOptional },
          ],
          // 7. VIA array ['CANCEL', 'RESET'] (both void) with parameterless method -> VALID
          [
            'done',
            ['CANCEL', 'RESET'],
            'idle',
            { call: (m) => m._reset },
          ],
        ],
      });

      // Compile-time negative proof 1: void event with required parameter method -> MUST BE @ts-expect-error
      createFSM<{
        events: { CANCEL: void };
        states: 'idle';
        methods: TestMethods;
      }>()({
        id: 'invalidVoidCall',
        initial: 'idle',
        transitions: [
          // @ts-expect-error — CANCEL has void payload; _selectDrink requires { id: string }!
          ['idle', 'CANCEL', 'idle', { call: (m) => m._selectDrink }],
        ],
      });

      // Compile-time negative proof 2: payload event with incompatible parameter type -> MUST BE @ts-expect-error
      createFSM<{
        events: { SELECT: { readonly id: string } };
        states: 'idle';
        methods: TestMethods;
      }>()({
        id: 'invalidWrongParamType',
        initial: 'idle',
        transitions: [
          // @ts-expect-error — SELECT payload is { id: string }, not number!
          ['idle', 'SELECT', 'idle', { call: (m) => m._wrongParamType }],
        ],
      });

      // Compile-time negative proof 3: VIA array ['SELECT', 'CANCEL'] (Union `{ id: string } | void`) with non-optional parameter method -> MUST BE @ts-expect-error
      createFSM<{
        events: {
          SELECT: { readonly id: string };
          CANCEL: void;
        };
        states: 'idle';
        methods: TestMethods;
      }>()({
        id: 'invalidMixedUnionCall',
        initial: 'idle',
        transitions: [
          // @ts-expect-error — CANCEL is void, so _selectDrink(drink: { id: string }) is unsafe when CANCEL fires!
          ['idle', ['SELECT', 'CANCEL'], 'idle', { call: (m) => m._selectDrink }],
        ],
      });

      // Verify runtime execution of VIA arrays!
      const calls: string[] = [];
      const instance = createMachineInstance(validFsm, {
        context: { count: 0, lastId: null },
        methods: {
          _reset: () => calls.push('reset'),
          _logOptional: (r?: string) => calls.push(`log:${r ?? 'none'}`),
          _selectDrink: (d: { readonly id: string }) => calls.push(`select:${d.id}`),
          _wrongParamType: () => undefined,
          _twoRequired: () => undefined,
          _selectOptional: (d?: { readonly id: string }) => calls.push(`opt:${d?.id ?? 'void'}`),
        },
      });

      expect(validFsm.hasTransitionFor('selected', 'SELECT')).toBe(true);
      expect(validFsm.hasTransitionFor('selected', 'CANCEL')).toBe(true);
      expect(validFsm.hasTransitionFor('done', 'RESET')).toBe(true);

      instance.send('SELECT', { id: 'latte' });
      expect(instance.state()).toBe('selected');
      expect(calls).toEqual(['select:latte']);

      instance.send('CANCEL');
      expect(instance.state()).toBe('idle');
      expect(calls).toEqual(['select:latte', 'opt:void']);
    });
  });

  describe('Cycle 26: Eventless Conditional Branching (always()) with Infinite-Loop Guard', () => {
    it('synchronously branches on state entry via always() in the same microstep', () => {
      const cartFsm = createFSM<{
        context: { readonly items: string[] };
        events: { CHECK: void };
        states: 'idle' | 'checkingCart' | 'checkout' | 'emptyCart';
      }>()({
        id: 'cartBranching',
        initial: 'idle',
        context: { items: [] as string[] },
        transitions: [
          ['idle',         'CHECK',  'checkingCart'],
          ['checkingCart', always(), 'checkout',  { guard: (ctx) => ctx.items.length > 0 }],
          ['checkingCart', always(), 'emptyCart'],
        ],
      });

      const emptyInstance = createMachineInstance(cartFsm, {
        context: { items: [] },
      });
      emptyInstance.send('CHECK');
      expect(emptyInstance.state()).toBe('emptyCart');

      const nonEmptyInstance = createMachineInstance(cartFsm, {
        context: { items: ['Espresso'] },
      });
      nonEmptyInstance.send('CHECK');
      expect(nonEmptyInstance.state()).toBe('checkout');
    });

    it('throws MatrixFsmInfiniteLoopError after MAX_SYNC_MICROSTEPS = 100 on cyclic unguarded always() transitions', () => {
      const cyclicFsm = createFSM<{
        events: { START: void };
        states: 'idle' | 'a' | 'b';
      }>()({
        id: 'cyclicAlways',
        initial: 'idle',
        transitions: [
          ['idle', 'START',  'a'],
          ['a',    always(), 'b'],
          ['b',    always(), 'a'],
        ],
      });

      const instance = createMachineInstance(cyclicFsm);
      expect(() => instance.send('START')).toThrowError(
        MatrixFsmInfiniteLoopError,
      );
    });
  });

  describe('Cycles 27, 28 & 30: Snapshot Persistence, toMermaid(), inspect Telemetry & getShortestPaths()', () => {
    it('supports getSnapshot() and restoreSnapshot() on createMachineInstance and restarts after(ms) timers on restored state', () => {
      vi.useFakeTimers();
      try {
        const timerFsm = createFSM<{
          context: { readonly step: number };
          events: { NEXT: void };
          states: 'idle' | 'waiting' | 'completed';
          methods: { _inc: () => void };
        }>()({
          id: 'snapMachine',
          initial: 'idle',
          context: { step: 0 },
          transitions: [
            ['idle',    'NEXT',      'waiting',   { call: (m) => m._inc }],
            ['waiting', after(1000), 'completed', { call: (m) => m._inc }],
          ],
        });

        let step = 0;
        const instA = createMachineInstance(timerFsm, {
          getContext: () => ({ step }),
          methods: {
            _inc: () => {
              step += 1;
            },
          },
        });

        instA.send('NEXT');
        expect(instA.state()).toBe('waiting');
        expect(instA.context().step).toBe(1);

        const snap = instA.getSnapshot();
        expect(snap.state).toBe('waiting');
        expect(snap.context).toEqual({ step: 1 });
        instA.destroy();

        let stepB = 0;
        const instB = createMachineInstance(timerFsm, {
          getContext: () => ({ step: stepB }),
          methods: {
            _inc: () => {
              stepB += 1;
            },
          },
        });
        expect(instB.state()).toBe('idle');

        stepB = snap.context.step;
        instB.restoreSnapshot(snap);
        expect(instB.state()).toBe('waiting');
        expect(instB.context().step).toBe(1);

        // Restoring into 'waiting' must re-arm the after(1000) timer!
        vi.advanceTimersByTime(1000);
        expect(instB.state()).toBe('completed');
        expect(instB.context().step).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('renders always(), VIA arrays, awaiting(), after(ms), all(), and finalState() in toMermaid(fsm)', () => {
      const subA = createFSM<{
        events: { FINISH_A: void };
        states: 'workingA';
      }>()({
        id: 'barista',
        initial: 'workingA',
        transitions: [['workingA', 'FINISH_A', finalState()]],
      });
      const subB = createFSM<{
        events: { FINISH_B: void };
        states: 'workingB';
      }>()({
        id: 'bakery',
        initial: 'workingB',
        transitions: [['workingB', 'FINISH_B', finalState()]],
      });

      const fullFsm = createFSM<{
        context: { readonly vip: boolean };
        events: {
          ORDER: void;
          CANCEL: void;
          ABORT: void;
        };
        states: 'idle' | 'checking' | 'preparing' | 'done';
        methods: { _checkOrder(): void };
      }>()({
        id: 'shopFlow',
        initial: 'idle',
        context: { vip: false },
        transitions: [
          ['idle',            'ORDER',              awaiting('checking'), { call: (m) => m._checkOrder }],
          ['checking',        'DONE',               'preparing'],
          ['preparing',       always(),             all(subA, subB), { guard: (ctx) => ctx.vip }],
          ['preparing',       after(500),           all(subA, subB)],
          [all(subA, subB),   'ALL_DONE',           finalState()],
          ['preparing',       ['CANCEL', 'ABORT'],  'idle'],
        ],
      });

      const diagram = toMermaid(fullFsm);
      expect(diagram).toContain('stateDiagram-v2');
      expect(diagram).toContain('[*] --> idle');
      expect(diagram).toContain('state "⚡ checking" as checking');
      expect(diagram).toContain('state "⇉ all(barista, bakery)" as all_barista_bakery');
      expect(diagram).toContain('preparing --> all_barista_bakery : always()');
      expect(diagram).toContain('preparing --> all_barista_bakery : after(500ms)');
      expect(diagram).toContain('preparing --> idle : CANCEL | ABORT');
      expect(diagram).toContain('all_barista_bakery --> [*] : ALL_DONE (DONE)');
    });

    it('computes deterministic shortest event paths via getShortestPaths(fsm) and emits inspect telemetry events', () => {
      const fsm = createFSM<{
        context: { readonly count: number };
        events: {
          SELECT: { readonly item: string };
          PAY: void;
          RESET: void;
        };
        states: 'browsing' | 'selected' | 'paid' | 'receipt';
        methods: { _select: (p: { readonly item: string }) => void };
      }>()({
        id: 'checkoutPaths',
        initial: 'browsing',
        context: { count: 0 },
        transitions: [
          ['browsing', 'SELECT',   'selected', { call: (m) => m._select }],
          ['selected', 'PAY',      'paid'],
          ['paid',     always(),   'receipt'],
          ['receipt',  'RESET',    'browsing'],
        ],
      });

      const paths = getShortestPaths(fsm);
      expect(paths['browsing']).toEqual([]);
      expect(paths['selected']).toEqual([
        { from: 'browsing', via: 'SELECT', to: 'selected', hasGuard: false },
      ]);
      expect(paths['paid']).toEqual([
        { from: 'browsing', via: 'SELECT', to: 'selected', hasGuard: false },
        { from: 'selected', via: 'PAY', to: 'paid', hasGuard: false },
      ]);
      expect(paths['receipt']).toEqual([
        { from: 'browsing', via: 'SELECT', to: 'selected', hasGuard: false },
        { from: 'selected', via: 'PAY', to: 'paid', hasGuard: false },
      ]);

      const telemetry: Array<{
        readonly machineId: string;
        readonly from: string;
        readonly via: string;
        readonly to: string;
        readonly payload: unknown;
        readonly nextContext: unknown;
      }> = [];

      let count = 0;
      const inst = createMachineInstance(fsm, {
        getContext: () => ({ count }),
        methods: {
          _select: () => {
            count += 1;
          },
        },
        inspect: (ev) => telemetry.push(ev),
      });

      inst.send('SELECT', { item: 'Muffin' });
      expect(inst.state()).toBe('selected');

      inst.send('PAY');
      expect(inst.state()).toBe('receipt');

      expect(telemetry).toHaveLength(3);
      expect(telemetry[0]).toMatchObject({
        machineId: 'checkoutPaths',
        from: 'browsing',
        via: 'SELECT',
        to: 'selected',
        payload: { item: 'Muffin' },
        nextContext: { count: 1 },
      });
      expect(telemetry[1]).toMatchObject({
        machineId: 'checkoutPaths',
        from: 'selected',
        via: 'PAY',
        to: 'paid',
      });
      expect(telemetry[2]).toMatchObject({
        machineId: 'checkoutPaths',
        from: 'paid',
        via: '__always__',
        to: 'receipt',
      });
    });
  });

  describe('Cycle 31 (Masterplan Cycle 1): Type Soundness for Combinators, each(), Terminal-Only Output Payloads & any() Error Validation', () => {
    it('strictly filters combinator and each() output payloads to terminal outputs only (excluding stay() outputs), supports flat and actor-keyed combinator inputs, and enforces ERROR handler for any()', () => {
      const subBarista = createFSM<{
        inputs: { readonly drink: string };
        outputs: {
          PROGRESS: { readonly percent: number };
          COFFEE_READY: { readonly cup: string };
        };
        events: { STEP: void; FINISH: void };
      }>()({
        id: 'subBarista',
        initial: 'brewing',
        transitions: [
          ['brewing', 'STEP', stay(), { output: ['PROGRESS', () => ({ percent: 50 })] }],
          ['brewing', 'FINISH', finalState(), { output: ['COFFEE_READY', () => ({ cup: 'Espresso' })] }],
        ],
      });

      const subBakery = createFSM<{
        inputs: { readonly dough: string };
        outputs: {
          BAKERY_READY: { readonly pastry: string };
        };
        events: { BAKE_DONE: void };
      }>()({
        id: 'subBakery',
        initial: 'baking',
        transitions: [
          ['baking', 'BAKE_DONE', finalState(), { output: ['BAKERY_READY', () => ({ pastry: 'Croissant' })] }],
        ],
      });

      const parentFlatAndKeyed = createFSM<{
        context: { readonly items: readonly { readonly id: string; readonly drink: string }[] };
        events: {
          START_ALL_FLAT: void;
          START_ALL_KEYED: void;
          START_RACE: void;
          START_ANY: void;
          START_EACH: void;
        };
        methods: {
          _onAllDone: (payload: {
            readonly subBarista: { readonly cup: string };
            readonly subBakery: { readonly pastry: string };
          }) => void;
          _onRaceDone: (payload: { readonly cup: string } | { readonly pastry: string }) => void;
          _onAnyDone: (payload: { readonly cup: string } | { readonly pastry: string }) => void;
          _onEachDone: (payload: ReadonlyArray<{ readonly cup: string }>) => void;
          // Wrong handlers that expect intermediate PROGRESS payload or non-array each payload:
          _wrongAllWithProgress: (payload: { readonly percent: number }) => void;
          _wrongEachSingle: (payload: { readonly cup: string }) => void;
        };
      }>()({
        id: 'parentCombinatorTypes',
        initial: 'idle',
        context: { items: [{ id: '1', drink: 'Latte' }] },
        transitions: [
          // 1a. Flat merged input into all(subBarista, subBakery)
          [
            'idle',
            'START_ALL_FLAT',
            all(subBarista, subBakery),
            { input: () => ({ drink: 'Espresso', dough: 'Puff' }) },
          ],
          // 1b. Actor-keyed input into all(subBarista, subBakery)
          [
            'idle',
            'START_ALL_KEYED',
            all(subBarista, subBakery),
            {
              input: () => ({
                subBarista: { drink: 'Espresso' },
                subBakery: { dough: 'Puff' },
              }),
            },
          ],
          // 1c. Terminal-only ALL_DONE payload on all(subBarista, subBakery)
          [
            all(subBarista, subBakery),
            'ALL_DONE',
            'done',
            { call: (m) => m._onAllDone },
          ],
          // 2. race() terminal-only union payload
          [
            'idle',
            'START_RACE',
            race(subBarista, subBakery),
            { input: () => ({ drink: 'Espresso', dough: 'Puff' }) },
          ],
          [
            race(subBarista, subBakery),
            'DONE',
            'done',
            { call: (m) => m._onRaceDone },
          ],
          // 3. any() with required ERROR handler
          [
            'idle',
            'START_ANY',
            any(subBarista, subBakery),
            { input: () => ({ drink: 'Espresso', dough: 'Puff' }) },
          ],
          [
            any(subBarista, subBakery),
            'DONE',
            'done',
            { call: (m) => m._onAnyDone },
          ],
          [any(subBarista, subBakery), 'ERROR', 'failed'],
          // 4. each() terminal-only array payload
          ['idle', 'START_EACH', each('items', subBarista)],
          [
            each('items', subBarista),
            'ALL_DONE',
            'done',
            { call: (m) => m._onEachDone },
          ],
        ],
      });

      expect(parentFlatAndKeyed.id).toBe('parentCombinatorTypes');

      // Compile-time error when intermediate PROGRESS handler is used on ALL_DONE or single item handler on each()
      createFSM<{
        context: { readonly items: readonly { readonly id: string; readonly drink: string }[] };
        events: { GO: void };
        methods: {
          _wrongAllWithProgress: (payload: { readonly percent: number }) => void;
          _wrongEachSingle: (payload: { readonly cup: string }) => void;
        };
      }>()({
        id: 'invalidPayloads',
        initial: 'idle',
        context: { items: [] },
        transitions: [
          // @ts-expect-error Missing required input for all(subBarista, subBakery)
          ['idle', 'GO', all(subBarista, subBakery)],
          [
            all(subBarista, subBakery),
            'ALL_DONE',
            'done',
            // @ts-expect-error _wrongAllWithProgress is incompatible with { subBarista: { cup: string }, subBakery: { pastry: string } }
            { call: (m) => m._wrongAllWithProgress },
          ],
          [
            each('items', subBarista),
            'ALL_DONE',
            'done',
            // @ts-expect-error _wrongEachSingle expects single object instead of ReadonlyArray<{ cup: string }>
            { call: (m) => m._wrongEachSingle },
          ],
        ],
      });

      // Compile-time error when any() is missing 'ERROR' exit handler
      createFSM<{
        events: { GO: void };
      }>()({
        id: 'missingAnyErrorHandler',
        initial: 'idle',
        transitions: [
          [
            'idle',
            'GO',
            // @ts-expect-error any() requires 'ERROR' handler in transitions
            any(subBarista, subBakery),
            { input: () => ({ drink: 'A', dough: 'B' }) },
          ],
          [any(subBarista, subBakery), 'DONE', 'done'],
        ],
      });
    });
  });

  describe('Cycle 32 (Masterplan Cycle 2): Column 1 (FROM) State Array Support ([["stateA", "stateB"], "EVENT", "target"])', () => {
    it('supports arrays of states and actors in Column 1 (FROM) at compile time, runtime, toMermaid(), and getShortestPaths()', () => {
      let resetCount = 0;

      const fsm = createFSM<{
        events: {
          START: void;
          NEXT: void;
          FAIL: void;
          RESET: void;
        };
        states: 'idle' | 'step1' | 'step2' | 'error';
        methods: {
          _onReset: () => void;
        };
      }>()({
        id: 'fromArrayFsm',
        initial: 'idle',
        transitions: [
          ['idle', 'START', 'step1'],
          ['step1', 'NEXT', 'step2'],
          [['step1', 'step2'], 'FAIL', 'error'],
          [
            ['step1', 'step2', 'error'],
            'RESET',
            'idle',
            { call: (m) => m._onReset },
          ],
        ],
      });

      const inst = createMachineInstance(fsm, {
        methods: {
          _onReset: () => {
            resetCount += 1;
          },
        },
      });

      inst.send('START');
      expect(inst.state()).toBe('step1');

      inst.send('RESET');
      expect(inst.state()).toBe('idle');
      expect(resetCount).toBe(1);

      inst.send('START');
      inst.send('NEXT');
      expect(inst.state()).toBe('step2');

      inst.send('FAIL');
      expect(inst.state()).toBe('error');

      inst.send('RESET');
      expect(inst.state()).toBe('idle');
      expect(resetCount).toBe(2);

      const mermaid = toMermaid(fsm);
      expect(mermaid).toContain('step1 --> error : FAIL');
      expect(mermaid).toContain('step2 --> error : FAIL');
      expect(mermaid).toContain('step1 --> idle : RESET');
      expect(mermaid).toContain('step2 --> idle : RESET');
      expect(mermaid).toContain('error --> idle : RESET');

      const paths = getShortestPaths(fsm);
      expect(paths['error']).toEqual([
        { from: 'idle', via: 'START', to: 'step1', hasGuard: false },
        { from: 'step1', via: 'FAIL', to: 'error', hasGuard: false },
      ]);
    });
  });

  describe('Cycle 33 (Masterplan Cycle 3): each(arrayKey, childFSM) Runtime in Core & Synchronous Empty-Array [] FIFO Dispatch', () => {
    it('executes a 1:N parallel pool of child instances for each(key, childFSM) and aggregates ordered terminal outputs on ALL_DONE, and synchronously dispatches ALL_DONE with [] when array is empty', () => {
      const baristaItemFSM = createFSM<{
        inputs: {
          readonly drink: { readonly id: string; readonly name: string };
        };
        outputs: {
          COFFEE_READY: { readonly drinkName: string };
        };
        events: { BREW_DONE: void };
      }>()({
        id: 'baristaItem',
        initial: 'brewing',
        transitions: [
          [
            'brewing',
            'BREW_DONE',
            finalState(),
            { output: ['COFFEE_READY', (ctx) => ({ drinkName: ctx.drink.name })] },
          ],
        ],
      });

      const savedBatches: Array<ReadonlyArray<{ readonly drinkName: string }>> = [];
      let currentDrinks: ReadonlyArray<{ readonly id: string; readonly name: string }> = [
        { id: '1', name: 'Espresso' },
        { id: '2', name: 'Latte' },
      ];

      const batchParentFSM = createFSM<{
        context: {
          readonly drinks: ReadonlyArray<{ readonly id: string; readonly name: string }>;
        };
        events: {
          START_BATCH: void;
          BREW_DONE: void;
          RESET: void;
        };
        methods: {
          _saveAll: (results: ReadonlyArray<{ readonly drinkName: string }>) => void;
        };
      }>()({
        id: 'batchParentCore',
        initial: 'idle',
        context: { drinks: currentDrinks },
        transitions: [
          ['idle', 'START_BATCH', each('drinks', baristaItemFSM)],
          [
            each('drinks', baristaItemFSM),
            'ALL_DONE',
            'orderReady',
            { call: (m) => m._saveAll },
          ],
          ['orderReady', 'RESET', 'idle'],
        ],
      });

      const inst = createMachineInstance(batchParentFSM, {
        getContext: () => ({ drinks: currentDrinks }),
        methods: {
          _saveAll: (results) => {
            savedBatches.push(results);
          },
        },
      });

      inst.send('START_BATCH');
      expect(inst.state()).toBe('each:drinks');

      // Broadcast BREW_DONE to all active each() child instances
      inst.send('BREW_DONE');
      expect(inst.state()).toBe('orderReady');
      expect(savedBatches).toEqual([
        [{ drinkName: 'Espresso' }, { drinkName: 'Latte' }],
      ]);

      // Now test empty array [] synchronous FIFO completion:
      inst.send('RESET');
      expect(inst.state()).toBe('idle');
      currentDrinks = [];

      inst.send('START_BATCH');
      // Must complete synchronously in 0 ticks with [] payload!
      expect(inst.state()).toBe('orderReady');
      expect(savedBatches[1]).toEqual([]);
    });
  });

  describe('Cycle 34 (Masterplan Cycle 4): Recursive restoreSnapshot() for Combinators & each(), plus Keyed Combinator Inputs', () => {
    it('supports actor-keyed combinator inputs and recursively captures and restores snapshots for active combinators (all/race/any) and each() pools', () => {
      const baristaActor = createFSM<{
        inputs: { readonly drink: string };
        context: { readonly drink: string; readonly step: string };
        outputs: { COFFEE_READY: { readonly cup: string } };
        events: { GRIND_DONE: void; BREW_DONE: void };
        methods: { _markBrewing: () => void };
      }>()({
        id: 'baristaActor',
        initial: 'grinding',
        context: { drink: '', step: 'raw' },
        transitions: [
          ['grinding', 'GRIND_DONE', 'brewing', { call: (m) => m._markBrewing }],
          [
            'brewing',
            'BREW_DONE',
            finalState(),
            { output: ['COFFEE_READY', (ctx) => ({ cup: `Hot ${ctx.drink}` })] },
          ],
        ],
      });

      const bakeryActor = createFSM<{
        inputs: { readonly pastry: string };
        outputs: { BAKERY_READY: { readonly item: string } };
        events: { BAKE_DONE: void };
      }>()({
        id: 'bakeryActor',
        initial: 'baking',
        transitions: [
          [
            'baking',
            'BAKE_DONE',
            finalState(),
            { output: ['BAKERY_READY', (ctx) => ({ item: `Warm ${ctx.pastry}` })] },
          ],
        ],
      });

      let finalAllResult: {
        readonly baristaActor: { readonly cup: string };
        readonly bakeryActor: { readonly item: string };
      } | null = null;

      const orderFSM = createFSM<{
        events: {
          START: void;
          GRIND_DONE: void;
          BREW_DONE: void;
          BAKE_DONE: void;
        };
        methods: {
          _onAllDone: (res: {
            readonly baristaActor: { readonly cup: string };
            readonly bakeryActor: { readonly item: string };
          }) => void;
        };
      }>()({
        id: 'orderCombinatorSnap',
        initial: 'idle',
        transitions: [
          [
            'idle',
            'START',
            all(baristaActor, bakeryActor),
            {
              input: () => ({
                baristaActor: { drink: 'Cortado' },
                bakeryActor: { pastry: 'Croissant' },
              }),
            },
          ],
          [
            all(baristaActor, bakeryActor),
            'ALL_DONE',
            'completed',
            { call: (m) => m._onAllDone },
          ],
        ],
      });

      const inst1 = createMachineInstance(orderFSM, {
        methods: {
          _onAllDone: (res) => {
            finalAllResult = res;
          },
        },
      });

      inst1.send('START');
      expect(inst1.state()).toBe('all:baristaActor,bakeryActor');

      // Advance baristaActor to 'brewing'
      inst1.send('GRIND_DONE');
      const snap = inst1.getSnapshot();
      expect(snap.children?.['baristaActor']?.state).toBe('brewing');
      expect(snap.children?.['bakeryActor']?.state).toBe('baking');

      // Restore into a fresh instance inst2
      const inst2 = createMachineInstance(orderFSM, {
        methods: {
          _onAllDone: (res) => {
            finalAllResult = res;
          },
        },
      });
      inst2.restoreSnapshot(snap);
      expect(inst2.state()).toBe('all:baristaActor,bakeryActor');
      expect(inst2.getSnapshot().children?.['baristaActor']?.state).toBe('brewing');

      // Finish both actors from their restored states
      inst2.send('BREW_DONE');
      inst2.send('BAKE_DONE');

      expect(inst2.state()).toBe('completed');
      expect(finalAllResult).toEqual({
        baristaActor: { cup: 'Hot Cortado' },
        bakeryActor: { item: 'Warm Croissant' },
      });
    });
  });

  describe('Cycle 35 (Masterplan Cycle 5): Executable getShortestPaths() (0-Event always() Epsilon Edges), always() with output & finalState(), and Parent after(ms) on Active Sub-Actors', () => {
    it('treats always() as a 0-event epsilon edge in getShortestPaths() so returned paths contain only real triggerable events and can be replayed directly', () => {
      const subA = createFSM()({
        id: 'subPathA',
        initial: 'working',
        transitions: [['working', 'DONE_A', finalState()]],
      });
      const subB = createFSM()({
        id: 'subPathB',
        initial: 'working',
        transitions: [['working', 'DONE_B', finalState()]],
      });

      const fsm = createFSM<{
        events: { START_ALL: void };
      }>()({
        id: 'epsilonPaths',
        initial: 'step1',
        transitions: [
          ['step1', always(), 'step2'],
          ['step2', 'START_ALL', all(subA, subB)],
          [all(subA, subB), 'ALL_DONE', 'completed'],
        ],
      });

      const paths = getShortestPaths(fsm);
      // 'step2' is reached via 0 external events because always() fires automatically on entry!
      expect(paths['step1']).toEqual([]);
      expect(paths['step2']).toEqual([]);
      expect(paths['all:subPathA,subPathB']).toEqual([
        {
          from: 'step2',
          via: 'START_ALL',
          to: 'all:subPathA,subPathB',
          hasGuard: false,
        },
      ]);
      expect(paths['completed']).toEqual([
        {
          from: 'step2',
          via: 'START_ALL',
          to: 'all:subPathA,subPathB',
          hasGuard: false,
        },
        {
          from: 'all:subPathA,subPathB',
          via: 'ALL_DONE',
          to: 'completed',
          hasGuard: false,
        },
      ]);

      // Replay paths['step2'] (0 events) on a fresh instance -> lands in 'step2'!
      const inst = createMachineInstance(fsm);
      for (const step of paths['step2']) {
        inst.send(step.via);
      }
      expect(inst.state()).toBe('step2');
    });

    it('supports always() with output and finalState() in sub-actors and keeps parent after(ms) timer active across internal child transitions', () => {
      vi.useFakeTimers();
      try {
        const fastCachedChild = createFSM<{
          inputs: { readonly cached: boolean };
          outputs: {
            READY: { readonly source: string };
          };
          events: { FETCH_DONE: void };
        }>()({
          id: 'fastCachedChild',
          initial: 'checkingCache',
          transitions: [
            [
              'checkingCache',
              always(),
              finalState(),
              {
                guard: (ctx) => ctx.cached,
                output: ['READY', () => ({ source: 'cache' })],
              },
            ],
            ['checkingCache', always(), 'fetching'],
            ['fetching', after(1000), 'processing'],
            [
              'processing',
              'FETCH_DONE',
              finalState(),
              { output: ['READY', () => ({ source: 'network' })] },
            ],
          ],
        });

        let readySource: string | null = null;
        let useCache = true;

        const parentFSM = createFSM<{
          events: { START: void; FETCH_DONE: void; RESET: void };
          methods: { _onReady: (p: { readonly source: string }) => void };
        }>()({
          id: 'parentTimeoutSub',
          initial: 'idle',
          transitions: [
            [
              'idle',
              'START',
              fastCachedChild,
              { input: () => ({ cached: useCache }) },
            ],
            [
              fastCachedChild,
              'READY',
              'done',
              { call: (m) => m._onReady },
            ],
            [fastCachedChild, after(5000), 'timeout'],
            [['done', 'timeout'], 'RESET', 'idle'],
          ],
        });

        const inst = createMachineInstance(parentFSM, {
          methods: {
            _onReady: ({ source }) => {
              readySource = source;
            },
          },
        });

        // 1. Synchronous zero-tick completion via always() -> finalState() with output:
        inst.send('START');
        expect(inst.state()).toBe('done');
        expect(readySource).toBe('cache');

        // 2. Non-cached child: transitions internally at t = 1000ms ('fetching' -> 'processing'),
        //    parent's after(5000) timer is NOT cancelled by child's internal transition, and fires at t = 5000ms!
        inst.send('RESET');
        useCache = false;
        readySource = null;

        inst.send('START');
        expect(inst.state()).toBe('fastCachedChild');
        expect(inst.subState()).toBe('fetching');

        vi.advanceTimersByTime(1000);
        expect(inst.state()).toBe('fastCachedChild');
        expect(inst.subState()).toBe('processing');

        vi.advanceTimersByTime(4000);
        expect(inst.state()).toBe('timeout');
        expect(inst.subState()).toBeNull();

        // 3. When child finishes at t = 3000ms, parent's 5000ms timer is cancelled and never fires at t = 5000ms!
        inst.send('RESET');
        inst.send('START');
        vi.advanceTimersByTime(1000);
        expect(inst.subState()).toBe('processing');

        vi.advanceTimersByTime(2000);
        inst.send('FETCH_DONE');
        expect(inst.state()).toBe('done');
        expect(readySource).toBe('network');

        vi.advanceTimersByTime(5000);
        expect(inst.state()).toBe('done');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Cycle 36 (Masterplan Cycle 6): Dry-Run instance.can(event, payload?) Without Side Effects', () => {
    it('evaluates whether an event can fire in the current state or active sub-actor/combinator (including guards) without mutating state or invoking call methods', () => {
      let sideEffectCalls = 0;

      const subPayment = createFSM<{
        events: {
          CONFIRM_PIN: { readonly pin: string };
        };
      }>()({
        id: 'subPayment',
        initial: 'enteringPin',
        transitions: [
          [
            'enteringPin',
            'CONFIRM_PIN',
            finalState(),
            { guard: (_ctx, p) => p.pin.length === 4 },
          ],
        ],
      });

      const balance = 5;
      const checkoutFSM = createFSM<{
        context: { readonly balance: number };
        events: {
          PAY: { readonly price: number };
          CONFIRM_PIN: { readonly pin: string };
          CANCEL: void;
        };
        methods: {
          _deduct: () => void;
        };
      }>()({
        id: 'dryRunCanFsm',
        initial: 'cart',
        context: { balance: 5 },
        transitions: [
          [
            'cart',
            'PAY',
            subPayment,
            {
              guard: (ctx, p) => ctx.balance >= p.price,
              call: (m) => m._deduct,
            },
          ],
          [subPayment, 'DONE', 'paid'],
          [anyState(), 'CANCEL', finalState()],
        ],
      });

      const inst = createMachineInstance(checkoutFSM, {
        getContext: () => ({ balance }),
        methods: {
          _deduct: () => {
            sideEffectCalls += 1;
          },
        },
      });

      // 1. Guard returns false when balance (5) < price (10)
      expect(inst.can('PAY', { price: 10 })).toBe(false);
      // 2. Guard returns true when balance (5) >= price (5)
      expect(inst.can('PAY', { price: 5 })).toBe(true);
      // 3. Unhandled event in 'cart'
      expect(inst.can('CONFIRM_PIN', { pin: '1234' })).toBe(false);
      // 4. Wildcard anyState() event
      expect(inst.can('CANCEL')).toBe(true);
      // Verify zero side effects occurred during .can() calls!
      expect(inst.state()).toBe('cart');
      expect(sideEffectCalls).toBe(0);

      // Enter subPayment and test delegation of .can() to active sub-actor
      inst.send('PAY', { price: 5 });
      expect(inst.state()).toBe('subPayment');
      expect(sideEffectCalls).toBe(1);

      expect(inst.can('CONFIRM_PIN', { pin: '12' })).toBe(false);
      expect(inst.can('CONFIRM_PIN', { pin: '1234' })).toBe(true);
    });
  });

  describe('Cycle 51: Fix instance.can() Returning true on Pure No-Op stay() Fallbacks', () => {
    it('returns false for pure no-op stay() fallback rows (without call or output) when preceding guards fail, while returning true for stay() rows with call or output', () => {
      const cascadeFSM = createFSM<{
        context: { readonly country: string | null };
        events: {
          SELECT_CITY: string;
          SELECT_PLACE: string;
          PING: void;
        };
        outputs: {
          PONG: void;
        };
        methods: {
          _selectPlace: (place: string) => void;
          _loadPlaces: (city: string, signal: AbortSignal) => Promise<void>;
        };
      }>()({
        id: 'cascadeCanFsm',
        initial: 'idle',
        context: { country: null },
        transitions: [
          [
            'idle',
            'SELECT_CITY',
            awaiting('loadingPlaces'),
            {
              guard: (ctx) => ctx.country !== null,
              call: (m) => m._loadPlaces,
            },
          ],
          ['idle', 'SELECT_CITY', stay()], // Pure No-Op fallback for ESLint require-fallback-transition
          ['idle', 'SELECT_PLACE', stay(), { call: (m) => m._selectPlace }],
          ['idle', 'PING', stay(), { output: 'PONG' }],
          ['loadingPlaces', 'DONE', 'idle'],
          ['loadingPlaces', 'ERROR', 'idle'],
        ],
      });

      const inst = createMachineInstance(cascadeFSM);

      // Guard is false (country === null), falls through to pure no-op stay() -> can() MUST be false!
      expect(inst.can('SELECT_CITY', 'Berlin')).toBe(false);

      // stay() with call or output -> can() MUST be true!
      expect(inst.can('SELECT_PLACE', 'Alexanderplatz')).toBe(true);
      expect(inst.can('PING')).toBe(true);

      // Once country is set, guard passes -> can('SELECT_CITY') is true!
      inst.patchContext({ country: 'DE' });
      expect(inst.can('SELECT_CITY', 'Berlin')).toBe(true);
    });
  });

  describe('Cycle 52: Restrict anyState() to stay(), finalState(), or ERROR Transitions (No Hope-Driven State Jumps)', () => {
    it('rejects anyState() state jumps at compile time while allowing stay(), finalState(), and VIA === ERROR', () => {
      // Valid uses of anyState(): stay(), finalState(), and VIA === 'ERROR'
      const validGlobalFSM = createFSM<{
        events: {
          VOUCHER_SCANNED: string;
          ABORT: void;
          NEXT: void;
        };
        outputs: {
          ABORTED: void;
        };
        methods: {
          _applyVoucher: (code: string) => void;
        };
      }>()({
        id: 'validGlobalFsm',
        initial: 'step1',
        transitions: [
          ['step1', 'NEXT', 'step2'],
          [anyState(), 'VOUCHER_SCANNED', stay(), { call: (m) => m._applyVoucher }],
          [anyState(), 'ABORT', finalState('ABORTED')],
          [anyState(), 'ERROR', 'errorState'],
        ],
      });

      const inst = createMachineInstance(validGlobalFSM);
      expect(inst.state()).toBe('step1');
      inst.send('ERROR');
      expect(inst.state()).toBe('errorState');

      // Invalid Hope-Driven jumps from anyState() must fail at compile time:
      createFSM<{
        events: {
          SELECT_2: void;
          LOAD_3: void;
        };
        methods: {
          _load3: (_: void, signal: AbortSignal) => Promise<void>;
        };
      }>()({
        id: 'invalidHopeDrivenFsm',
        initial: 'step1',
        transitions: [
          // @ts-expect-error - anyState() cannot jump to a regular resting state unless VIA is 'ERROR'
          [anyState(), 'SELECT_2', 'step3'],
          // @ts-expect-error - anyState() cannot jump to awaiting() unless VIA is 'ERROR'
          [anyState(), 'LOAD_3', awaiting('loading3'), { call: (m) => m._load3 }],
          // @ts-expect-error - anyState() is forbidden inside Column 1 state arrays
          [[anyState(), 'step1'], 'SELECT_2', stay()],
          ['loading3', 'DONE', 'step3'],
          ['loading3', 'ERROR', 'step1'],
        ],
      });
    });
  });

  describe('Cycle 53: Timer-Ontologie — after(ms) Must Change State (Forbid stay()) & every(ms) for Intervals', () => {
    it('forbids after() with stay() and forbids every() without stay() at compile time, while executing dynamic every((c) => c.ms) intervals with live speed adjustment and cleanup on state exit', () => {
      vi.useFakeTimers();
      try {
        // Compile-time checks: after() forbids stay(), every() requires stay()
        createFSM<{
          context: { readonly ms: number };
          states: 'ticking' | 'done';
        }>()({
          id: 'invalidTimersFsm',
          initial: 'ticking',
          context: { ms: 1000 },
          transitions: [
            // @ts-expect-error - after() must change state (stay() is forbidden)
            ['ticking', after(1000), stay()],
            // @ts-expect-error - every() is a recurring in-place interval and requires stay()
            ['ticking', every(500), 'done'],
          ],
        });

        let ticks = 0;
        let currentSpeed = 1000;

        const tickerFSM = createFSM<{
          context: { readonly ms: number; readonly count: number };
          events: {
            START: void;
            SET_SPEED: number;
            PAUSE: void;
          };
          states: 'stopped' | 'ticking';
          methods: {
            _tick: () => void;
            _setSpeed: (speed: number) => void;
          };
        }>()({
          id: 'tickerFsm',
          initial: 'stopped',
          context: { ms: 1000, count: 0 },
          transitions: [
            ['stopped', 'START', 'ticking'],
            ['ticking', every((c) => c.ms), stay(), { call: (m) => m._tick }],
            ['ticking', 'SET_SPEED', stay(), { call: (m) => m._setSpeed }],
            ['ticking', 'PAUSE', 'stopped'],
          ],
        });

        const inst = createMachineInstance(tickerFSM, {
          getContext: () => ({ ms: currentSpeed, count: ticks }),
          methods: {
            _tick: () => {
              ticks += 1;
            },
            _setSpeed: (speed: number) => {
              currentSpeed = speed;
            },
          },
        });

        // In 'stopped', no interval runs
        vi.advanceTimersByTime(3000);
        expect(ticks).toBe(0);

        // Transition to 'ticking' (ms = 1000)
        inst.send('START');
        expect(inst.state()).toBe('ticking');

        vi.advanceTimersByTime(3000);
        expect(ticks).toBe(3);

        // Dynamically change speed from 1000ms to 200ms via stay()
        inst.send('SET_SPEED', 200);
        expect(inst.state()).toBe('ticking');

        vi.advanceTimersByTime(1000);
        expect(ticks).toBe(8); // 3 + 5 ticks at 200ms

        // Transition to 'stopped' ('PAUSE') -> interval immediately cleared
        inst.send('PAUSE');
        expect(inst.state()).toBe('stopped');

        vi.advanceTimersByTime(2000);
        expect(ticks).toBe(8);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Cycle 55: Unify tasks and methods — awaiting("state") Invokes { call: (m) => m._method }', () => {
    it('executes async { call } on awaiting() in createMachineInstance with (payload, signal, ctx), aborts on state exit, and infers DONE payload from the call return type', async () => {
      let receivedSignal: AbortSignal | null = null;
      let savedCities: string[] = [];

      const cityFSM = createFSM<{
        context: { readonly region: string };
        events: {
          LOAD: string;
          CANCEL: void;
        };
        states: 'idle' | 'loading' | 'ready' | 'error';
        methods: {
          _fetchCities: (
            countryId: string,
            signal: AbortSignal,
            ctx: Readonly<{ readonly region: string }>,
          ) => Promise<string[]>;
          _setCities: (cities: string[]) => void;
          _setError: (err: unknown) => void;
        };
      }>()({
        id: 'cityFsm',
        initial: 'idle',
        context: { region: 'EU' },
        transitions: [
          ['idle', 'LOAD', awaiting('loading'), { call: (m) => m._fetchCities }],
          ['loading', 'CANCEL', 'idle'],
          ['loading', 'DONE', 'ready', { call: (m) => m._setCities }],
          ['loading', 'ERROR', 'error', { call: (m) => m._setError }],
        ],
      });

      let resolveFetch: ((cities: string[]) => void) | null = null;
      const inst = createMachineInstance(cityFSM, {
        methods: {
          _fetchCities: (countryId, signal, ctx) => {
            expect(countryId).toBe('DE');
            expect(ctx.region).toBe('EU');
            receivedSignal = signal;
            return new Promise<string[]>((resolve) => {
              resolveFetch = resolve;
            });
          },
          _setCities: (cities) => {
            savedCities = cities;
          },
          _setError: () => undefined,
        },
      });

      inst.send('LOAD', 'DE');
      expect(inst.state()).toBe('loading');
      expect(inst.isPending()).toBe(true);
      expect(receivedSignal?.aborted).toBe(false);

      // Cancel in-flight -> aborts signal and ignores stale resolution!
      inst.send('CANCEL');
      expect(inst.state()).toBe('idle');
      expect(receivedSignal?.aborted).toBe(true);
      resolveFetch?.(['Stale']);
      await Promise.resolve();
      expect(savedCities).toEqual([]);

      // Re-run and resolve -> transitions to 'ready' with typed payload
      inst.send('LOAD', 'DE');
      resolveFetch?.(['Berlin', 'Munich']);
      await new Promise((r) => setTimeout(r, 0));
      expect(inst.state()).toBe('ready');
      expect(savedCities).toEqual(['Berlin', 'Munich']);
    });
  });

  describe('Cycle 56: Named Domain Outcomes from awaiting() Calls via outcome(eventName, payload?)', () => {
    it('routes awaiting() resolution directly to the named event when outcome(eventName, payload) is returned, and infers payload in Column 4', async () => {
      const coreExports = await import('../index.js');
      const outcomeFn = (coreExports as any).outcome as <
        const E extends string,
        P = void,
      >(
        event: E,
        payload?: P,
      ) => any;
      expect(typeof outcomeFn).toBe('function');

      let challengeUrlReceived: string | null = null;
      let receiptIdReceived: string | null = null;
      let mode: '3ds' | 'approved' = '3ds';

      const paymentFSM = createFSM<{
        events: { PAY: { amount: number } };
        states: 'checkout' | 'verifying' | 'paid' | 'challenge3ds' | 'paymentFailed';
        methods: {
          _verifyPayment: (
            p: { amount: number },
            signal: AbortSignal,
          ) => Promise<
            | ReturnType<typeof outcomeFn<'APPROVED', { receiptId: string }>>
            | ReturnType<typeof outcomeFn<'REQUIRES_3DS', { challengeUrl: string }>>
          >;
          _onApproved: (p: { receiptId: string }) => void;
          _on3ds: (p: { challengeUrl: string }) => void;
        };
      }>()({
        id: 'paymentOutcomeFsm',
        initial: 'checkout',
        transitions: [
          ['checkout', 'PAY', awaiting('verifying'), { call: (m) => m._verifyPayment }],
          ['verifying', 'APPROVED', 'paid', { call: (m) => m._onApproved }],
          ['verifying', 'REQUIRES_3DS', 'challenge3ds', { call: (m) => m._on3ds }],
          ['verifying', 'ERROR', 'paymentFailed'],
        ],
      });

      const inst = createMachineInstance(paymentFSM, {
        methods: {
          _verifyPayment: async () => {
            if (mode === '3ds') {
              return outcomeFn('REQUIRES_3DS', {
                challengeUrl: 'https://3ds.example.com/challenge',
              });
            }
            return outcomeFn('APPROVED', { receiptId: 'RCP-99' });
          },
          _onApproved: ({ receiptId }) => {
            receiptIdReceived = receiptId;
          },
          _on3ds: ({ challengeUrl }) => {
            challengeUrlReceived = challengeUrl;
          },
        },
      });

      inst.send('PAY', { amount: 42 });
      await new Promise((r) => setTimeout(r, 0));
      expect(inst.state()).toBe('challenge3ds');
      expect(challengeUrlReceived).toBe('https://3ds.example.com/challenge');

      inst.reset();
      mode = 'approved';
      inst.send('PAY', { amount: 42 });
      await new Promise((r) => setTimeout(r, 0));
      expect(inst.state()).toBe('paid');
      expect(receiptIdReceived).toBe('RCP-99');
    });
  });
});
