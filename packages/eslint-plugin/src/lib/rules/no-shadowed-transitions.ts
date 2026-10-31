/**
 * Rule: no-shadowed-transitions
 * Prevents an unguarded `[FROM, VIA]` row from shadowing a subsequent row with the same `[FROM, VIA]`
 * (including VIA event arrays) under First-Match-Wins evaluation.
 */

import { noUnreachableTransitions } from './no-unreachable-transitions.js';

export const noShadowedTransitions = noUnreachableTransitions;
