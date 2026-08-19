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
import { logSystemAction, logAudit } from "./logging";
import { recalculateRecipeCostsForIngredient } from "./cost-rollup";

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

async function upsertInventory(
  branchId: string,
  ingredientId: string,
  delta: number,
  reference: string,
  notes: string,
) {
  const [existing] = await db
    .select()
    .from(inventory)
    .where(and(eq(inventory.branchId, branchId), eq(inventory.ingredientId, ingredientId)))
    .limit(1);

  if (existing) {
    const newQty = Math.max(0, existing.quantity + delta);
    await db
      .update(inventory)
      .set({ quantity: newQty, lastUpdated: new Date() })
      .where(eq(inventory.id, existing.id));

    await db.insert(stockLedger).values({
      branchId,
      ingredientId,
      type: delta >= 0 ? "IN" : "OUT",
      quantity: Math.abs(delta),
      balance: newQty,
      reference,
      notes,
    });
  } else {
    if (delta < 0) throw new Error("Cannot deduct from non-existent inventory");
    await db.insert(inventory).values({
      branchId,
      ingredientId,
      quantity: delta,
    });

    await db.insert(stockLedger).values({
      branchId,
      ingredientId,
      type: "IN",
      quantity: delta,
      balance: delta,
      reference,
      notes,
    });
  }
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

    // Look up supplier by name
    const [supplier] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.name, data.supplierName))
      .limit(1);

    const centralBranchId = await getCentralBranchId();
    const deliveryDate = new Date();

    // Insert delivery record
    const [delivery] = await db
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

    // Update inventory for central branch
    await upsertInventory(
      centralBranchId,
      data.ingredientId,
      data.quantity,
      delivery.id,
      `Supplier Delivery: ${data.supplierName}`,
    );

    await logSystemAction(
      user,
      "Create Supplier Delivery",
      `Barang masuk dari "${data.supplierName}" (${data.ingredientId} ${data.quantity}) dicatat oleh ${user.name}`,
    );
    await logAudit(user, "supplierDeliveries", delivery.id, "CREATE", undefined, delivery);

    // Trigger BOM cost roll-up for affected ingredient
    await recalculateRecipeCostsForIngredient(data.ingredientId);

    return delivery;
  });

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

    // Fetch existing delivery
    const [existing] = await db
      .select()
      .from(supplierDeliveries)
      .where(eq(supplierDeliveries.id, data.id))
      .limit(1);

    if (!existing) throw new Error("Supplier delivery not found");

    const centralBranchId = await getCentralBranchId();

    const oldIngredientId = existing.ingredientId;
    const oldQuantity = existing.quantity;
    const newIngredientId = data.ingredientId ?? oldIngredientId;
    const newQuantity = data.quantity ?? oldQuantity;

    // Revert old inventory
    await upsertInventory(
      centralBranchId,
      oldIngredientId,
      -oldQuantity,
      data.id,
      `Revert Supplier Delivery: ${existing.supplierName}`,
    );

    // If ingredient changed, also need to handle the new ingredient separately
    // (the revert above already deducted old ingredient)
    // Apply new inventory
    if (newIngredientId !== oldIngredientId) {
      // New ingredient gets the new quantity added
      await upsertInventory(
        centralBranchId,
        newIngredientId,
        newQuantity,
        data.id,
        `Supplier Delivery Update: ${data.supplierName ?? existing.supplierName}`,
      );
    } else {
      // Same ingredient — add the new quantity
      await upsertInventory(
        centralBranchId,
        newIngredientId,
        newQuantity,
        data.id,
        `Supplier Delivery Update: ${data.supplierName ?? existing.supplierName}`,
      );
    }

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

    // Update delivery record
    const [updated] = await db
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

    await logSystemAction(
      user,
      "Update Supplier Delivery",
      `Barang masuk "${data.id}" diperbarui oleh ${user.name}`,
    );
    await logAudit(user, "supplierDeliveries", data.id, "UPDATE", existing, updated);

    return updated;
  });

// ─── Delete Supplier Delivery ───

export const deleteSupplierDelivery = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    // Fetch existing delivery
    const [existing] = await db
      .select()
      .from(supplierDeliveries)
      .where(eq(supplierDeliveries.id, data.id))
      .limit(1);

    if (!existing) throw new Error("Supplier delivery not found");

    const centralBranchId = await getCentralBranchId();

    // Deduct from inventory
    await upsertInventory(
      centralBranchId,
      existing.ingredientId,
      -existing.quantity,
      data.id,
      `Delete Supplier Delivery: ${existing.supplierName}`,
    );

    // Delete delivery record
    await db.delete(supplierDeliveries).where(eq(supplierDeliveries.id, data.id));

    await logSystemAction(
      user,
      "Delete Supplier Delivery",
      `Barang masuk "${data.id}" dihapus oleh ${user.name}`,
    );
    await logAudit(user, "supplierDeliveries", data.id, "DELETE", existing, undefined);

    return { success: true };
  });

// ─── Mark Supplier Delivery as Completed ───

export const completeSupplierDelivery = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

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
  });
