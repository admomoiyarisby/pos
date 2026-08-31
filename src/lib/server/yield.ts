import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  yieldConversions,
  yieldConversionItems,
  yieldCancelRequests,
  inventory,
  stockLedger,
  ingredients,
  users,
  areaManagerBranches,
  systemNotifications,
  branches,
} from "#/db/schema";
import { and, eq, inArray, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import type { AppUser } from "./auth";
import { logSystemAction, logAudit } from "./logging";

// ─── Stock effect (ADR 0012) ────────────────────────────────────────────────
// Recording a production mutates stock at the record's branch: Barang Keluar is
// deducted (OUT), Barang Dihasilkan is added (IN) — each mirrored to Kartu Stok
// (stockLedger) with a shared `YIELD-<conversionId>` reference and a balance
// equal to the post-write inventory.quantity. Negative resulting stock is
// allowed (no guard, no clamp). Runs inside the caller's transaction.

type YieldTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function applyYieldStockEffect(
  tx: YieldTx,
  branchId: string,
  conversionId: string,
  deltas: { ingredientId: string; signedDelta: number }[],
  opts: { cancelled?: boolean } = {},
): Promise<void> {
  const reference = `YIELD-${conversionId}`;
  const id8 = conversionId.slice(0, 8);
  const note = opts.cancelled ? `Produksi dibatalkan ${id8}` : `Produksi ${id8}`;

  // Lock touched rows in a consistent order (by ingredientId) so concurrent
  // records touching the same ingredients cannot deadlock.
  const ordered = [...deltas].sort((a, b) => (a.ingredientId < b.ingredientId ? -1 : 1));

  for (const { ingredientId, signedDelta } of ordered) {
    if (signedDelta === 0) continue;

    const [inv] = await tx
      .select()
      .from(inventory)
      .where(and(eq(inventory.branchId, branchId), eq(inventory.ingredientId, ingredientId)))
      .for("update")
      .limit(1);

    const newQty = (inv?.quantity ?? 0) + signedDelta;

    if (inv) {
      await tx
        .update(inventory)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(eq(inventory.id, inv.id));
    } else {
      // Upsert-from-0 (ADR 0012): a never-stocked ingredient starts at 0, so an
      // OUT creates a negative row and a PRODUCED creates a positive one.
      await tx.insert(inventory).values({
        branchId,
        ingredientId,
        quantity: newQty,
      });
    }

    await tx.insert(stockLedger).values({
      branchId,
      ingredientId,
      type: signedDelta > 0 ? "IN" : "OUT",
      quantity: Math.abs(signedDelta),
      balance: newQty,
      reference,
      notes: note,
    });
  }
}

/** Reverse a production's stock effect when it is cancelled (ADR 0012): restore
 *  each Barang Keluar (IN) and deduct each Barang Dihasilkan (OUT), writing
 *  opposite-type ledger rows on the same `YIELD-<id>` reference. Only records
 *  that wrote stock are reversed — records created before ADR 0012 have no
 *  ledger rows to reverse. */
async function reverseYieldStockEffect(
  tx: YieldTx,
  conversionId: string,
  branchId: string,
): Promise<void> {
  const reference = `YIELD-${conversionId}`;
  const [wroteStock] = await tx
    .select()
    .from(stockLedger)
    .where(eq(stockLedger.reference, reference))
    .limit(1);
  if (!wroteStock) return;

  const items = await tx
    .select()
    .from(yieldConversionItems)
    .where(eq(yieldConversionItems.conversionId, conversionId));

  await applyYieldStockEffect(
    tx,
    branchId,
    conversionId,
    items.map((it) => ({
      ingredientId: it.ingredientId,
      // restore OUT items (IN), deduct PRODUCED items (OUT)
      signedDelta: it.direction === "OUT" ? it.quantity : -it.quantity,
    })),
    { cancelled: true },
  );
}

export const getYieldConversions = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; includeCancelled?: boolean }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole(
      "super_admin",
      "central_kitchen",
      "branch_admin",
      "area_manager",
    );

    const conditions: import("drizzle-orm").SQL[] = [];
    if (!data.includeCancelled) {
      conditions.push(eq(yieldConversions.status, "Active"));
    }
    if (user.role === "branch_admin" && user.branchId) {
      conditions.push(eq(yieldConversions.branchId, user.branchId));
    } else if (user.role === "area_manager" && user.assignedBranches?.length) {
      conditions.push(inArray(yieldConversions.branchId, user.assignedBranches));
    } else if (data.branchId) {
      // central roles can filter by branchId param
      conditions.push(eq(yieldConversions.branchId, data.branchId));
    }

    const conversions = await db
      .select({
        id: yieldConversions.id,
        branchId: yieldConversions.branchId,
        branchName: branches.name,
        notes: yieldConversions.notes,
        productionDate: yieldConversions.productionDate,
        createdAt: yieldConversions.createdAt,
        processedBy: yieldConversions.processedBy,
        recordedByName: users.name,
        status: yieldConversions.status,
        cancelledAt: yieldConversions.cancelledAt,
        cancelledBy: yieldConversions.cancelledBy,
        cancelReason: yieldConversions.cancelReason,
      })
      .from(yieldConversions)
      .leftJoin(branches, eq(yieldConversions.branchId, branches.id))
      .leftJoin(users, eq(yieldConversions.processedBy, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(yieldConversions.createdAt);

    const conversionIds = conversions.map((c) => c.id);
    let items: {
      conversionId: string;
      ingredientId: string;
      quantity: number;
      direction: "OUT" | "PRODUCED";
      ingredientName: string | null;
    }[] = [];
    if (conversionIds.length > 0) {
      items = await db
        .select({
          conversionId: yieldConversionItems.conversionId,
          ingredientId: yieldConversionItems.ingredientId,
          quantity: yieldConversionItems.quantity,
          direction: yieldConversionItems.direction,
          ingredientName: ingredients.name,
        })
        .from(yieldConversionItems)
        .leftJoin(ingredients, eq(yieldConversionItems.ingredientId, ingredients.id))
        .where(inArray(yieldConversionItems.conversionId, conversionIds));
    }

    const byConversion: Record<string, typeof items> = {};
    for (const it of items) {
      (byConversion[it.conversionId] ??= []).push(it);
    }

    return conversions.map((c) => {
      const convItems = byConversion[c.id] ?? [];
      return {
        ...c,
        out: convItems
          .filter((i) => i.direction === "OUT")
          .map((i) => ({
            ingredientId: i.ingredientId,
            quantity: i.quantity,
            ingredientName: i.ingredientName,
          })),
        produced: convItems
          .filter((i) => i.direction === "PRODUCED")
          .map((i) => ({
            ingredientId: i.ingredientId,
            quantity: i.quantity,
            ingredientName: i.ingredientName,
          })),
      };
    });
  });

