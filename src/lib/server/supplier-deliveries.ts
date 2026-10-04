import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  supplierDeliveries,
  suppliers,
  ingredients,
  users,
  inventory,
  stockLedger,
  branches,
} from "#/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import type { AppUser } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { recalculateRecipeCostsForIngredient } from "./cost-rollup";
import type { DbTx } from "./ingredient-resolver";

// ─── Helpers ───

async function getCentralBranchId(): Promise<string> {
  const [central] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.code, "CENTRAL"))
    .limit(1);
  if (!central) throw new Error("Central warehouse branch not found");
  return central.id;
}

/** A goods receipt is a positive quantity. A non-positive one is nonsense at the
 *  boundary: the only sign check lives in the form, so without this the cores
 *  treat a negative `quantity` as a reversal and leave partial state. */
function assertReceivableQuantity(quantity: number): void {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`Jumlah barang masuk harus lebih dari 0 (diberi ${quantity})`);
  }
}

/**
 * Apply a signed delta to a branch's inventory and record it on the Kartu Stok,
 * inside the caller's transaction.
 *
 * Reversing a booking is refused when the stock on hand cannot cover it. The
 * previous `Math.max(0, …)` clamp silently applied less than the caller asked
 * for while the ledger row still recorded the full requested quantity, so
 * `stock_ledger.quantity` stopped matching the movement actually applied to
 * `inventory` and the two drifted apart by exactly the clamped amount. On
 * 2026-09-27 that is how `Delete Supplier Delivery: PT Kreasi Delapan Delapan`
 * put Central's Tepung Terigu 13 032 gr out of step with its own ledger.
 *
 * `FOR UPDATE` serialises concurrent writes to the same item, and the inventory
 * write and its ledger row share the caller's transaction, so a movement can
 * never land without its ledger entry.
 */
async function upsertInventory(
  tx: DbTx,
  branchId: string,
  ingredientId: string,
  delta: number,
  reference: string,
  notes: string,
) {
  const [existing] = await tx
    .select()
    .from(inventory)
    .where(and(eq(inventory.branchId, branchId), eq(inventory.ingredientId, ingredientId)))
    .for("update")
    .limit(1);

  if (!existing) {
    if (delta < 0) throw new Error("Cannot deduct from non-existent inventory");
    await tx.insert(inventory).values({
      branchId,
      ingredientId,
      quantity: delta,
    });

    await tx.insert(stockLedger).values({
      branchId,
      ingredientId,
      type: "IN",
      quantity: delta,
      balance: delta,
      reference,
      notes,
    });
    return;
  }

  if (existing.quantity + delta < 0) {
    throw new Error(
      `Stok tidak cukup untuk membatalkan: ${notes} — requires ${Math.abs(delta)}, tersedia ${existing.quantity}`,
    );
  }

  const newQty = existing.quantity + delta;
  await tx
    .update(inventory)
    .set({ quantity: newQty, lastUpdated: new Date() })
    .where(eq(inventory.id, existing.id));

  await tx.insert(stockLedger).values({
    branchId,
    ingredientId,
    type: delta >= 0 ? "IN" : "OUT",
    quantity: Math.abs(delta),
    balance: newQty,
    reference,
    notes,
  });
}

// ─── Get All Suppliers ───

export const getSuppliers = createServerFn({ method: "GET" }).handler(async () => {
  await requireAuth();
  const result = await db.select().from(suppliers).orderBy(suppliers.name);
  return result;
});

// ─── Get All Supplier Deliveries ───

export const getSupplierDeliveries = createServerFn({ method: "GET" }).handler(async () => {
  await requireAuth();

  const result = await db
    .select({
      id: supplierDeliveries.id,
      supplierId: supplierDeliveries.supplierId,
      supplierName: supplierDeliveries.supplierName,
      ingredientId: supplierDeliveries.ingredientId,
      ingredientName: ingredients.name,
      ingredientStockUnit: ingredients.stockUnit,
      quantity: supplierDeliveries.quantity,
      price: supplierDeliveries.price,
      deliveryDate: supplierDeliveries.deliveryDate,
      receivedBy: supplierDeliveries.receivedBy,
      receivedByName: users.name,
      status: supplierDeliveries.status,
      createdAt: supplierDeliveries.createdAt,
    })
    .from(supplierDeliveries)
    .leftJoin(ingredients, eq(supplierDeliveries.ingredientId, ingredients.id))
    .leftJoin(users, eq(supplierDeliveries.receivedBy, users.id))
    .orderBy(desc(supplierDeliveries.deliveryDate));

  return result;
});

