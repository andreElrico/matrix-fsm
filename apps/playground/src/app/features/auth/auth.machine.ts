/**
 * Layer 3 (Feature): Pure FSM Definition (auth.machine.ts)
 * 0% Angular DI, Zero JSON Dummy Objects, 100% static analyzability (Mermaid exportable)
 */

import { awaiting, createFSM, stay } from '@matrix-fsm/core';
import type { Credentials, User, UserEntitlements } from '../../core';

export interface AuthContext {
  credentials: Credentials;
  user: User | null;
  policy: UserEntitlements;
  error: string | null;
}

export const initialAuthContext: AuthContext = {
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

export type AuthStates =
  | 'loginView'
  | 'authenticating'
  | 'proUpsellPromo'
  | 'offlineRetryView'
  | 'loggedIn';

export type AuthEvents = {
  UPDATE_CREDENTIALS: Partial<Credentials>;
  LOGIN: void;
  DISMISS_PROMO: void;
  CANCEL: void;
  RETRY: void;
  LOGOUT: void;
  NetworkTimeoutError: { message: string };
};

export type AuthMethods = {
  _updateCredentials(payload: Partial<Credentials>): void;
  _setInvalidEmail(): void;
  _setErrorMessage(err: Error): void;
  _logout(): void;
};

// Pure guards (0% DI, reads only ctx):
const hasValidInput = (ctx: AuthContext) => ctx.credentials.email.includes('@');
const shouldShowPromo = (ctx: AuthContext) => ctx.policy.showUpsellAds;

export const authFSM = createFSM<
  AuthEvents,
  AuthContext,
  AuthStates,
  AuthMethods
>()({
  id: 'auth',
  initial: 'loginView',
  // prettier-ignore
  transitions: [
    /* FROM               VIA                     TO                           OPTIONS */
    ['loginView',         'UPDATE_CREDENTIALS',   stay(),                      { call: (m) => m._updateCredentials }],
    ['loginView',         'LOGIN',                awaiting('authenticating'),  { guard: hasValidInput }],
    ['loginView',         'LOGIN',                stay(),                      { call: (m) => m._setInvalidEmail }],

    // User cancels in-flight request -> Engine automatically aborts Effect fiber / AbortSignal:
    ['authenticating',    'CANCEL',               'loginView'],

    // Task succeeded ('DONE') -> Task return value is already merged into ctx before guards run!
    ['authenticating',    'DONE',                 'proUpsellPromo',            { guard: shouldShowPromo }],
    ['authenticating',    'DONE',                 'loggedIn'],

    // Task failed ('ERROR' or Effect TaggedError _tag):
    ['authenticating',    'NetworkTimeoutError',  'offlineRetryView'],
    ['authenticating',    'ERROR',                'loginView',                 { call: (m) => m._setErrorMessage }],

    ['offlineRetryView',  'RETRY',                awaiting('authenticating')],
    ['offlineRetryView',  'CANCEL',               'loginView'],

    ['proUpsellPromo',    'DISMISS_PROMO',        'loggedIn'],
    ['loggedIn',          'LOGOUT',               'loginView',                 { call: (m) => m._logout }],
  ],
});
