import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { users as usersTable, areaManagerBranches, branches } from "#/db/schema";
import { eq, and, ne, inArray } from "drizzle-orm";
import { fuzzySearch, fuzzyRank } from "./fuzzy";
import { requireAuth, requireRole } from "./auth";
import type { AppUser } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { z } from "zod";
import { hashPassword } from "better-auth/crypto";

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

    const conditions = [];
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
      .where(conditions.length > 0 ? and(...conditions) : undefined)
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
      .where(eq(usersTable.branchId, data.branchId))
      .orderBy(usersTable.name);

    return result;
  });

const createUserInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: userRoleEnum,
  branchId: z.string().uuid().optional(),
  pin: z.string().length(4).optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
  assignedBranches: z.array(z.string().uuid()).optional(),
});

export const createUser = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof createUserInput>) => createUserInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");
    return createUserCore(user, data);
  });

/** The business logic behind `createUser`, parameterized by an explicit user
 *  so it can be driven directly (e.g. from integration tests). Mirrors the
 *  wrapper's `requireRole(...)` guard. */
export async function createUserCore(user: AppUser, data: z.infer<typeof createUserInput>) {
  if (user.role !== "super_admin") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin)`,
    );
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

  // Validate PIN uniqueness per branch
  if (data.pin && data.branchId) {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.pin, data.pin), eq(usersTable.branchId, data.branchId)))
      .limit(1);
    if (existing) {
      throw new Error("PIN sudah digunakan oleh cabang/staf lain");
    }
  }

  // Create user + credential account directly (bypass auth.api.signUpEmail
  // which auto-signs-in the new user, overwriting the admin's session).
  const userId = crypto.randomUUID();
  const hashedPassword = await hashPassword(data.password);

  await db.insert(usersTable).values({
    id: userId,
    email: data.email,
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
    email: data.email,
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
  pin: z.string().length(4).optional(),
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

  const nextRole = data.role ?? oldUser.role;

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

  // Validate PIN uniqueness per branch
  if (data.pin) {
    // Determine the branchId to check: use new branchId if provided, otherwise current
    let branchIdToCheck = data.branchId;
    if (!branchIdToCheck) {
      const [currentUser] = await db
        .select({ branchId: usersTable.branchId })
        .from(usersTable)
        .where(eq(usersTable.id, id))
        .limit(1);
      branchIdToCheck = currentUser?.branchId ?? undefined;
    }
    if (branchIdToCheck) {
      const [existing] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.pin, data.pin),
            eq(usersTable.branchId, branchIdToCheck),
            ne(usersTable.id, id),
          ),
        )
        .limit(1);
      if (existing) {
        throw new Error("PIN sudah digunakan oleh cabang/staf lain");
      }
    }
  }
  const setData = { ...updates };
  if (updates.branchId === undefined && "branchId" in data) {
    // If branchId was explicitly passed as undefined, keep it
  }

  // Skip the base-row update when nothing was provided (e.g. a call that only
  // rewrites assignedBranches) — drizzle rejects an empty `set`.
  if (Object.keys(setData).length > 0) {
    await db.update(usersTable).set(setData).where(eq(usersTable.id, id));
  }

  // Build new user data for audit
  const newUserData = { ...oldUser, ...setData };
  const nameHint = newUserData.name || oldUser.name;

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

    // Check if email is already taken by another user
    if (data.email !== user.email) {
      const [existing] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.email, data.email), ne(usersTable.id, user.id)))
        .limit(1);
      if (existing) {
        throw new Error("Email sudah digunakan oleh user lain");
      }
    }

    await db
      .update(usersTable)
      .set({ name: data.name, email: data.email, updatedAt: new Date() })
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

    // Get current password hash from account table
    const { account: accountTable } = await import("#/db/schema");
    const [account] = await db
      .select()
      .from(accountTable)
      .where(and(eq(accountTable.userId, user.id), eq(accountTable.providerId, "credential")))
      .limit(1);

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

    // Hash and update new password
    const hashedPassword = await hashPassword(data.newPassword);
    await db
      .update(accountTable)
      .set({ password: hashedPassword })
      .where(eq(accountTable.id, account.id));

    await logSystemAction(user, "Update Password", `User "${user.name}" memperbarui password`);

    return { success: true };
  });
