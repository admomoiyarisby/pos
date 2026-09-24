import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  users as usersTable,
  areaManagerBranches,
  branches,
  account as accountTable,
  session as sessionTable,
} from "#/db/schema";
import { eq, and, ne, inArray, isNull } from "drizzle-orm";
import { fuzzySearch, fuzzyRank } from "./fuzzy";
import { requireAuth, requireRole } from "./auth";
import type { AppUser } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { z } from "zod";
import { hashPassword } from "better-auth/crypto";
import { canManageUser } from "#/lib/user-roles";

// better-auth >=1.7 matches credential accounts on providerId + issuer +
// accountId during signInEmail. Every write to the credential account must
// keep all three in this shape, or email login silently stops matching.
const CREDENTIAL_ISSUER = "local:credential";

const userRoleEnum = z.enum([
  "super_admin",
  "admin_pusat",
  "area_manager",
  "branch_admin",
  "central_kitchen",
]);

export const getUsers = createServerFn({ method: "GET" })
  .validator((data: { search?: string; role?: string }) => ({
    search: data.search,
    role: userRoleEnum.optional().catch(undefined).parse(data.role),
  }))
  .handler(async ({ data }) => {
    await requireAuth();

    const conditions = [isNull(usersTable.deletedAt)];
    if (data.search) {
      conditions.push(fuzzySearch([usersTable.name, usersTable.email], data.search));
    }
    if (data.role) {
      conditions.push(eq(usersTable.role, data.role));
    }

    const result = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        status: usersTable.status,
        branchId: usersTable.branchId,
        pin: usersTable.pin,
        branchName: branches.name,
      })
      .from(usersTable)
      .leftJoin(branches, eq(usersTable.branchId, branches.id))
      .where(and(...conditions))
      .orderBy(
        data.search ? fuzzyRank([usersTable.name, usersTable.email], data.search) : usersTable.name,
      );

    // Fetch assigned branches for area managers
    const userIds = result.map((u) => u.id);
    const amBranches =
      userIds.length > 0
        ? await db
            .select({
              userId: areaManagerBranches.userId,
              branchId: areaManagerBranches.branchId,
              branchName: branches.name,
            })
            .from(areaManagerBranches)
            .leftJoin(branches, eq(areaManagerBranches.branchId, branches.id))
            .where(inArray(areaManagerBranches.userId, userIds))
        : [];

    return result.map((u) => ({
      ...u,
      assignedBranches:
        u.role === "area_manager"
          ? amBranches.filter((ab) => ab.userId === u.id).map((ab) => ab.branchId)
          : undefined,
    }));
  });

/**
 * Get all users assigned to a specific branch.
 * Used by the branch detail view to show staff.
 */
export const getBranchUsers = createServerFn({ method: "GET" })
  .validator((data: { branchId: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const result = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        status: usersTable.status,
      })
      .from(usersTable)
      .where(and(eq(usersTable.branchId, data.branchId), isNull(usersTable.deletedAt)))
      .orderBy(usersTable.name);

    return result;
  });

const createUserInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: userRoleEnum,
  branchId: z.string().uuid().optional(),
  // Non-branch PIN login resolves a PIN globally (no branch scope), so user
  // PINs must be globally unique — same rule updateMyPin enforces.
  pin: z
    .string()
    .length(4)
    .regex(/^\d{4}$/, "PIN harus 4 digit")
    .optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
  assignedBranches: z.array(z.string().uuid()).optional(),
});

export const createUser = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof createUserInput>) => createUserInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");
    return createUserCore(user, data);
  });

/**
 * Reject a user PIN that is already taken — anywhere. Checks users.pin
 * (excluding the user being edited, if any) and the shared branches.pin,
 * because both login PIN flows resolve a bare 4-digit PIN without extra
 * scope. Same error message as the branch-scoped check it replaces.
 */
async function assertUserPinAvailable(pin: string, excludeUserId?: string): Promise<void> {
  const userClauses = [eq(usersTable.pin, pin)];
  if (excludeUserId) userClauses.push(ne(usersTable.id, excludeUserId));
  const [existingUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(...userClauses))
    .limit(1);
  if (existingUser) {
    throw new Error("PIN sudah digunakan oleh cabang/staf lain");
  }
  const [existingBranch] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.pin, pin))
    .limit(1);
  if (existingBranch) {
    throw new Error("PIN sudah digunakan oleh cabang/staf lain");
  }
}

