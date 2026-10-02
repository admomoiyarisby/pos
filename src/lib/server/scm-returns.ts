import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "#/lib/server/db";
import {
  branches,
  ingredients,
  scmProcurements,
  scmReturns,
  scmTransfers,
  users,
} from "#/db/schema";
import { requireAuth, requireRole, type AppUser } from "./auth";
import { logAudit } from "./logging";
import { fuzzySearch } from "./fuzzy";
import { z } from "zod";

/**
 * Retur Barang (ADR 0018) — rejected-at-receiving stock on its way home.
 *
 * A rejection is only a *loss* when the goods are destroyed ("Scrap"). When
 * the receiver sends them back, the stock numbers return to the source the
 * instant the receiving is submitted, but the box is still on the receiver's
 * shelf. This module owns that gap: it lists what each branch owes its source,
 * and lets the source close the loop once the goods are physically back.
 *
 * Deliberately *not* a waste report. `scm_returns.valuation` values what is on
 * the truck (qty × averageCost) so the list is actionable; it never reaches
 * Total Kerugian, never creates an operational expense, and cancelling a
 * return is not a thing — a return that turns out to be a scrap is corrected by
 * recording the scrap on the Waste page.
 */

const RETURN_STATUSES = ["Pending", "PickedUp"] as const;
export type ScmReturnStatus = (typeof RETURN_STATUSES)[number];

/**
 * Branch scoping shared by the list and the summary. Mirrors the Waste page:
 * a branch admin is locked to their own branch, an area manager to their
 * assigned branches, everyone else may filter freely (an explicit branchId, or
 * all branches when omitted).
 */
function branchScope(
  user: { role: string; branchId?: string; assignedBranches?: string[] },
  branchFilter?: string,
) {
  if (user.role === "branch_admin" && user.branchId) {
    return eq(scmReturns.branchId, user.branchId);
  }
  if (user.role === "area_manager" && user.assignedBranches?.length) {
    if (branchFilter && !user.assignedBranches.includes(branchFilter)) {
      // A stale/deep-linked branchId outside the assignment must not widen the
      // result set — fall back to the full assignment instead.
      return inArray(scmReturns.branchId, user.assignedBranches);
    }
    return branchFilter
      ? eq(scmReturns.branchId, branchFilter)
      : inArray(scmReturns.branchId, user.assignedBranches);
  }
  return branchFilter ? eq(scmReturns.branchId, branchFilter) : undefined;
}

export const getScmReturns = createServerFn({ method: "GET" })
  .validator(
    (data: { branchId?: string; status?: ScmReturnStatus | null; search?: string }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const rows = await db
      .select({
        id: scmReturns.id,
        branchId: scmReturns.branchId,
        branchName: branches.name,
        ingredientId: scmReturns.ingredientId,
        ingredientName: ingredients.name,
        quantity: scmReturns.quantity,
        valuation: scmReturns.valuation,
        disposition: scmReturns.disposition,
        reason: scmReturns.reason,
        status: scmReturns.status,
        createdAt: scmReturns.createdAt,
        pickedUpAt: scmReturns.pickedUpAt,
        pickedUpByName: users.name,
        scmProcurementId: scmReturns.scmProcurementId,
        scmTransferId: scmReturns.scmTransferId,
        procurementCode: scmProcurements.code,
        transferCode: scmTransfers.code,
      })
      .from(scmReturns)
      .leftJoin(branches, eq(scmReturns.branchId, branches.id))
      .leftJoin(ingredients, eq(scmReturns.ingredientId, ingredients.id))
      .leftJoin(users, eq(scmReturns.pickedUpBy, users.id))
      .leftJoin(scmProcurements, eq(scmReturns.scmProcurementId, scmProcurements.id))
      .leftJoin(scmTransfers, eq(scmReturns.scmTransferId, scmTransfers.id))
      .where(
        and(
          branchScope(user, data.branchId),
          data.status ? eq(scmReturns.status, data.status) : undefined,
          data.search
            ? or(
                fuzzySearch(ingredients.name, data.search),
                fuzzySearch(scmProcurements.code, data.search),
                fuzzySearch(scmTransfers.code, data.search),
              )
            : undefined,
        ),
      )
      .orderBy(desc(scmReturns.createdAt));

    // Branch admins must not see the HPP-derived valuation (qty × averageCost),
    // the same rule the Waste list applies.
    if (user.role === "branch_admin") {
      return rows.map((r) => ({ ...r, valuation: 0 }));
    }
    return rows;
  });

/**
 * Totals for the return list header: how many boxes are still out there and
 * what they are worth. Kept server-side so the header never disagrees with a
 * filtered list, and so `valuation` stays hidden from branch admins in exactly
 * the same place the rows hide it.
 */
