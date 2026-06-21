// =============================================================================
// Mutasi Stok query helpers and authorization (ADR 0006).
//
// Pure functions where possible. The DB-touching helpers (loaders) live here
// too — they are used by both the server functions and the UI routes.
// =============================================================================

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth } from "./auth";
import {
  branches,
  ingredients,
  scmTransferAuditLog,
  scmTransferInvoices,
  scmTransferItems,
  scmTransfers,
  users,
} from "#/db/schema";
import type { FsmActor } from "./scm-effects";

// -----------------------------------------------------------------------------
// Authorization helpers (Q8)
// -----------------------------------------------------------------------------

/**
 * An AM can ACT on a transfer only if BOTH branches are in their
 * `assignedBranches`. Strict rule per Q8 / ADR 0006.
 */
export function canAmAct(
  am: { assignedBranches?: string[] | null },
  transfer: { fromBranchId: string; toBranchId: string },
): boolean {
  const set = am.assignedBranches;
  if (!set) return false;
  return set.includes(transfer.fromBranchId) && set.includes(transfer.toBranchId);
}

/**
 * An AM can SEE a transfer if EITHER branch is in their `assignedBranches`.
 * Lenient rule per Q8. AMs with a view-only transfer get no action buttons
 * and a "cross-jurisdiction" badge in the dashboard.
 */
export function canAmSee(
  am: { assignedBranches?: string[] | null },
  transfer: { fromBranchId: string; toBranchId: string },
): boolean {
  const set = am.assignedBranches;
  if (!set) return false;
  return set.includes(transfer.fromBranchId) || set.includes(transfer.toBranchId);
}

/**
 * Server-side access guard. Throws if the user cannot view / act on the
 * transfer per the rules in ADR 0006 + Q8. Use `mode: "view"` for read
 * access; `mode: "act"` for state-changing operations (the FSM also enforces
 * role authorization, this guard enforces branch-level access).
 */
export function assertTransferAccess(
  user: { id: string; role: string; branchId?: string | null; assignedBranches?: string[] | null },
  transfer: { fromBranchId: string; toBranchId: string },
  mode: "view" | "act",
): void {
  // super_admin sees/acts on everything
  if (user.role === "super_admin") return;

  // admin_pusat is never an actor on Mutasi (Q4 / Q8). They have no business
  // relationship with branch-to-branch transfers.
  if (user.role === "admin_pusat") {
    throw new Error("admin_pusat cannot access Mutasi Stok transfers");
  }

  // branch_admin: must be at one of the two branches
  if (user.role === "branch_admin") {
    if (user.branchId && (user.branchId === transfer.fromBranchId || user.branchId === transfer.toBranchId)) {
      return;
    }
    throw new Error("branch_admin can only access transfers involving their branch");
  }

  // area_manager: view = canAmSee; act = canAmAct
  if (user.role === "area_manager") {
    if (mode === "view") {
      if (canAmSee(user, transfer)) return;
      throw new Error("area_manager cannot see this transfer (outside their assigned branches)");
    } else {
      if (canAmAct(user, transfer)) return;
      throw new Error("area_manager cannot act on this transfer (cross-jurisdiction)");
    }
  }

  // Other roles (cashier, central_kitchen, etc.) are not Mutasi actors
  throw new Error(`Role ${user.role} is not authorized for Mutasi Stok`);
}

// -----------------------------------------------------------------------------
// List / single loaders
// -----------------------------------------------------------------------------

export interface TransferListRow {
  id: string;
  code: string;
  fromBranchId: string;
  toBranchId: string;
  status: string;
  createdAt: Date;
  requestedById: string;
}

/**
 * List transfers visible to the current user, applying role-based filtering
 * (Q8 / Phase 4 §4.3).
 *
 * - super_admin: no filter
 * - branch_admin: only transfers where their branch is from or to
 * - area_manager: only transfers where at least one branch is in their set
 * - admin_pusat: returns [] (no Mutasi access)
 * - other roles: throw
 *
 * The UI then post-filters the result into "actionable" and "view-only"
 * buckets for AMs by computing `canAmAct` / `canAmSee` client-side.
 */