// ─── Get Single Supplier Delivery ───

export const getSupplierDelivery = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const [result] = await db
      .select({
        id: supplierDeliveries.id,
        supplierId: supplierDeliveries.supplierId,
        supplierName: supplierDeliveries.supplierName,
        ingredientId: supplierDeliveries.ingredientId,
        ingredientName: ingredients.name,
        ingredientStockUnit: ingredients.stockUnit,
        quantity: supplierDeliveries.quantity,
        price: supplierDeliveries.price,
        deliveryDate: supplierDeliveries.deliveryDate,
        receivedBy: supplierDeliveries.receivedBy,
        receivedByName: users.name,
        status: supplierDeliveries.status,
        createdAt: supplierDeliveries.createdAt,
      })
      .from(supplierDeliveries)
      .leftJoin(ingredients, eq(supplierDeliveries.ingredientId, ingredients.id))
      .leftJoin(users, eq(supplierDeliveries.receivedBy, users.id))
      .where(eq(supplierDeliveries.id, data.id))
      .limit(1);

    return result ?? null;
  });

// ─── Create Supplier Delivery ───

export const createSupplierDelivery = createServerFn({ method: "POST" })
  .validator(
    (data: { supplierName: string; ingredientId: string; quantity: number; price: number }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return createSupplierDeliveryCore(user, data);
  });

/** The business logic behind `createSupplierDelivery`, parameterized by an
 *  explicit user so it can be driven directly (e.g. from integration tests).
 *  Mirrors the wrapper's `requireRole(...)` guard so wrong-role actors are
 *  rejected even when called without the HTTP session. */
export async function createSupplierDeliveryCore(
  user: AppUser,
  data: { supplierName: string; ingredientId: string; quantity: number; price: number },
) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  // Look up supplier by name
  const [supplier] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(eq(suppliers.name, data.supplierName))
    .limit(1);

  const centralBranchId = await getCentralBranchId();
  const deliveryDate = new Date();

  assertReceivableQuantity(data.quantity);

  // The delivery row and its stock effect share one transaction: a delivery that
  // cannot be booked must not leave an orphan row behind.
  const delivery = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(supplierDeliveries)
      .values({
        supplierId: supplier?.id ?? null,
        supplierName: data.supplierName,
        ingredientId: data.ingredientId,
        quantity: data.quantity,
        price: data.price,
        deliveryDate,
        receivedBy: user.id,
        status: "Pending Invoice",
      })
      .returning();

    await upsertInventory(
      tx,
      centralBranchId,
      created.ingredientId,
      created.quantity,
      created.id,
      `Supplier Delivery: ${data.supplierName}`,
    );

    return created;
  });

  await logSystemAction(
    user,
    "Create Supplier Delivery",
    `Barang masuk dari "${data.supplierName}" (${data.ingredientId} ${data.quantity}) dicatat oleh ${user.name}`,
  );
  await logAudit(user, "supplierDeliveries", delivery.id, "CREATE", undefined, delivery);

  // Trigger BOM cost roll-up for affected ingredient
  await recalculateRecipeCostsForIngredient(data.ingredientId);

  return delivery;
}

// ─── Update Supplier Delivery ───

export const updateSupplierDelivery = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      supplierName?: string;
      ingredientId?: string;
      quantity?: number;
      price?: number;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return updateSupplierDeliveryCore(user, data);
  });