export const getScmReturnSummary = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const scope = branchScope(user, data.branchId);

    const [pending] = await db
      .select({
        count: sql<number>`count(*)::int`,
        valuation: sql<number>`coalesce(sum(${scmReturns.valuation}), 0)::int`,
      })
      .from(scmReturns)
      .where(and(scope, eq(scmReturns.status, "Pending")));

    if (user.role === "branch_admin") {
      return { pendingCount: pending?.count ?? 0, pendingValuation: 0 };
    }
    return {
      pendingCount: pending?.count ?? 0,
      pendingValuation: pending?.valuation ?? 0,
    };
  });

/**
 * Close the loop: the source confirms the rejected goods are physically back on
 * its shelf, so the receiver's liability is discharged.
 *
 * Stock is NOT moved here. The quantity was credited to the source's inventory
 * the moment the receiving was submitted (ADR 0002/0006 `*RejectedDisposition`
 * effects) — this only records that the box caught up with the number, which
 * is the whole point: the number was always ahead of reality.
 *
 * Central-only (`admin_pusat` / `super_admin`): confirming a pickup asserts
 * that the goods reached *the source's* warehouse, which is a Central call.
 * A second call on an already-PickedUp row is rejected rather than silently
 * re-stamped.
 *
 * Split into a transport wrapper + a user-parameterized core per ADR 0015, so
 * the flow tests can exercise the real transition without an HTTP session.
 */
export async function confirmScmReturnPickupCore(
  user: AppUser,
  data: { returnId: string },
): Promise<{ success: true } | { success: false; error: string }> {
  if (user.role !== "admin_pusat" && user.role !== "super_admin") {
    return {
      success: false,
      error: `Forbidden: konfirmasi pickup retur hanya untuk admin_pusat atau super_admin (peran Anda: ${user.role}).`,
    };
  }

  const [existing] = await db
    .select({
      id: scmReturns.id,
      status: scmReturns.status,
    })
    .from(scmReturns)
    .where(eq(scmReturns.id, data.returnId))
    .limit(1);

  if (!existing) {
    return { success: false, error: "Data retur tidak ditemukan." };
  }
  if (existing.status === "PickedUp") {
    return { success: false, error: "Retur ini sudah ditandai sudah kembali." };
  }

  const pickedUpAt = new Date();
  await db
    .update(scmReturns)
    .set({ status: "PickedUp", pickedUpAt, pickedUpBy: user.id })
    .where(and(eq(scmReturns.id, data.returnId), eq(scmReturns.status, "Pending")));

  await logAudit(
    user,
    "scm_returns",
    existing.id,
    "STATUS_CHANGE",
    { status: "Pending" },
    { status: "PickedUp", pickedUpAt: pickedUpAt.toISOString() },
  );

  return { success: true };
}

export const confirmScmReturnPickup = createServerFn({ method: "POST" })
  .validator(z.object({ returnId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole("admin_pusat", "super_admin");
    return confirmScmReturnPickupCore(user, data);
  });

/**
 * Reopen a return the source confirmed in error — the box never actually made
 * it back, so the branch owes the pickup again. The inverse of
 * `confirmScmReturnPickup`, and the escape hatch for the migration backfill
 * (which seeds historical returns as PickedUp because the stock numbers were
 * already home; anyone who knows a batch is still on a branch shelf reopens it
 * here rather than editing the database).
 *
 * Guarded so it can only move PickedUp → Pending, and the two pickup stamps are
 * cleared together to satisfy `scmret_pickup_stamps_paired`.
 */
export async function reopenScmReturnCore(
  user: AppUser,
  data: { returnId: string; reason: string },
): Promise<{ success: true } | { success: false; error: string }> {
  if (user.role !== "admin_pusat" && user.role !== "super_admin") {
    return {
      success: false,
      error: `Forbidden: membuka retur hanya untuk admin_pusat atau super_admin (peran Anda: ${user.role}).`,
    };
  }

  const [existing] = await db
    .select({ id: scmReturns.id, status: scmReturns.status })
    .from(scmReturns)
    .where(eq(scmReturns.id, data.returnId))
    .limit(1);

  if (!existing) {
    return { success: false, error: "Data retur tidak ditemukan." };
  }
  if (existing.status === "Pending") {
    return { success: false, error: "Retur ini masih menunggu pickup." };
  }

  await db
    .update(scmReturns)
    .set({ status: "Pending", pickedUpAt: null, pickedUpBy: null })
    .where(and(eq(scmReturns.id, data.returnId), isNotNull(scmReturns.pickedUpAt)));

  await logAudit(
    user,
    "scm_returns",
    existing.id,
    "STATUS_CHANGE",
    { status: "PickedUp" },
    { status: "Pending", reason: data.reason },
  );

  return { success: true };
}

export const reopenScmReturn = createServerFn({ method: "POST" })
  .validator(z.object({ returnId: z.string().uuid(), reason: z.string().min(1) }))
  .handler(async ({ data }) => {
    const user = await requireRole("admin_pusat", "super_admin");
    return reopenScmReturnCore(user, data);
  });
