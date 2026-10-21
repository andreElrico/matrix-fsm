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
        [paymentSub,                 'DONE',          'orderConfirmed'],
      ],
    });

    // Verify recursive intersection of Context, Methods, States, and Events:
    expectTypeOf<ExtractContext<typeof checkoutFSM>>().toEqualTypeOf<
      CheckoutContext & { progress: number }
    >();
    expectTypeOf<ExtractMethods<typeof checkoutFSM>>().toEqualTypeOf<
      CheckoutMethods & PaymentMethods
    >();
    expectTypeOf<ExtractEvents<typeof checkoutFSM>>().toEqualTypeOf<
      'UPLOAD_FILES' | 'CANCEL' | 'PAY' | 'START'
    >();
    expectTypeOf<'enteringCard'>().toExtend<ExtractStates<typeof checkoutFSM>>();
    expectTypeOf<'cart'>().toExtend<ExtractStates<typeof checkoutFSM>>();

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

    const instance = createMachineInstance(checkoutFSM, {
      initialContext: { files: ['f1', 'f2'], progress: 0 },
    });
    expect(instance.state()).toBe('cart');

    instance.send('UPLOAD_FILES');
    expect(instance.state()).toBe('each:files');

    instance.send('ALL_DONE');
    expect(instance.state()).toBe('payment');
    expect(instance.subState()).toBe('enteringCard');

    // Group interrupt from parent
    instance.send('CANCEL');
    expect(instance.state()).toBe('cart');
    expect(instance.subState()).toBeNull();

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
});
