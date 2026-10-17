/**
 * @matrix-fsm/playground - Interactive Demo & Live Mermaid Exporter
 */

import { toMermaid } from '@matrix-fsm/core';
import { AuthApiService, GlobalAuthStore, UserRole } from './core/index.js';
import { calculateSubscriptionPrice } from './domain/pricing.domain.js';
import { authFSM } from './features/auth/auth.machine.js';
import { createAuthFeatureStore } from './features/auth/auth.store.js';

export function bootstrapPlayground() {
  const globalAuth = new GlobalAuthStore();
  const authApi = new AuthApiService();
  const store = createAuthFeatureStore({ globalAuth, authApi });
  const mermaidDiagram = toMermaid(authFSM);

  return {
    globalAuth,
    authApi,
    store,
    mermaidDiagram,
    UserRole,
    calculateSubscriptionPrice,
  };
}
