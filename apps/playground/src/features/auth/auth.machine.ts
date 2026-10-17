/**
 * Layer 3 (Feature): Pure FSM Definition (auth.machine.ts)
 * 0% Angular DI, 100% static analyzability (Mermaid exportable)
 */

import { awaiting, createFSM, stay, transitions } from '@matrix-fsm/core';
import type {
  Credentials,
  User,
  UserEntitlements,
} from '../../core/index.js';

export interface AuthContext {
  credentials: Credentials;
  user: User | null;
  policy: UserEntitlements;
  error: string | null;
}

// Pure guards (0% DI, reads only ctx):
const hasValidInput = (ctx: AuthContext) => ctx.credentials.email.includes('@');
const shouldShowPromo = (ctx: AuthContext) => ctx.policy.showUpsellAds;

// Extracted transition group (100% typed & linted):
const handleLoginSubmit = transitions<AuthContext>([
  ['loginView', 'LOGIN', awaiting('authenticating'), { guard: hasValidInput }],
  ['loginView', 'LOGIN', stay(), { patch: () => ({ error: 'Invalid email' }) }],
]);

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
  } satisfies AuthContext,
  transitions: [
    /* FROM              VIA                      TO                          OPTIONS */
    [
      'loginView',
      'UPDATE_CREDENTIALS',
      stay(),
      {
        patch: (ctx, payload: Partial<Credentials>) => ({
          credentials: { ...ctx.credentials, ...payload },
          error: null,
        }),
      },
    ],

    ...handleLoginSubmit,

    // User cancels in-flight request -> Engine automatically aborts Effect fiber / AbortSignal:
    ['authenticating', 'CANCEL', 'loginView'],

    // Task succeeded ('DONE') -> Task return value is already merged into ctx before guards run!
    ['authenticating', 'DONE', 'proUpsellPromo', { guard: shouldShowPromo }],
    ['authenticating', 'DONE', 'loggedIn'], // Mandatory unguarded fallback

    // Task failed ('ERROR' or Effect TaggedError _tag):
    ['authenticating', 'NetworkTimeoutError', 'offlineRetryView'],
    [
      'authenticating',
      'ERROR',
      'loginView',
      {
        patch: (_ctx, err: Error) => ({ error: err.message }),
      },
    ],

    ['offlineRetryView', 'RETRY', awaiting('authenticating')],
    ['offlineRetryView', 'CANCEL', 'loginView'],

    ['proUpsellPromo', 'DISMISS_PROMO', 'loggedIn'],

    [
      'loggedIn',
      'LOGOUT',
      'loginView',
      {
        patch: () => ({ user: null, error: null }),
      },
    ],
  ],
});
