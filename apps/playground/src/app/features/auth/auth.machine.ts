/**
 * Layer 3 (Feature): Re-exports cohesive Auth Feature (`auth.feature.ts`)
 */

export {
  authFSM,
  initialAuthContext,
  type AuthContext,
  type AuthEvents,
  type AuthMethods,
  type AuthStates,
} from './auth.feature';
