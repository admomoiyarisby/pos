// ============================================================
// One answer to "may this user row hold a session?".
//
// The `status` column is the admin's suspension switch; `deleted_at` is
// the tombstone. Both have to be enforced at two points, or the weaker
// one wins:
//
//   1. session creation (email/password, passkey, PIN) — a suspended user
//      must not receive a new cookie;
//   2. session resolution (`getCurrentUserRaw`) — a session issued before
//      the suspension must stop resolving, without waiting for expiry.
//
// PIN login always filtered on `status = 'Active'`; email and passkey did
// not, so a suspended account could simply sign back in. Keeping the rule
// here means every path reads the same definition.
// ============================================================

export type UserAccessDenial = "deleted" | "inactive" | null;

export interface UserAccessState {
  status?: string | null;
  deletedAt?: Date | string | null;
}

export function userAccessDenial(user: UserAccessState): UserAccessDenial {
  // Tombstone first: a deleted user is always Inactive too, and the
  // "deleted" wording is the accurate one to show.
  if (user.deletedAt) return "deleted";
  if (user.status === "Inactive") return "inactive";
  return null;
}

export const USER_ACCESS_MESSAGE = {
  deleted: "Akun ini sudah dihapus. Hubungi administrator.",
  inactive: "Akun ini dinonaktifkan. Hubungi administrator.",
} satisfies Record<Exclude<UserAccessDenial, null>, string>;
