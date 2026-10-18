/**
 * Layer 3 (Feature): Pure FSM Definition (auth.machine.ts)
 * 0% Angular DI, 100% static analyzability (Mermaid exportable)
 */

import { awaiting, createFSM, stay } from '@matrix-fsm/core';
import type { Credentials, User, UserEntitlements } from '../../core';

export interface AuthContext {
  credentials: Credentials;
  user: User | null;
  policy: UserEntitlements;
  error: string | null;
}

// Pure guards (0% DI, reads only ctx):
const hasValidInput = (ctx: AuthContext) => ctx.credentials.email.includes('@');
const shouldShowPromo = (ctx: AuthContext) => ctx.policy.showUpsellAds;

// Pure patches (0% DI, named functions preserve single-line 4-column matrix layout):
const patchCredentials = (ctx: AuthContext, payload: Partial<Credentials>) => ({
  credentials: { ...ctx.credentials, ...payload },
  error: null,
});
const patchInvalidEmail = () => ({ error: 'Invalid email' });
const patchErrorMessage = (_ctx: AuthContext, err: Error) => ({ error: err.message });
const patchLogout = () => ({ user: null, error: null });

export const authFSM = createFSM({
  id: 'auth',
  initial: 'loginView',
  events: {} as {
    UPDATE_CREDENTIALS: Partial<Credentials>;
    LOGIN: void;
    DISMISS_PROMO: void;
    CANCEL: void;
    RETRY: void;
    LOGOUT: void;
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
  } satisfies AuthContext as AuthContext,
  // prettier-ignore
  transitions: [
    /* FROM               VIA                     TO                           OPTIONS */
    ['loginView',         'UPDATE_CREDENTIALS',   stay(),                      { patch: patchCredentials }],
    ['loginView',         'LOGIN',                awaiting('authenticating'),  { guard: hasValidInput }],
    ['loginView',         'LOGIN',                stay(),                      { patch: patchInvalidEmail }],

    // User cancels in-flight request -> Engine automatically aborts Effect fiber / AbortSignal:
    ['authenticating',    'CANCEL',               'loginView'],

    // Task succeeded ('DONE') -> Task return value is already merged into ctx before guards run!
    ['authenticating',    'DONE',                 'proUpsellPromo',            { guard: shouldShowPromo }],
    ['authenticating',    'DONE',                 'loggedIn'],

    // Task failed ('ERROR' or Effect TaggedError _tag):
    ['authenticating',    'NetworkTimeoutError',  'offlineRetryView'],
    ['authenticating',    'ERROR',                'loginView',                 { patch: patchErrorMessage }],

    ['offlineRetryView',  'RETRY',                awaiting('authenticating')],
    ['offlineRetryView',  'CANCEL',               'loginView'],

    ['proUpsellPromo',    'DISMISS_PROMO',        'loggedIn'],
    ['loggedIn',          'LOGOUT',               'loginView',                 { patch: patchLogout }],
  ],
});