/**
 * Set a user's email-login password on the exact credential row(s)
 * better-auth signInEmail reads — and repair them when they drifted.
 *
 * signInEmail matches on providerId + issuer ("local:credential") +
 * accountId (= userId). Updating only the hash (or only an arbitrary
 * duplicate row) leaves login broken when the row's issuer/accountId
 * drifted (pre-issuer legacy data) or when duplicates exist, with a success
 * toast but the new password "not recorded". Writing the full triple to
 * every credential row of the user closes both holes.
 */
async function setCredentialPassword(userId: string, newPassword: string): Promise<void> {
  const { account: accountTable } = await import("#/db/schema");
  const rows = await db
    .select({ id: accountTable.id })
    .from(accountTable)
    .where(and(eq(accountTable.userId, userId), eq(accountTable.providerId, "credential")));
  if (rows.length === 0) {
    throw new Error("Akun credential tidak ditemukan untuk user ini");
  }
  const hashedPassword = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .update(accountTable)
        .set({ password: hashedPassword, issuer: CREDENTIAL_ISSUER, accountId: userId })
        .where(eq(accountTable.id, row.id));
    }
  });
}

/** The business logic behind `createUser`, parameterized by an explicit user
 *  so it can be driven directly (e.g. from integration tests). Mirrors the
 *  wrapper's `requireRole(...)` guard. */