export const createYieldConversion = createServerFn({ method: "POST" })
  .validator(
    (data: {
      branchId: string;
      out: { ingredientId: string; quantity: number }[];
      produced: { ingredientId: string; quantity: number }[];
      notes?: string;
      productionDate?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "central_kitchen", "branch_admin");
    return createYieldConversionCore(user, data);
  });

/** The business logic behind `createYieldConversion`, parameterized by an
 *  explicit user so it can be driven directly (e.g. from integration tests).
 *  Mirrors the wrapper's `requireRole(...)` guard so wrong-role actors are
 *  rejected even when called without the HTTP session. */
export async function createYieldConversionCore(
  user: AppUser,
  data: {
    branchId: string;
    out: { ingredientId: string; quantity: number }[];
    produced: { ingredientId: string; quantity: number }[];
    notes?: string;
    productionDate?: string;
  },
) {
  if (!["super_admin", "central_kitchen", "branch_admin"].includes(user.role)) {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | central_kitchen | branch_admin)`,
    );
  }

  // Branch admins record production only against their own branch; the
  // submitted branchId is ignored for them (client can't be trusted).
  const branchId = data.branchId || (user.role === "branch_admin" ? user.branchId : undefined);
  if (user.role === "branch_admin" && branchId !== user.branchId) {
    throw new Error("Unauthorized branch");
  }
  if (!branchId) throw new Error("Branch is required");

  const out = (data.out ?? []).filter((s) => s.ingredientId && s.quantity > 0);
  const produced = (data.produced ?? []).filter((s) => s.ingredientId && s.quantity > 0);

  if (out.length === 0) throw new Error("Setidaknya satu bahan keluar (out) diperlukan");
  if (produced.length === 0)
    throw new Error("Setidaknya satu bahan dihasilkan (produced) diperlukan");

  // An ingredient cannot be both consumed and produced in the same record.
  const outIds = new Set(out.map((s) => s.ingredientId));
  const producedIds = new Set(produced.map((s) => s.ingredientId));
  const conflict = [...producedIds].find((id) => outIds.has(id));
  if (conflict) {
    throw new Error("Bahan yang sama tidak boleh menjadi keluar sekaligus dihasilkan");
  }

  // Each ingredient may appear only once per side.
  if (outIds.size !== out.length || producedIds.size !== produced.length) {
    throw new Error("Bahan tidak boleh muncul lebih dari satu kali dalam satu sisi");
  }

  const allIds = [...outIds, ...producedIds];
  const ingMap = new Map(
    (
      await db
        .select()
        .from(ingredients)
        .where(inArray(ingredients.id, [...allIds]))
    ).map((i) => [i.id, i]),
  );
  const missing = [...allIds].filter((id) => !ingMap.has(id));
  if (missing.length > 0) throw new Error(`Bahan tidak ditemukan: ${missing.join(", ")}`);

  // Record + stock effect in ONE transaction (ADR 0012) — an error anywhere
  // leaves no partial writes.
  const conversion = await db.transaction(async (tx) => {
    const [conversion] = await tx
      .insert(yieldConversions)
      .values({
        branchId,
        notes: data.notes,
        processedBy: user.id,
        productionDate: data.productionDate ? new Date(data.productionDate) : new Date(),
      })
      .returning();

    const itemsToInsert: {
      conversionId: string;
      ingredientId: string;
      quantity: number;
      direction: "OUT" | "PRODUCED";
    }[] = [
      ...out.map((s) => ({
        conversionId: conversion.id,
        ingredientId: s.ingredientId,
        quantity: s.quantity,
        direction: "OUT" as const,
      })),
      ...produced.map((s) => ({
        conversionId: conversion.id,
        ingredientId: s.ingredientId,
        quantity: s.quantity,
        direction: "PRODUCED" as const,
      })),
    ];
    await tx.insert(yieldConversionItems).values(itemsToInsert);

    // Stock effect (ADR 0012): deduct Barang Keluar (OUT), add Barang
    // Dihasilkan (IN), each mirrored to Kartu Stok with a shared YIELD-* ref.
    await applyYieldStockEffect(tx, branchId, conversion.id, [
      ...out.map((s) => ({ ingredientId: s.ingredientId, signedDelta: -s.quantity })),
      ...produced.map((s) => ({ ingredientId: s.ingredientId, signedDelta: s.quantity })),
    ]);

    return conversion;
  });

  const outNames = out
    .map((s) => `${ingMap.get(s.ingredientId)?.name ?? s.ingredientId} (${s.quantity})`)
    .join(" + ");
  const producedNames = produced
    .map((s) => `${ingMap.get(s.ingredientId)?.name ?? s.ingredientId} (${s.quantity})`)
    .join(" + ");

  await logSystemAction(
    user,
    "Create Production Record",
    `Produksi "${outNames} → ${producedNames}" dicatat dan stok diperbarui oleh ${user.name}`,
  );
  await logAudit(user, "yieldConversions", conversion.id, "CREATE", undefined, conversion);

  return { success: true, conversion, out, produced };
}

// ─── Yield Cancellation — request → approval (branch_admin → super_admin/area_manager) ───

function canAreaManagerApproveYield(
  assignedBranches: string[] | null | undefined,
  yieldBranchId: string,
): boolean {
  return !!assignedBranches?.includes(yieldBranchId);
}

export const requestYieldCancel = createServerFn({ method: "POST" })
  .validator((data: { yieldConversionId: string; reason: string; detail?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    return requestYieldCancelCore(user, data);
  });

export async function requestYieldCancelCore(
  user: AppUser,
  data: { yieldConversionId: string; reason: string; detail?: string },
) {
  if (!["branch_admin", "central_kitchen", "super_admin"].includes(user.role)) {
    throw new Error(
      "Unauthorized: only branch_admin, central_kitchen, or super_admin may request cancel",
    );
  }
  const reason = (data.reason ?? "").trim();
  if (!reason) throw new Error("Alasan pembatalan wajib diisi");

  const [yc] = await db
    .select()
    .from(yieldConversions)
    .where(eq(yieldConversions.id, data.yieldConversionId))
    .limit(1);
  if (!yc) throw new Error("Produksi tidak ditemukan");
  if (yc.status === "Cancelled") throw new Error("Produksi sudah dibatalkan");

  // Branch scoping for branch_admin / central_kitchen
  if (
    (user.role === "branch_admin" || user.role === "central_kitchen") &&
    user.branchId &&
    yc.branchId !== user.branchId
  ) {
    throw new Error("Unauthorized branch");
  }

  // Duplicate guard: only one Pending per conversion
  const [existing] = await db
    .select()
    .from(yieldCancelRequests)
    .where(
      and(
        eq(yieldCancelRequests.yieldConversionId, data.yieldConversionId),
        eq(yieldCancelRequests.status, "Pending"),
      ),
    )
    .limit(1);
  if (existing) {
    return { ...existing, alreadyPending: true };
  }

  const [req] = await db
    .insert(yieldCancelRequests)
    .values({
      yieldConversionId: data.yieldConversionId,
      reason,
      detail: data.detail?.trim() || null,
      requestedBy: user.id,
      status: "Pending",
    })
    .returning();

  await logSystemAction(
    user,
    "Request Yield Cancel",
    `Permintaan batal Produksi ${data.yieldConversionId.slice(0, 8)} oleh ${user.name}. Alasan: ${reason}`,
  );
  await logAudit(user, "yieldCancelRequests", req.id, "CREATE", undefined, req);

  // Notify super_admin + area_managers for this branch
  const branchId = yc.branchId;
  const superAdmins = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "super_admin"));
  for (const sa of superAdmins) {
    await db.insert(systemNotifications).values({
      userId: sa.id,
      title: "Permintaan Batal Produksi",
      message: `Cabang minta batal Produksi ${yc.id.slice(0, 8)} — alasan: ${reason}`,
      type: "warning",
    });
  }
  const ams = await db
    .select({ userId: areaManagerBranches.userId })
    .from(areaManagerBranches)
    .where(eq(areaManagerBranches.branchId, branchId));
  for (const am of ams) {
    await db.insert(systemNotifications).values({
      userId: am.userId,
      title: "Permintaan Batal Produksi",
      message: `Cabang minta batal Produksi ${yc.id.slice(0, 8)} — alasan: ${reason}`,
      type: "warning",
    });
  }

  return req;
}

export const getYieldCancelRequests = createServerFn({ method: "GET" })
  .validator(
    (
      data:
        | { status?: "Pending" | "Approved" | "Rejected" | "Executed"; branchId?: string }
        | null
        | undefined,
    ) => data ?? {},
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const conditions: import("drizzle-orm").SQL[] = [];
    if (data?.status) conditions.push(eq(yieldCancelRequests.status, data.status));
    if (data?.branchId) conditions.push(eq(yieldConversions.branchId, data.branchId));

    // Area manager sees only their branches
    if (user.role === "area_manager" && user.assignedBranches?.length) {
      conditions.push(inArray(yieldConversions.branchId, user.assignedBranches));
    } else if (user.role === "branch_admin" && user.branchId) {
      conditions.push(eq(yieldConversions.branchId, user.branchId));
    }

    const rows = await db
      .select({
        id: yieldCancelRequests.id,
        yieldConversionId: yieldCancelRequests.yieldConversionId,
        reason: yieldCancelRequests.reason,
        detail: yieldCancelRequests.detail,
        requestedBy: yieldCancelRequests.requestedBy,
        requestedByName: users.name,
        status: yieldCancelRequests.status,
        createdAt: yieldCancelRequests.createdAt,
        branchId: yieldConversions.branchId,
        branchName: branches.name,
        productionDate: yieldConversions.productionDate,
      })
      .from(yieldCancelRequests)
      .leftJoin(yieldConversions, eq(yieldCancelRequests.yieldConversionId, yieldConversions.id))
      .leftJoin(users, eq(yieldCancelRequests.requestedBy, users.id))
      .leftJoin(branches, eq(yieldConversions.branchId, branches.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(yieldCancelRequests.createdAt));

    return rows;
  });

export const getYieldCancelRequestStatus = createServerFn({ method: "GET" })
  .validator((data: { yieldConversionId: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();
    const [req] = await db
      .select()
      .from(yieldCancelRequests)
      .where(eq(yieldCancelRequests.yieldConversionId, data.yieldConversionId))
      .orderBy(desc(yieldCancelRequests.createdAt))
      .limit(1);
    return req ?? null;
  });

export const approveYieldCancelRequest = createServerFn({ method: "POST" })
  .validator((data: { requestId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    return approveYieldCancelRequestCore(user, data);
  });

export async function approveYieldCancelRequestCore(user: AppUser, data: { requestId: string }) {
  if (!["super_admin", "area_manager"].includes(user.role)) {
    throw new Error("Unauthorized: only super_admin or area_manager may approve");
  }

  const [req] = await db
    .select()
    .from(yieldCancelRequests)
    .where(eq(yieldCancelRequests.id, data.requestId))
    .limit(1);
  if (!req) throw new Error("Request not found");
  if (req.status !== "Pending") throw new Error("Request sudah diproses");

  const [yc] = await db
    .select()
    .from(yieldConversions)
    .where(eq(yieldConversions.id, req.yieldConversionId))
    .limit(1);
  if (!yc) throw new Error("Produksi tidak ditemukan");
  if (yc.status === "Cancelled") throw new Error("Produksi sudah dibatalkan");

  if (
    user.role === "area_manager" &&
    !canAreaManagerApproveYield(user.assignedBranches, yc.branchId)
  ) {
    throw new Error(
      "Unauthorized: Area Manager hanya dapat menyetujui untuk cabang yang ditugaskan",
    );
  }

  const updatedReq = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(yieldCancelRequests)
      .set({ status: "Approved", approvedBy: user.id, approvedAt: new Date() })
      .where(eq(yieldCancelRequests.id, data.requestId))
      .returning();
    await tx
      .update(yieldConversions)
      .set({
        status: "Cancelled",
        cancelledAt: new Date(),
        cancelledBy: user.id,
        cancelReason: req.reason,
      })
      .where(eq(yieldConversions.id, req.yieldConversionId));
    // Reverse the stock mutation (restore OUT, deduct PRODUCED) — ADR 0012.
    await reverseYieldStockEffect(tx, req.yieldConversionId, yc.branchId);
    return r;
  });

  await db.insert(systemNotifications).values({
    userId: req.requestedBy,
    title: "Permintaan Batal Produksi Disetujui",
    message: `Produksi ${yc.id.slice(0, 8)} dibatalkan oleh ${user.name}. Alasan: ${req.reason}`,
    type: "info",
  });

  await logSystemAction(
    user,
    "Approve Yield Cancel",
    `Permintaan batal Produksi ${yc.id.slice(0, 8)} disetujui oleh ${user.name}`,
  );
  await logAudit(user, "yieldCancelRequests", data.requestId, "STATUS_CHANGE", req, updatedReq);
  await logAudit(user, "yieldConversions", yc.id, "STATUS_CHANGE", yc, {
    ...yc,
    status: "Cancelled",
  });

  return updatedReq;
}

export const rejectYieldCancelRequest = createServerFn({ method: "POST" })
  .validator((data: { requestId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    return rejectYieldCancelRequestCore(user, data);
  });

export async function rejectYieldCancelRequestCore(user: AppUser, data: { requestId: string }) {
  if (!["super_admin", "area_manager"].includes(user.role)) {
    throw new Error("Unauthorized: only super_admin or area_manager may reject");
  }

  const [req] = await db
    .select()
    .from(yieldCancelRequests)
    .where(eq(yieldCancelRequests.id, data.requestId))
    .limit(1);
  if (!req) throw new Error("Request not found");
  if (req.status !== "Pending") throw new Error("Request sudah diproses");

  const [yc] = await db
    .select()
    .from(yieldConversions)
    .where(eq(yieldConversions.id, req.yieldConversionId))
    .limit(1);
  if (
    user.role === "area_manager" &&
    yc &&
    !canAreaManagerApproveYield(user.assignedBranches, yc.branchId)
  ) {
    throw new Error("Unauthorized: Area Manager hanya dapat menolak untuk cabang yang ditugaskan");
  }

  const [updated] = await db
    .update(yieldCancelRequests)
    .set({ status: "Rejected", approvedBy: user.id, approvedAt: new Date() })
    .where(eq(yieldCancelRequests.id, data.requestId))
    .returning();

  await db.insert(systemNotifications).values({
    userId: req.requestedBy,
    title: "Permintaan Batal Produksi Ditolak",
    message: `Permintaan batal Produksi ${req.yieldConversionId.slice(0, 8)} ditolak oleh ${user.name}`,
    type: "warning",
  });

  await logSystemAction(
    user,
    "Reject Yield Cancel",
    `Permintaan batal Produksi ${req.yieldConversionId.slice(0, 8)} ditolak oleh ${user.name}`,
  );
  await logAudit(user, "yieldCancelRequests", data.requestId, "STATUS_CHANGE", req, updated);
  return updated;
}

export const directCancelYieldConversion = createServerFn({ method: "POST" })
  .validator((data: { yieldConversionId: string; reason: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");
    return directCancelYieldConversionCore(user, data);
  });

export async function directCancelYieldConversionCore(
  user: AppUser,
  data: { yieldConversionId: string; reason: string },
) {
  // Mirrors the wrapper's requireRole("super_admin").
  if (user.role !== "super_admin") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin)`,
    );
  }
  const reason = (data.reason ?? "").trim();
  if (!reason) throw new Error("Alasan pembatalan wajib diisi");

  const [yc] = await db
    .select()
    .from(yieldConversions)
    .where(eq(yieldConversions.id, data.yieldConversionId))
    .limit(1);
  if (!yc) throw new Error("Produksi tidak ditemukan");
  if (yc.status === "Cancelled") throw new Error("Produksi sudah dibatalkan");

  // Cancel + stock reversal in one transaction (ADR 0012).
  const updated = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(yieldConversions)
      .set({
        status: "Cancelled",
        cancelledAt: new Date(),
        cancelledBy: user.id,
        cancelReason: reason,
      })
      .where(eq(yieldConversions.id, data.yieldConversionId))
      .returning();
    await reverseYieldStockEffect(tx, data.yieldConversionId, yc.branchId);
    return updated;
  });

  await logSystemAction(
    user,
    "Direct Cancel Yield",
    `Produksi ${data.yieldConversionId.slice(0, 8)} dibatalkan langsung oleh ${user.name}. Alasan: ${reason}`,
  );
  await logAudit(user, "yieldConversions", data.yieldConversionId, "STATUS_CHANGE", yc, updated);

  // Also create an Executed request record for audit
  await db.insert(yieldCancelRequests).values({
    yieldConversionId: data.yieldConversionId,
    reason,
    requestedBy: user.id,
    approvedBy: user.id,
    status: "Executed",
  });

  return updated;
}
