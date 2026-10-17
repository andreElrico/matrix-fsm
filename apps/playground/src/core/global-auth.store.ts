/**
 * Layer 1 (Core): Global Auth Store exposing reactive Role Policy Signals
 */

import { computed, signal, type Signal } from '@angular/core';
import {
  ROLE_POLICIES,
  UserRole,
  type UserEntitlements,
} from './role.policy.js';

export class GlobalAuthStore {
  private readonly roleSignal = signal<UserRole>(UserRole.Free);

  readonly role: Signal<UserRole> = this.roleSignal.asReadonly();
  readonly policy: Signal<UserEntitlements> = computed(
    () => ROLE_POLICIES[this.roleSignal()],
  );

  setRole(role: UserRole): void {
    this.roleSignal.set(role);
  }
}
