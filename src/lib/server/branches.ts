import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { branches, users } from "#/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { fuzzySearch, fuzzyRank } from "./fuzzy";
import { requireAuth, requireRole } from "./auth";
import type { AppUser } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import type { UnknownRecord } from "#/lib/unknown-record";
import { z } from "zod";

const branchInput = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  location: z.string().min(1).max(200),
  type: z.enum(["Central", "Outlet"]),
  active: z.boolean().optional(),
  isOnline: z.boolean().optional(),
  pb1Rate: z.number().int().min(0).max(100).optional(),
  pin: z.string().length(4).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  complaintPhone: z.string().max(20).nullable().optional(),
});

/**
 * Validate that a PIN is globally unique (across branches and users).
 * Throws an error if the PIN is already in use.
 */
async function validatePinUnique(pin: string, excludeBranchId?: string) {
  // Check against other branches
  const branchCondition = excludeBranchId
    ? and(eq(branches.pin, pin), ne(branches.id, excludeBranchId))
    : eq(branches.pin, pin);

  const [existingBranch] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(branchCondition)
    .limit(1);

  if (existingBranch) {
    throw new Error("PIN sudah digunakan oleh cabang/staf lain");
  }

  // Check against users
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.pin, pin))
    .limit(1);

  if (existingUser) {
    throw new Error("PIN sudah digunakan oleh cabang/staf lain");
  }
}

export const getBranches = createServerFn({ method: "GET" })
  .validator(
    (data: { search?: string; type?: "Central" | "Outlet" | null; showInactive?: boolean }) => data,
  )
  .handler(async ({ data }) => {
    await requireAuth();

    const conditions = [];

    // Exclude soft-deleted branches unless explicitly requested
    if (!data.showInactive) {
      conditions.push(eq(branches.active, true));
    }

    if (data.search) {
      conditions.push(fuzzySearch([branches.code, branches.name, branches.location], data.search));
    }
    if (data.type) {
      conditions.push(eq(branches.type, data.type));
    }

    const result = await db
      .select()
      .from(branches)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        data.search
          ? fuzzyRank([branches.code, branches.name, branches.location], data.search)
          : branches.code,
      );

    return result;
  });

export const getBranch = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();
    const [result] = await db.select().from(branches).where(eq(branches.id, data.id)).limit(1);
    return result ?? null;
  });

export const createBranch = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof branchInput>) => branchInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return createBranchCore(user, data);
  });

/** The business logic behind `createBranch`, parameterized by an explicit user
 *  so it can be driven directly (e.g. from integration tests). Mirrors the
 *  wrapper's `requireRole(...)` guard. */
export async function createBranchCore(user: AppUser, data: z.infer<typeof branchInput>) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  // Validate PIN uniqueness if provided
  if (data.pin) {
    await validatePinUnique(data.pin);
  }

  const [result] = await db
    .insert(branches)
    .values({
      code: data.code,
      name: data.name,
      location: data.location,
      type: data.type,
      active: data.active ?? true,
      isOnline: data.isOnline ?? true,
      pb1Rate: data.pb1Rate ?? 11,
      pin: data.pin,
      phone: data.phone,
      complaintPhone: data.complaintPhone,
    })
    .returning();

  return result;
}

// For updates, all fields except id are optional and can be null
const updateBranchInput = z.object({
  id: z.string().uuid(),
  code: z.string().min(1).max(20).nullable().optional(),
  name: z.string().min(1).max(100).nullable().optional(),
  location: z.string().min(1).max(200).nullable().optional(),
  type: z.enum(["Central", "Outlet"]).nullable().optional(),
  active: z.boolean().nullable().optional(),
  isOnline: z.boolean().nullable().optional(),
  pb1Rate: z.number().int().min(0).max(100).nullable().optional(),
  pin: z.string().length(4).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  complaintPhone: z.string().max(20).nullable().optional(),
});

export const updateBranch = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof updateBranchInput>) => updateBranchInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return updateBranchCore(user, data);
  });

export async function updateBranchCore(user: AppUser, data: z.infer<typeof updateBranchInput>) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  const { id, ...updates } = data;

  // Filter out null and undefined values - only update fields that were actually provided
  const filteredUpdates: UnknownRecord = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value !== null && value !== undefined) {
      filteredUpdates[key] = value;
    }
  }

  // Validate PIN uniqueness if being updated
  const pin = z.string().optional().catch(undefined).parse(filteredUpdates.pin);
  if (pin) {
    await validatePinUnique(pin, id);
  }

  const [old] = await db.select().from(branches).where(eq(branches.id, id)).limit(1);
  if (!old) throw new Error("Branch not found");

  const [result] = await db
    .update(branches)
    .set({ ...filteredUpdates, updatedAt: new Date() })
    .where(eq(branches.id, id))
    .returning();

  await logSystemAction(
    user,
    "Update Branch",
    `Cabang "${result.name}" diperbarui oleh ${user.name}`,
  );
  await logAudit(user, "branches", id, "UPDATE", old, result);

  return result;
}

export const deleteBranch = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return deleteBranchCore(user, data);
  });

export async function deleteBranchCore(user: AppUser, data: { id: string }) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  const [old] = await db.select().from(branches).where(eq(branches.id, data.id)).limit(1);
  if (!old) throw new Error("Branch not found");

  const [result] = await db
    .update(branches)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(branches.id, data.id))
    .returning();

  await logSystemAction(
    user,
    "Delete Branch",
    `Cabang "${result.name}" dinonaktifkan oleh ${user.name}`,
  );
  await logAudit(user, "branches", data.id, "DELETE", old, result);

  return { success: true };
}