export async function createUserCore(user: AppUser, data: z.infer<typeof createUserInput>) {
  if (user.role !== "super_admin") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin)`,
    );
  }
  if (!canManageUser(user.role, data.role)) {
    throw new Error(`Forbidden: role "${user.role}" cannot create a "${data.role}" user`);
  }

  // Area managers must be assigned at least one branch
  if (
    data.role === "area_manager" &&
    (!data.assignedBranches || data.assignedBranches.length === 0)
  ) {
    throw new Error("Area Manager harus memiliki minimal 1 cabang yang dikelola");
  }
  if (data.assignedBranches?.length) {
    const found = await db
      .select({ id: branches.id })
      .from(branches)
      .where(inArray(branches.id, data.assignedBranches));
    if (found.length !== data.assignedBranches.length) {
      throw new Error("Salah satu cabang yang dipilih tidak ditemukan");
    }
  }

  // Branch admins must be assigned a branch (F10: a branch-less branch admin
  // is stranded — no POS terminal, no unique PIN scope)
  if (data.role === "branch_admin" && !data.branchId) {
    throw new Error("Branch Admin harus memiliki cabang");
  }
  if (data.branchId) {
    const found = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.id, data.branchId));
    if (found.length !== 1) {
      throw new Error("Cabang yang dipilih tidak ditemukan");
    }
  }

  // PINs resolve globally at login — reject any PIN taken by another user
  // or branch, not just same-branch collisions.
  if (data.pin) {
    await assertUserPinAvailable(data.pin);
  }

  // better-auth lowercases emails on sign-up AND on sign-in lookup, so a
  // mixed-case email stored as typed (e.g. "Supervisor.sby@...") can never
  // match at login ("User not found"). Normalize once, at the boundary.
  const email = data.email.toLowerCase();

  // Create user + credential account directly (bypass auth.api.signUpEmail
  // which auto-signs-in the new user, overwriting the admin's session).
  const userId = crypto.randomUUID();
  const hashedPassword = await hashPassword(data.password);

  await db.insert(usersTable).values({
    id: userId,
    email,
    name: data.name,
    role: data.role,
    branchId: data.branchId,
    pin: data.pin,
    status: data.status ?? "Active",
  });

  // Create credential account (better-auth stores passwords in the account
  // table). `issuer` is required by better-auth >=1.7: signInEmail matches
  // credential accounts on providerId + issuer ("local:credential") +
  // accountId, so omitting it makes email login impossible for new users.
  const { account: accountTable } = await import("#/db/schema");
  await db.insert(accountTable).values({
    id: crypto.randomUUID(),
    accountId: userId,
    providerId: "credential",
    issuer: "local:credential",
    userId,
    password: hashedPassword,
  });

  // Handle area manager branches
  if (data.role === "area_manager" && data.assignedBranches?.length) {
    for (const branchId of data.assignedBranches) {
      await db
        .insert(areaManagerBranches)
        .values({
          userId,
          branchId,
        })
        .onConflictDoNothing();
    }
  }

  // Log
  await logSystemAction(
    user,
    "Create User",
    `User "${data.name}" (${data.role}) dibuat oleh ${user.name}`,
  );
  await logAudit(user, "users", userId, "CREATE", undefined, {
    id: userId,
    name: data.name,
    email,
    role: data.role,
    branchId: data.branchId,
    status: data.status ?? "Active",
  });

  return { success: true, userId };
}

const updateUserInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  role: userRoleEnum.optional(),
  branchId: z.string().uuid().optional(),
  pin: z
    .string()
    .length(4)
    .regex(/^\d{4}$/, "PIN harus 4 digit")
    .optional(),
  password: z.string().min(8).optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
  assignedBranches: z.array(z.string().uuid()).optional(),
});

export const updateUser = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof updateUserInput>) => updateUserInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");
    return updateUserCore(user, data);
  });

export async function updateUserCore(user: AppUser, data: z.infer<typeof updateUserInput>) {
  if (user.role !== "super_admin") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin)`,
    );
  }

  const { id, assignedBranches, ...updates } = data;

  // Fetch old user data for logging
  const [oldUser] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);

  if (!oldUser) throw new Error("User not found");
  // Tombstoned (soft-deleted) users are invisible — refuse to edit them.
  if (oldUser.deletedAt) throw new Error("User not found");

  const nextRole = data.role ?? oldUser.role;

  // Upper-hierarchy rule: the actor must outrank (or equal) both the
  // target's current role and the requested new role, so a lower account
  // can never edit — or promote anyone into — a higher tier.
  if (!canManageUser(user.role, oldUser.role, data.role)) {
    throw new Error(`Forbidden: role "${user.role}" cannot manage a "${oldUser.role}" user`);
  }

  // Area managers must keep at least one assigned branch
  if (
    nextRole === "area_manager" &&
    assignedBranches !== undefined &&
    assignedBranches.length === 0
  ) {
    throw new Error("Area Manager harus memiliki minimal 1 cabang yang dikelola");
  }
  if (assignedBranches?.length) {
    const found = await db
      .select({ id: branches.id })
      .from(branches)
      .where(inArray(branches.id, assignedBranches));
    if (found.length !== assignedBranches.length) {
      throw new Error("Salah satu cabang yang dipilih tidak ditemukan");
    }
  }

  // Branch admins must keep a branch (F10: the client always sends branchId
  // for this role; an explicit undefined means the branch was cleared)
  if (nextRole === "branch_admin" && "branchId" in data && data.branchId === undefined) {
    throw new Error("Branch Admin harus memiliki cabang");
  }
  if (data.branchId) {
    const found = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.id, data.branchId));
    if (found.length !== 1) {
      throw new Error("Cabang yang dipilih tidak ditemukan");
    }
  }

  // Validate PIN uniqueness globally (non-branch PIN login has no branch
  // scope, so a per-branch check lets two staff share one PIN).
  if (data.pin) {
    await assertUserPinAvailable(data.pin, id);
  }
  // Password lives in the credential account table, not the users row.
  const { password: _newPassword, ...baseUpdates } = updates;

  // Skip the base-row update when nothing was provided (e.g. a call that only
  // rewrites assignedBranches) — drizzle rejects an empty `set`.
  const setData: Partial<typeof usersTable.$inferInsert> = { ...baseUpdates };

  // When the role moves away from the branch-scoped roles, clear the stale
  // branch assignment (mirrors the area_manager assignedBranches cleanup).
  if (
    (oldUser.role === "branch_admin" || oldUser.role === "central_kitchen") &&
    nextRole !== "branch_admin" &&
    nextRole !== "central_kitchen"
  ) {
    setData.branchId = null;
  }

  if (Object.keys(setData).length > 0) {
    await db.update(usersTable).set(setData).where(eq(usersTable.id, id));
  }

  // Build new user data for audit
  const newUserData = { ...oldUser, ...setData };
  const nameHint = newUserData.name || oldUser.name;

  // Reset the credential account password when requested (admin password
  // reset from the /admin/users edit form). setCredentialPassword writes
  // the exact row signInEmail reads and repairs drifted rows, so the new
  // password is always the one login verifies against.
  if (_newPassword !== undefined) {
    await setCredentialPassword(id, _newPassword);
    await logSystemAction(
      user,
      "Update User Password",
      `Password user "${nameHint}" direset oleh ${user.name}`,
      "Warning",
    );
  }

  // Log user update
  await logSystemAction(user, "Update User", `User "${nameHint}" diperbarui oleh ${user.name}`);

  // Check for role change
  if (data.role && data.role !== oldUser.role) {
    await logSystemAction(
      user,
      "Update User",
      `Role user "${nameHint}" diubah dari ${oldUser.role} ke ${data.role} oleh ${user.name}`,
      "Warning",
    );
  }

  // Check for PIN change
  if (data.pin && data.pin !== oldUser.pin) {
    await logSystemAction(
      user,
      "Update User PIN",
      `PIN user "${nameHint}" diperbarui oleh ${user.name}`,
    );
  }

  // Check for status change
  if (data.status && data.status !== oldUser.status) {
    await logSystemAction(
      user,
      "Update User Status",
      `Status user "${nameHint}" diubah dari ${oldUser.status} ke ${data.status} oleh ${user.name}`,
    );
  }

  await logAudit(user, "users", id, "UPDATE", oldUser, newUserData);

  // When an area manager's role changes away from area_manager, drop their
  // branch assignments so no orphan rows are left behind.
  if (oldUser.role === "area_manager" && nextRole !== "area_manager") {
    await db.delete(areaManagerBranches).where(eq(areaManagerBranches.userId, id));
  }

  // Update area manager branches — atomic delete+insert (bad branchId must not leave 0 rows)
  if (assignedBranches !== undefined) {
    await db.transaction(async (tx) => {
      await tx.delete(areaManagerBranches).where(eq(areaManagerBranches.userId, id));
      for (const branchId of assignedBranches) {
        await tx.insert(areaManagerBranches).values({ userId: id, branchId });
      }
    });
  }

  return { success: true };
}

