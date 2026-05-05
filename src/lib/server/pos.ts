import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import {
  recipes,
  recipeBrands,
  brands,
  recipeIngredients,
  recipeModifierGroups,
  modifierGroups,
  modifiers,
  ingredients,
  inventory,
  stockLedger,
  orders,
  orderItems,
  orderItemModifiers,
  shifts,
  platformFees,
} from "#/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

export const getPosMenu = createServerFn({ method: "GET" })
  .inputValidator(
    (data: { branchId: string; brandId?: string; category?: string; search?: string }) => data,
  )
  .handler(async ({ data }) => {
    await requireAuth();

    // Get recipes with brand filter
    let recipeQuery = db
      .select({
        id: recipes.id,
        code: recipes.code,
        name: recipes.name,
        imageUrl: recipes.imageUrl,
        category: recipes.category,
        basePrice: recipes.basePrice,
        isBOGO: recipes.isBOGO,
        status: recipes.status,
      })
      .from(recipes)
      .where(eq(recipes.status, "Active"));

    const result = await recipeQuery.orderBy(recipes.name);

    // Get brands for each recipe
    const recipeIds = result.map((r) => r.id);
    const brandLinks =
      recipeIds.length > 0
        ? await db
            .select({
              recipeId: recipeBrands.recipeId,
              brandId: recipeBrands.brandId,
              brandName: brands.name,
            })
            .from(recipeBrands)
            .leftJoin(brands, eq(recipeBrands.brandId, brands.id))
            .where(eq(recipeBrands.recipeId, recipeIds[0]))
        : [];

    // Get modifier groups for recipes
    const modGroupLinks =
      recipeIds.length > 0
        ? await db
            .select({
              recipeId: recipeModifierGroups.recipeId,
              modifierGroupId: recipeModifierGroups.modifierGroupId,
              groupName: modifierGroups.name,
              minSelection: modifierGroups.minSelection,
              maxSelection: modifierGroups.maxSelection,
            })
            .from(recipeModifierGroups)
            .leftJoin(modifierGroups, eq(recipeModifierGroups.modifierGroupId, modifierGroups.id))
            .where(eq(recipeModifierGroups.recipeId, recipeIds[0]))
        : [];

    // Get modifiers for groups
    const groupIds = [...new Set(modGroupLinks.map((m) => m.modifierGroupId))];
    const allModifiers =
      groupIds.length > 0
        ? await db.select().from(modifiers).where(eq(modifiers.modifierGroupId, groupIds[0]))
        : [];

    return result
      .filter((r) => {
        if (data.brandId) {
          const rb = brandLinks.filter((b) => b.recipeId === r.id);
          return rb.some((b) => b.brandId === data.brandId);
        }
        if (data.category && r.category !== data.category) return false;
        if (data.search) {
          const q = data.search.toLowerCase();
          return r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q);
        }
        return true;
      })
      .map((r) => ({
        ...r,
        brands: brandLinks
          .filter((b) => b.recipeId === r.id)
          .map((b) => ({
            id: b.brandId,
            name: b.brandName,
          })),
        modifierGroups: modGroupLinks
          .filter((m) => m.recipeId === r.id)
          .map((g) => ({
            ...g,
            modifiers: allModifiers.filter((m) => m.modifierGroupId === g.modifierGroupId),
          })),
      }));
  });

export const getShiftStatus = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId: string; userId: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const [openShift] = await db
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.branchId, data.branchId),
          eq(shifts.userId, data.userId),
          eq(shifts.status, "Open"),
        ),
      )
      .orderBy(shifts.startTime)
      .limit(1);

    return openShift ?? null;
  });

export const openShift = createServerFn({ method: "POST" })
  .inputValidator((data: { branchId: string; userId: string; cashFloat: number }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const [shift] = await db
      .insert(shifts)
      .values({
        branchId: data.branchId,
        userId: data.userId,
        startTime: new Date(),
        cashFloat: data.cashFloat,
        status: "Open",
      })
      .returning();

    return shift;
  });

