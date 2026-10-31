import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  after,
  all,
  any,
  anyState,
  awaiting,
  createFSM,
  createMachineInstance,
  each,
  finalState,
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
    ['loginView',         'LOGIN',                awaiting('authenticating'), { guard: hasValidInput }],
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
        ['enteringCard',  'PAY',    awaiting('chargingCard')],
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
    }>()({
      id: 'uploadItem',
      initial: 'queued',
      transitions: [
        ['queued',     'START',  awaiting('uploading')],
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
      CheckoutMethods & PaymentMethods
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
      ['loginView', 'LOGIN', awaiting('authenticating'), { guard: hasValidInput }],
      ['loginView', 'LOGIN', stay(),                    { call: (m) => m._setInvalidEmail }],
    ]);

    const handleByMachineType = transitions<typeof authFSM>([
      ['loginView', 'LOGIN', 'ssoRedirect',             { guard: hasValidInput }],
      ['loginView', 'LOGIN', 'mfaChallenge',            { guard: shouldShowPromo }],
      ['loginView', 'LOGIN', awaiting('authenticating'), { guard: hasValidInput }],
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
        _tickProgress(ev: { readonly delta: number }, ctx: BaristaInputs & { temp: number; percent: number }): void;
      };
    }>()({
      id: 'barista',
      initial: 'ticketQueued',
      // prettier-ignore
      transitions: [
        ['ticketQueued',  'START_BREWING',  awaiting('brewingCoffee'), { output: 'STEAM_READY' }],
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
          [anyState(),   'LOGOUT', 'loggedOut',      { call: (m) => m._forceLogout }],
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
      expect(diagram).toContain('anyState --> loggedOut : LOGOUT');
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
});
