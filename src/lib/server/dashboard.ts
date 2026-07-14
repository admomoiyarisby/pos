import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  orders,
  orderItems,
  inventory,
  recipes,
  recipeIngredients,
  ingredients,
  branches,
  brands,
  platformFees,
  stockOpnames,
  stockOpnameItems,
  wasteEntries,
  manualRevenues,
  manualRevenueBrandBreakdowns,
  recipeChildRecipes,
  recipeBrands,
} from "#/db/schema";
import { eq, and, desc, inArray, lt } from "drizzle-orm";
import { requireAuth } from "./auth";
import type { AppUser } from "./auth";

/**
 * Raw dashboard query logic. Called directly from route loaders (SSR-safe)
 * and also wrapped by the createServerFn for client-side calls.
 */
export async function fetchDashboardData(user: AppUser) {
  const branchFilter =
    user.role === "branch_admin" && user.branchId ? eq(orders.branchId, user.branchId) : undefined;

  // Run all independent queries in parallel for faster response
  const [
    allOrders,
    inventoryData,
    allRecipes,
    allIngredients,
    allBranches,
    allBrands,
    allPlatformFees,
    allStockOpnames,
    wasteData,
    manualRevData,
  ] = await Promise.all([
    // Orders
    db
      .select({
        id: orders.id,
        branchId: orders.branchId,
        channel: orders.channel,
        subtotal: orders.subtotal,
        taxAmount: orders.taxAmount,
        totalAmount: orders.totalAmount,
        totalCogs: orders.totalCogs,
        mdrFee: orders.mdrFee,
        netSales: orders.netSales,
        status: orders.status,
        createdAt: orders.createdAt,
        completedAt: orders.completedAt,
        orderCode: orders.orderCode,
        customerName: orders.customerName,
      })
      .from(orders)
      .where(branchFilter ? and(branchFilter) : undefined)
      .orderBy(desc(orders.createdAt))
      .limit(100),

    // Inventory — filter to low-stock items server-side
    (async () => {
      const invConditions = [lt(inventory.quantity, 100)];
      if (user.role === "branch_admin" && user.branchId) {
        invConditions.push(eq(inventory.branchId, user.branchId));
      }
      return db
        .select({
          id: inventory.id,
          branchId: inventory.branchId,
          ingredientId: inventory.ingredientId,
          quantity: inventory.quantity,
        })
        .from(inventory)
        .where(and(...invConditions))
        .limit(50);
    })(),

    // Recipes
    db.select().from(recipes),

    // Ingredients
    db.select().from(ingredients),

    // Branches
    db.select().from(branches),

    // Brands
    db.select().from(brands),

    // Platform fees
    db.select().from(platformFees),

    // Stock opnames
    db.select().from(stockOpnames).orderBy(desc(stockOpnames.createdAt)),

    // Waste entries
    (async () => {
      const wasteFilter =
        user.role === "branch_admin" && user.branchId
          ? eq(wasteEntries.branchId, user.branchId)
          : undefined;
      return db
        .select()
        .from(wasteEntries)
        .where(wasteFilter ? and(wasteFilter) : undefined)
        .orderBy(desc(wasteEntries.createdAt));
    })(),

    // Manual revenues
    user.role === "super_admin"
      ? db.select().from(manualRevenues).orderBy(desc(manualRevenues.date)).limit(100)
      : Promise.resolve([]),
  ]);

  // Dependent queries (need IDs from first batch) — also parallelized
  const orderIdList = allOrders.map((o) => o.id);
  const recipeIdList = allRecipes.map((r) => r.id);
  const soIdList = allStockOpnames.map((s) => s.id);
  const mrIdList = manualRevData.map((m) => m.id);

  const [
    orderItemsData,
    recipeIngsData,
    childRecipes,
    recipeBrandsData,
    soItems,
    mrBrandBreakdowns,
  ] = await Promise.all([
    orderIdList.length > 0
      ? db
          .select({
            id: orderItems.id,
            orderId: orderItems.orderId,
            recipeId: orderItems.recipeId,
            quantity: orderItems.quantity,
            price: orderItems.price,
            cogsAtTransaction: orderItems.cogsAtTransaction,
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, orderIdList))
      : Promise.resolve([]),

    recipeIdList.length > 0
      ? db.select().from(recipeIngredients).where(inArray(recipeIngredients.recipeId, recipeIdList))
      : Promise.resolve([]),

    recipeIdList.length > 0
      ? db
          .select()
          .from(recipeChildRecipes)
          .where(inArray(recipeChildRecipes.parentRecipeId, recipeIdList))
      : Promise.resolve([]),

    recipeIdList.length > 0
      ? db.select().from(recipeBrands).where(inArray(recipeBrands.recipeId, recipeIdList))
      : Promise.resolve([]),

    soIdList.length > 0
      ? db.select().from(stockOpnameItems).where(inArray(stockOpnameItems.stockOpnameId, soIdList))
      : Promise.resolve([]),

    mrIdList.length > 0
      ? db
          .select()
          .from(manualRevenueBrandBreakdowns)
          .where(inArray(manualRevenueBrandBreakdowns.manualRevenueId, mrIdList))
      : Promise.resolve([]),
  ]);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
    },
    orders: allOrders,
    orderItems: orderItemsData,
    inventory: inventoryData,
    recipes: allRecipes.map((r) => ({
      ...r,
      ingredients: recipeIngsData.filter((ri) => ri.recipeId === r.id),
      childRecipes: childRecipes.filter((cr) => cr.parentRecipeId === r.id),
      brands: recipeBrandsData.filter((rb) => rb.recipeId === r.id),
    })),
    ingredients: allIngredients,
    branches: allBranches,
    brands: allBrands,
    platformFees: allPlatformFees,
    stockOpnames: allStockOpnames.map((so) => ({
      ...so,
      items: soItems.filter((si) => si.stockOpnameId === so.id),
    })),
    wasteEntries: wasteData,
    manualRevenues: manualRevData.map((mr) => ({
      ...mr,
      brandBreakdown: mrBrandBreakdowns.filter((bb) => bb.manualRevenueId === mr.id),
    })),
  };
}

/**
 * Server function wrapper for client-side calls (React Query refetch).
 */
export const getDashboardData = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAuth();
  return fetchDashboardData(user);
});