export async function listTransfersForUser(user: {
  id: string;
  role: string;
  branchId?: string | null;
  assignedBranches?: string[] | null;
}): Promise<TransferListRow[]> {
  let whereClause;
  if (user.role === "super_admin") {
    whereClause = undefined;
  } else if (user.role === "admin_pusat") {
    return [];
  } else if (user.role === "branch_admin") {
    if (!user.branchId) return [];
    whereClause = or(
      eq(scmTransfers.fromBranchId, user.branchId),
      eq(scmTransfers.toBranchId, user.branchId),
    );
  } else if (user.role === "area_manager") {
    if (!user.assignedBranches || user.assignedBranches.length === 0) return [];
    whereClause = or(
      inArray(scmTransfers.fromBranchId, user.assignedBranches),
      inArray(scmTransfers.toBranchId, user.assignedBranches),
    );
  } else {
    return [];
  }

  const query = db
    .select({
      id: scmTransfers.id,
      code: scmTransfers.code,
      fromBranchId: scmTransfers.fromBranchId,
      toBranchId: scmTransfers.toBranchId,
      status: scmTransfers.status,
      createdAt: scmTransfers.createdAt,
      requestedById: scmTransfers.requestedById,
    })
    .from(scmTransfers)
    .orderBy(desc(scmTransfers.createdAt));

  return whereClause ? await query.where(whereClause) : await query;
}

/**
 * Single-transfer loader. Returns the transfer with its items and (if any)
 * invoice. The caller is responsible for `assertTransferAccess` before
 * surfacing this data to the user.
 */
export async function loadTransferWithItems(transferId: string): Promise<{
  transfer: typeof scmTransfers.$inferSelect;
  items: (typeof scmTransferItems.$inferSelect)[];
  invoice: typeof scmTransferInvoices.$inferSelect | null;
} | null> {
  const [transfer] = await db
    .select()
    .from(scmTransfers)
    .where(eq(scmTransfers.id, transferId))
    .limit(1);
  if (!transfer) return null;

  const items = await db
    .select()
    .from(scmTransferItems)
    .where(eq(scmTransferItems.scmTransferId, transferId))
    .orderBy(scmTransferItems.sortOrder);

  const [invoice] = await db
    .select()
    .from(scmTransferInvoices)
    .where(eq(scmTransferInvoices.scmTransferId, transferId))
    .limit(1);

  return { transfer, items, invoice: invoice ?? null };
}

/**
 * Audit log entries for a transfer, oldest-first (so the timeline reads
 * top-to-bottom as a story).
 */
export async function loadTransferAuditLog(
  transferId: string,
): Promise<(typeof scmTransferAuditLog.$inferSelect)[]> {
  return db
    .select()
    .from(scmTransferAuditLog)
    .where(eq(scmTransferAuditLog.scmTransferId, transferId))
    .orderBy(scmTransferAuditLog.createdAt);
}

// -----------------------------------------------------------------------------
// User / branch reference loaders (used by the UI for dropdowns)
// -----------------------------------------------------------------------------

export async function loadActiveBranches() {
  return db.select().from(branches).where(eq(branches.active, true));
}

export async function loadActiveIngredients() {
  return db.select().from(ingredients);
}

export async function loadUserById(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return u ?? null;
}

// -----------------------------------------------------------------------------
// Current-user convenience wrapper
// -----------------------------------------------------------------------------

/**
 * Load the current user via `requireAuth()` and return both the user record
 * and the role-typed `FsmActor` shape used by the FSM. Use this in server
 * functions that need to call `transitionTransfer`.
 */
export async function requireAuthAsFsmActor(): Promise<{
  user: Awaited<ReturnType<typeof requireAuth>>;
  actor: FsmActor;
}> {
  const user = await requireAuth();
  return { user, actor: { id: user.id, role: user.role } };
}

// Suppress unused import warnings for `and` and `sql` (kept for future
// filters; the linter doesn't see how they're already used).
void and;
void sql;