const deleteUserInput = z.object({ id: z.string().uuid() });

export const deleteUser = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof deleteUserInput>) => deleteUserInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");
    return deleteUserCore(user, data);
  });

/**
 * Soft-delete a user account ("Hapus permanen" in the UI). A deleted_at
 * tombstone hides the user from every list and login path while the row stays
 * put, so operational history keeps its NOT NULL FK references (shifts,
 * orders, procurements, transfers, stock opnames, audit rows, …) intact —
 * a user with history is no longer blocked from deletion. The email is
 * renamed (freeing the address for reuse) and auth artifacts (sessions,
 * credential account, area-manager assignments) are removed. Restore is
 * DB-only, mirroring the ADR-0009 tombstone pattern.
 */
export async function deleteUserCore(user: AppUser, data: z.infer<typeof deleteUserInput>) {
  if (user.role !== "super_admin") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin)`,
    );
  }
  if (data.id === user.id) {
    throw new Error("Tidak dapat menghapus akun sendiri");
  }

  const [oldUser] = await db.select().from(usersTable).where(eq(usersTable.id, data.id)).limit(1);
  if (!oldUser) throw new Error("User not found");
  if (oldUser.deletedAt) {
    throw new Error("User sudah dihapus");
  }
  if (!canManageUser(user.role, oldUser.role)) {
    throw new Error(`Forbidden: role "${user.role}" cannot manage a "${oldUser.role}" user`);
  }

  await db.transaction(async (tx) => {
    // Kill live sessions immediately — a tombstoned user must not keep an
    // authenticated session.
    await tx.delete(sessionTable).where(eq(sessionTable.userId, data.id));
    // Remove the credential account so the old email/password pair can't log
    // in even if the tombstone were ever lifted manually.
    await tx.delete(accountTable).where(eq(accountTable.userId, data.id));
    // Area-manager branch assignments are pure config, not history — drop them.
    await tx.delete(areaManagerBranches).where(eq(areaManagerBranches.userId, data.id));
    await tx
      .update(usersTable)
      .set({
        deletedAt: new Date(),
        // Free the unique email (and per-branch PIN slot) for reuse while the
        // original values stay recoverable in the audit log.
        email: `deleted+${oldUser.id}@deleted.omoiyari.net`,
        pin: null,
        status: "Inactive",
      })
      .where(eq(usersTable.id, data.id));
  });

  // Log AFTER the update: the user row still exists (no FK break), and the
  // audit trail records who tombstoned whom.
  await logSystemAction(
    user,
    "Delete User",
    `User "${oldUser.name}" (${oldUser.role}) dihapus permanen oleh ${user.name}`,
    "Warning",
  );
  await logAudit(user, "users", data.id, "DELETE", oldUser, undefined);

  return { success: true };
}

// =============================================================================
// Self-service settings (any authenticated user can update their own account)
// =============================================================================

/**
 * Update the current user's profile (name and email).
 */
const updateMyProfileInput = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export const updateMyProfile = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof updateMyProfileInput>) => updateMyProfileInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireAuth();

    // Match better-auth's normalization (sign-up/sign-in both lowercase):
    // a mixed-case email stored as typed can never match at login.
    const email = data.email.toLowerCase();

    // Check if email is already taken by another user
    if (email !== user.email.toLowerCase()) {
      const [existing] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.email, email), ne(usersTable.id, user.id)))
        .limit(1);
      if (existing) {
        throw new Error("Email sudah digunakan oleh user lain");
      }
    }

    await db
      .update(usersTable)
      .set({ name: data.name, email, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    await logSystemAction(user, "Update Profile", `User "${user.name}" memperbarui profil`);

    return { success: true };
  });

/**
 * Update the current user's PIN.
 * Validates global uniqueness across users.pin and branches.pin.
 */
const updateMyPinInput = z.object({
  pin: z
    .string()
    .length(4)
    .regex(/^\d{4}$/, "PIN harus 4 digit"),
});

export const updateMyPin = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof updateMyPinInput>) => updateMyPinInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireAuth();

    // Validate uniqueness across users.pin (excluding self)
    const [existingUser] = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(and(eq(usersTable.pin, data.pin), ne(usersTable.id, user.id)))
      .limit(1);

    if (existingUser) {
      throw new Error("PIN sudah digunakan oleh cabang/staf lain");
    }

    // Validate uniqueness across branches.pin
    const [existingBranch] = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.pin, data.pin))
      .limit(1);

    if (existingBranch) {
      throw new Error("PIN sudah digunakan oleh cabang/staf lain");
    }

    await db
      .update(usersTable)
      .set({ pin: data.pin, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    await logSystemAction(user, "Update PIN", `User "${user.name}" memperbarui PIN`);

    return { success: true };
  });

/**
 * Update the current user's password.
 * Verifies current password before allowing change.
 */
const updateMyPasswordInput = z.object({
  currentPassword: z.string().min(1, "Password saat ini wajib diisi"),
  newPassword: z.string().min(8, "Password baru minimal 8 karakter"),
});

export const updateMyPassword = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof updateMyPasswordInput>) => updateMyPasswordInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireAuth();

    // Get current password hash from the credential row signInEmail reads
    // (exact issuer + accountId match first, legacy row as fallback).
    const { account: accountTable } = await import("#/db/schema");
    const accounts = await db
      .select()
      .from(accountTable)
      .where(and(eq(accountTable.userId, user.id), eq(accountTable.providerId, "credential")));

    const account =
      accounts.find(
        (a) => a.issuer === CREDENTIAL_ISSUER && a.accountId === user.id && a.password,
      ) ?? accounts.find((a) => a.password);

    if (!account || !account.password) {
      throw new Error("Akun tidak ditemukan");
    }

    // Verify current password
    const { verifyPassword } = await import("better-auth/crypto");
    const isValid = await verifyPassword({
      password: data.currentPassword,
      hash: account.password,
    });
    if (!isValid) {
      throw new Error("Password saat ini salah");
    }

    // Write the new hash to every credential row (repairing drifted rows),
    // so login verifies against exactly what was set here.
    await setCredentialPassword(user.id, data.newPassword);

    await logSystemAction(user, "Update Password", `User "${user.name}" memperbarui password`);

    return { success: true };
  });
