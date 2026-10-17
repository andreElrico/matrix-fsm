import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  awaiting,
  createFSM,
  createMachineInstance,
  each,
  finalState,
  stay,
  subMachine,
  toMermaid,
  transitions,
  type ExtractAwaitingNodes,
  type ExtractContext,
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

const hasValidInput = (ctx: AuthContext) => ctx.credentials.email.includes('@');
const shouldShowPromo = (ctx: AuthContext) => ctx.policy.showUpsellAds;

const handleLoginSubmit = transitions<AuthContext>([
  ['loginView', 'LOGIN', awaiting('authenticating'), { guard: hasValidInput }],
  ['loginView', 'LOGIN', stay(), { patch: () => ({ error: 'Invalid email' }) }],
]);

const authFSM = createFSM({
  id: 'auth',
  initial: 'loginView',
  events: {} as {
    LOGIN: void;
    DISMISS_PROMO: void;
    CANCEL: void;
    NetworkTimeoutError: { message: string };
  },
  context: {
    credentials: { email: '', password: '' },
    user: null,
    policy: {
      showUpsellAds: true,
      canBypassApproval: false,
      discountPercent: 0,
      maxProjects: 3,
    },
    error: null,
  } satisfies AuthContext,
  transitions: [
    ...handleLoginSubmit,
    ['authenticating', 'CANCEL', 'loginView'],
    ['authenticating', 'DONE', 'proUpsellPromo', { guard: shouldShowPromo }],
    ['authenticating', 'DONE', 'loggedIn'],
    ['authenticating', 'NetworkTimeoutError', 'offlineRetryView'],
    [
      'authenticating',
      'ERROR',
      'loginView',
      {
        patch: (_ctx, err: Error) => ({ error: err.message }),
      },
    ],
    ['proUpsellPromo', 'DISMISS_PROMO', 'loggedIn'],
  ],
});

describe('@matrix-fsm/core', () => {
  it('extracts states, awaiting nodes, and required tasks at compile time and runtime', () => {
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

  it('evaluates First-Match-Wins and handles stay() without changing state', () => {
    const instance = createMachineInstance(authFSM);
    expect(instance.state()).toBe('loginView');

    // Invalid email -> matches 2nd row (stay() + patch error)
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

  it('supports subMachine() and finalState() with group interrupts', () => {
    const paymentSub = subMachine({
      id: 'payment',
      initial: 'enteringCard',
      context: { cardValid: true },
      transitions: [
        ['enteringCard', 'PAY', awaiting('chargingCard')],
        ['chargingCard', 'DONE', finalState('PAID')],
        ['chargingCard', 'ERROR', 'enteringCard'],
      ],
    });

    const uploadChild = createFSM({
      id: 'uploadItem',
      initial: 'queued',
      context: { progress: 0 },
      transitions: [
        ['queued', 'START', awaiting('uploading')],
        ['uploading', 'DONE', finalState('UPLOADED')],
        ['uploading', 'ERROR', 'failed'],
      ],
    });

    const checkoutFSM = createFSM({
      id: 'checkout',
      initial: 'cart',
      context: { files: ['f1', 'f2'] },
      transitions: [
        ['cart', 'UPLOAD_FILES', each('files', uploadChild)],
        [each('files', uploadChild), 'ALL_DONE', paymentSub],
        [paymentSub, 'CANCEL', 'cart'],
        [paymentSub, 'PAID', 'orderConfirmed'],
        [paymentSub, 'DONE', 'orderConfirmed'],
      ],
    });

    const instance = createMachineInstance(checkoutFSM);
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