export async function updateSupplierDeliveryCore(
  user: AppUser,
  data: {
    id: string;
    supplierName?: string;
    ingredientId?: string;
    quantity?: number;
    price?: number;
  },
) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  // Fetch existing delivery
  const [existing] = await db
    .select()
    .from(supplierDeliveries)
    .where(eq(supplierDeliveries.id, data.id))
    .limit(1);

  if (!existing) throw new Error("Supplier delivery not found");

  const oldIngredientId = existing.ingredientId;
  const oldQuantity = existing.quantity;
  const newIngredientId = data.ingredientId ?? oldIngredientId;
  const newQuantity = data.quantity ?? oldQuantity;
  assertReceivableQuantity(newQuantity);

  const centralBranchId = await getCentralBranchId();

  // Look up new supplier ID if name changed
  let newSupplierId = existing.supplierId;
  if (data.supplierName && data.supplierName !== existing.supplierName) {
    const [supplier] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.name, data.supplierName))
      .limit(1);
    newSupplierId = supplier?.id ?? null;
  }

  // Revert, re-apply, and rewrite the delivery row in one transaction. The revert
  // can be refused for want of stock, and a refusal must not leave the revert
  // applied with the re-apply missing.
  const updated = await db.transaction(async (tx) => {
    await upsertInventory(
      tx,
      centralBranchId,
      oldIngredientId,
      -oldQuantity,
      data.id,
      `Revert Supplier Delivery: ${existing.supplierName}`,
    );

    await upsertInventory(
      tx,
      centralBranchId,
      newIngredientId,
      newQuantity,
      data.id,
      `Supplier Delivery Update: ${data.supplierName ?? existing.supplierName}`,
    );

    const [row] = await tx
      .update(supplierDeliveries)
      .set({
        supplierId: newSupplierId,
        supplierName: data.supplierName ?? existing.supplierName,
        ingredientId: newIngredientId,
        quantity: newQuantity,
        price: data.price ?? existing.price,
      })
      .where(eq(supplierDeliveries.id, data.id))
      .returning();
    return row;
  });

  await logSystemAction(
    user,
    "Update Supplier Delivery",
    `Barang masuk "${data.id}" diperbarui oleh ${user.name}`,
  );
  await logAudit(user, "supplierDeliveries", data.id, "UPDATE", existing, updated);

  return updated;
}

// ─── Delete Supplier Delivery ───

export const deleteSupplierDelivery = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return deleteSupplierDeliveryCore(user, data);
  });

export async function deleteSupplierDeliveryCore(user: AppUser, data: { id: string }) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  // Fetch existing delivery
  const [existing] = await db
    .select()
    .from(supplierDeliveries)
    .where(eq(supplierDeliveries.id, data.id))
    .limit(1);

  if (!existing) throw new Error("Supplier delivery not found");

  const centralBranchId = await getCentralBranchId();

  // Deduct and remove the record together: a refusal must keep the delivery row.
  await db.transaction(async (tx) => {
    await upsertInventory(
      tx,
      centralBranchId,
      existing.ingredientId,
      -existing.quantity,
      data.id,
      `Delete Supplier Delivery: ${existing.supplierName}`,
    );
    await tx.delete(supplierDeliveries).where(eq(supplierDeliveries.id, data.id));
  });

  await logSystemAction(
    user,
    "Delete Supplier Delivery",
    `Barang masuk "${data.id}" dihapus oleh ${user.name}`,
  );
  await logAudit(user, "supplierDeliveries", data.id, "DELETE", existing, undefined);

  return { success: true };
}

// ─── Mark Supplier Delivery as Completed ───

export const completeSupplierDelivery = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return completeSupplierDeliveryCore(user, data);
  });

export async function completeSupplierDeliveryCore(user: AppUser, data: { id: string }) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  // Fetch existing delivery
  const [existing] = await db
    .select()
    .from(supplierDeliveries)
    .where(eq(supplierDeliveries.id, data.id))
    .limit(1);

  if (!existing) throw new Error("Supplier delivery not found");

  if (existing.status === "Completed") {
    throw new Error("Delivery already completed");
  }

  // Update status to Completed
  const [updated] = await db
    .update(supplierDeliveries)
    .set({ status: "Completed" })
    .where(eq(supplierDeliveries.id, data.id))
    .returning();

  await logSystemAction(
    user,
    "Complete Supplier Delivery",
    `Barang masuk "${data.id}" ditandai selesai oleh ${user.name}`,
  );
  await logAudit(user, "supplierDeliveries", data.id, "STATUS_CHANGE", existing, updated);

  return { success: true };
}
