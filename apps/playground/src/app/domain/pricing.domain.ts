/**
 * Layer 2 (Domain): Pure Business Rules & Calculations
 * STRICT RULE: 0% Angular DI (inject() is forbidden!)
 */

import type { Credentials, UserEntitlements } from '../core';

export function hasValidCredentials(credentials: Credentials): boolean {
  return (
    credentials.email.trim().includes('@') &&
    credentials.password.trim().length >= 4
  );
}

export function calculateSubscriptionPrice(
  baseMonthlyUsd: number,
  policy: UserEntitlements,
): number {
  const factor = Math.max(0, 100 - policy.discountPercent) / 100;
  return Math.round(baseMonthlyUsd * factor * 100) / 100;
}

export function canCreateProject(
  currentProjectCount: number,
  policy: UserEntitlements,
): boolean {
  return currentProjectCount < policy.maxProjects;
}
