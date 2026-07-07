/**
 * Branch staff name management.
 *
 * Manages the per-branch staff name lists used in the login flow.
 * Admin Pusat and Super Admin can CRUD staff names.
 */

import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { branchStaffNames, branches } from "#/db/schema";
import { eq, and } from "drizzle-orm";
import { requireRole } from "#/lib/server/auth";
import { z } from "zod";

// =============================================================================
// Validators
// =============================================================================

const staffNameInput = z.object({
  branchId: z.string().uuid(),
  name: z.string().min(1, "Name is required").max(100),
  active: z.boolean().optional().default(true),
});

const staffNameUpdate = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  active: z.boolean().optional(),
});

// =============================================================================
// Queries
// =============================================================================

/**
 * Get all staff names for a branch.
 * Used by the login flow to show the name picker.
 */
export const getBranchStaffNames = createServerFn({ method: "POST" })
  .validator((data: { branchId: string }) => data)
  .handler(async ({ data }) => {
    const names = await db
      .select({
        id: branchStaffNames.id,
        name: branchStaffNames.name,
        active: branchStaffNames.active,
      })
      .from(branchStaffNames)
      .where(
        and(
          eq(branchStaffNames.branchId, data.branchId),
          eq(branchStaffNames.active, true),
        ),
      )
      .orderBy(branchStaffNames.name);

    return names;
  });

/**
 * Get all staff names across all branches (for admin management).
 */
export const getAllBranchStaffNames = createServerFn({ method: "POST" })
  .validator((data: { branchId?: string }) => data)
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

    const query = db
      .select({
        id: branchStaffNames.id,
        branchId: branchStaffNames.branchId,
        branchName: branches.name,
        branchCode: branches.code,
        name: branchStaffNames.name,
        active: branchStaffNames.active,
        createdAt: branchStaffNames.createdAt,
      })
      .from(branchStaffNames)
      .innerJoin(branches, eq(branchStaffNames.branchId, branches.id))
      .orderBy(branches.name, branchStaffNames.name);

    if (data.branchId) {
      return await query.where(eq(branchStaffNames.branchId, data.branchId));
    }

    return await query;
  });

// =============================================================================
// Mutations
// =============================================================================

/**
 * Create a new staff name for a branch.
 */
export const createBranchStaffName = createServerFn({ method: "POST" })
  .validator(staffNameInput)
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

    const [created] = await db
      .insert(branchStaffNames)
      .values({
        branchId: data.branchId,
        name: data.name,
        active: data.active,
      })
      .returning();

    return created;
  });

/**
 * Update a staff name.
 */
export const updateBranchStaffName = createServerFn({ method: "POST" })
  .validator(staffNameUpdate)
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

    const { id, ...updates } = data;

    const [updated] = await db
      .update(branchStaffNames)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(branchStaffNames.id, id))
      .returning();

    return updated;
  });

/**
 * Delete a staff name.
 */
export const deleteBranchStaffName = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

    await db
      .delete(branchStaffNames)
      .where(eq(branchStaffNames.id, data.id));

    return { success: true };
  });

// =============================================================================
// Login helpers
// =============================================================================

/**
 * Verify a branch PIN and return the branch ID.
 * Used by the login flow.
 */
export const verifyBranchPin = createServerFn({ method: "POST" })
  .validator((data: { branchCode: string; pin: string }) => data)
  .handler(async ({ data }) => {
    const [branch] = await db
      .select({
        id: branches.id,
        code: branches.code,
        name: branches.name,
        pin: branches.pin,
        active: branches.active,
      })
      .from(branches)
      .where(eq(branches.code, data.branchCode))
      .limit(1);

    if (!branch) {
      return { success: false, error: "Branch not found" };
    }

    if (!branch.active) {
      return { success: false, error: "Branch is inactive" };
    }

    if (!branch.pin) {
      return { success: false, error: "Branch PIN not configured" };
    }

    if (branch.pin !== data.pin) {
      return { success: false, error: "Invalid PIN" };
    }

    return {
      success: true,
      branchId: branch.id,
      branchCode: branch.code,
      branchName: branch.name,
    };
  });