export const closeShift = createServerFn({ method: "POST" })
  .inputValidator((data: { shiftId: string; actualCash: number; notes?: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const [shift] = await db
      .update(shifts)
      .set({
        endTime: new Date(),
        actualCash: data.actualCash,
        status: "Closed",
        notes: data.notes,
      })
      .where(eq(shifts.id, data.shiftId))
      .returning();

    return shift;
  });

const orderItemInput = z.object({
  recipeId: z.string().uuid(),
  brandId: z.string().uuid(),
  quantity: z.number().int().min(1),
  price: z.number().int().min(0),
  selectedModifiers: z
    .array(
      z.object({
        groupId: z.string().uuid(),
        modifierId: z.string().uuid(),
        price: z.number().int().min(0),
      }),
    )
    .optional(),
  notes: z.string().optional(),
});

export const createOrder = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      branchId: string;
      channel: "Gofood" | "Grabfood" | "ShopeeFood" | "Dine-in";
      customerName?: string;
      orderCode?: string;
      items: z.infer<typeof orderItemInput>[];
      voucherCode?: string;
      paymentMethod?: string;
      shiftId?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    await requireAuth();

    // Calculate totals
    let subtotal = 0;
    let totalCogs = 0;
    const voucherDiscount = 0;

    // Process each item
    for (const item of data.items) {
      subtotal += item.price * item.quantity;

      // Get recipe ingredients for COGS
      const ings = await db
        .select({
          ingredientId: recipeIngredients.ingredientId,
          quantity: recipeIngredients.quantity,
        })
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, item.recipeId));

      for (const ing of ings) {
        const [ingData] = await db
          .select()
          .from(ingredients)
          .where(eq(ingredients.id, ing.ingredientId))
          .limit(1);

        if (ingData) {
          totalCogs += ingData.averageCost * ing.quantity * item.quantity;
        }
      }
    }

    // Calculate tax and totals (simplified for now)
    const taxAmount = 0;
    const totalAmount = subtotal - voucherDiscount + taxAmount;

    // Get platform fee
    const [fee] = await db
      .select()
      .from(platformFees)
      .where(eq(platformFees.channel, data.channel))
      .limit(1);

    const mdrFee = fee ? Math.round((subtotal * fee.feePercentage) / 100) + fee.fixedFee : 0;
    const netSales = totalAmount - mdrFee;

    // Create order
    const [order] = await db
      .insert(orders)
      .values({
        branchId: data.branchId,
        channel: data.channel,
        subtotal,
        taxAmount,
        totalAmount,
        totalCogs,
        mdrFee,
        netSales,
        orderCode: data.orderCode,
        customerName: data.customerName,
        paymentMethod: data.paymentMethod,
        voucherCode: data.voucherCode,
        voucherDiscount,
        status: "Completed",
        shiftId: data.shiftId,
      })
      .returning();

    // Create order items
    for (const item of data.items) {
      const [orderItem] = await db
        .insert(orderItems)
        .values({
          orderId: order.id,
          recipeId: item.recipeId,
          brandId: item.brandId,
          quantity: item.quantity,
          price: item.price,
          notes: item.notes,
        })
        .returning();

      // Insert modifiers
      if (item.selectedModifiers?.length) {
        for (const mod of item.selectedModifiers) {
          await db.insert(orderItemModifiers).values({
            orderItemId: orderItem.id,
            modifierGroupId: mod.groupId,
            modifierId: mod.modifierId,
          });
        }
      }
    }

    // Deduct inventory (simplified - deduct recipe ingredients)
    for (const item of data.items) {
      const ings = await db
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, item.recipeId));

      for (const ing of ings) {
        const deductQty = ing.quantity * item.quantity;

        // Update inventory
        const [inv] = await db
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.branchId, data.branchId),
              eq(inventory.ingredientId, ing.ingredientId),
            ),
          )
          .limit(1);

        if (inv) {
          const newQty = Math.max(0, inv.quantity - deductQty);
          await db
            .update(inventory)
            .set({ quantity: newQty, lastUpdated: new Date() })
            .where(eq(inventory.id, inv.id));

          // Create stock ledger entry
          await db.insert(stockLedger).values({
            branchId: data.branchId,
            ingredientId: ing.ingredientId,
            type: "OUT",
            quantity: deductQty,
            balance: newQty,
            reference: order.id,
            notes: `POS Order ${order.id.slice(0, 8)}`,
          });
        }
      }
    }

    return order;
  });

export const getOrders = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      branchId?: string;
      dateFrom?: string;
      dateTo?: string;
      status?: string;
      search?: string;
    }) => data,
  )
  .handler(async ({ data: _data }) => {
    await requireAuth();

    const result = await db.select().from(orders).orderBy(orders.createdAt).limit(100);

    return result;
  });
