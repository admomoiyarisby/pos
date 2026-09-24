/**
 * User role hierarchy — who may manage whom.
 *
 * Single source of truth for the "upper hierarchy" rule: an actor may only
 * open the edit surface of (and mutate) users at or below their own rank.
 * Used by the /admin/users UI (to hide the Edit button) and by the user
 * management server cores (to reject the request at the trust boundary).
 *
 * Rank order (highest first): super_admin > admin_pusat > area_manager >
 * central_kitchen > branch_admin. Unknown roles rank 0 and fail closed on
 * both sides: they can manage nobody, and nobody's rank comparison lets an
 * unknown target through.
 */

type ManagedRoleName =
  | "super_admin"
  | "admin_pusat"
  | "area_manager"
  | "central_kitchen"
  | "branch_admin";

const USER_ROLE_RANK = {
  super_admin: 5,
  admin_pusat: 4,
  area_manager: 3,
  central_kitchen: 2,
  branch_admin: 1,
} satisfies Record<ManagedRoleName, number>;

function isManagedRole(role: string): role is ManagedRoleName {
  return role in USER_ROLE_RANK;
}

export function roleRank(role: string): number {
  return isManagedRole(role) ? USER_ROLE_RANK[role] : 0;
}

/**
 * True when `actorRole` may manage a user currently holding `targetRole`,
 * optionally moving them to `nextRole` (role-change requests must not
 * promote anyone above the actor either). Peers may manage each other, so a
 * super_admin can still edit fellow super_admins (including themselves).
 */
export function canManageUser(actorRole: string, targetRole: string, nextRole?: string): boolean {
  const actor = roleRank(actorRole);
  if (actor === 0) return false;
  const target = roleRank(targetRole);
  if (target === 0) return false;
  if (actor < target) return false;
  if (nextRole !== undefined) {
    const next = roleRank(nextRole);
    if (next === 0) return false;
    if (actor < next) return false;
  }
  return true;
}
