import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  awaiting,
  createFSM,
  createMachineInstance,
  each,
  finalState,
  stay,
  toMermaid,
  transitions,
  type ExtractAllContext,
  type ExtractAllMethods,
  type ExtractAwaitingNodes,
  type ExtractContext,
  type ExtractEvents,
  type ExtractFinalOutcomes,
  type ExtractMethods,
  type ExtractStates,
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
        // @ts-expect-error - 'TYPO_OUTCOME' is not a finalState of paymentSub or an event of parent
        [paymentSub, 'TYPO_OUTCOME', 'orderConfirmed'],
      ],
    });

    const exitedStates: string[] = [];
    const instance = createMachineInstance(checkoutFSM, {
      initialContext: { files: ['f1', 'f2'], progress: 0 },
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
    }>()({
      id: 'barista',
      initial: 'ticketQueued',
      // prettier-ignore
      transitions: [
        ['ticketQueued',  'START_BREWING',  awaiting('brewingCoffee'), { output: 'STEAM_READY' }],
        ['brewingCoffee', 'TICK_PROGRESS',  stay(),                    { patch: (ctx, ev: { readonly delta: number }) => ({ percent: ctx.percent + ev.delta }), output: ['PROGRESS', (ctx, ev: { readonly delta: number }) => ({ percent: ctx.percent + ev.delta - ev.delta })] }],
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
      // @ts-expect-error - Missing required transition rows for sub-machine output(s)
      transitions: [
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
        _onReady: (out) => {
          readyOutput = out;
        },
        _onProgress: (out) => {
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
        ['idle',        'PAY',          strictBarista, { input: (ctx) => ({ selectedDrink: ctx.drink }) }],
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
});
