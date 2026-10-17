/**
 * Layer 1 (Core): Policy-Driven Design (Capabilities over Roles)
 */

export enum UserRole {
  Free = 'FREE',
  Pro = 'PRO',
  Admin = 'ADMIN',
}

export interface UserEntitlements {
  readonly showUpsellAds: boolean;
  readonly canBypassApproval: boolean;
  readonly discountPercent: number;
  readonly maxProjects: number;
}

export const ROLE_POLICIES: Record<UserRole, UserEntitlements> = {
  [UserRole.Free]: {
    showUpsellAds: true,
    canBypassApproval: false,
    discountPercent: 0,
    maxProjects: 3,
  },
  [UserRole.Pro]: {
    showUpsellAds: false,
    canBypassApproval: false,
    discountPercent: 10,
    maxProjects: 100,
  },
  [UserRole.Admin]: {
    showUpsellAds: false,
    canBypassApproval: true,
    discountPercent: 100,
    maxProjects: Infinity,
  },
};
