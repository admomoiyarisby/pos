import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { branches, users } from "#/db/schema";
import { eq, ilike, or, and, ne } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";
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
      conditions.push(
        or(
          ilike(branches.code, `%${data.search}%`),
          ilike(branches.name, `%${data.search}%`),
          ilike(branches.location, `%${data.search}%`),
        ),
      );
    }
    if (data.type) {
      conditions.push(eq(branches.type, data.type));
    }

    const result = await db
      .select()
      .from(branches)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(branches.code);

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
  .validator((data: unknown) => branchInput.parse(data))
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

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
  });

export const updateBranch = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    // For updates, all fields except id are optional and can be null
    const updateSchema = z.object({
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
    return updateSchema.parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const { id, ...updates } = data;

    // Filter out null and undefined values - only update fields that were actually provided
    const filteredUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== null && value !== undefined) {
        filteredUpdates[key] = value;
      }
    }

    // Validate PIN uniqueness if being updated
    if (filteredUpdates.pin) {
      await validatePinUnique(filteredUpdates.pin as string, id);
    }

    const [old] = await db.select().from(branches).where(eq(branches.id, id)).limit(1);

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
    await logAudit(
      user,
      "branches",
      id,
      "UPDATE",
      old as Record<string, unknown>,
      result as Record<string, unknown>,
    );

    return result;
  });

export const deleteBranch = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

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
    await logAudit(
      user,
      "branches",
      data.id,
      "DELETE",
      old as Record<string, unknown>,
      result as Record<string, unknown>,
    );

    return { success: true };
  });
