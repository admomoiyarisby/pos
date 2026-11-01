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
  yieldConversions,
  yieldConversionItems,
} from "#/db/schema";
import { eq, and, desc, inArray, isNull, lt, ne } from "drizzle-orm";
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
    productionData,
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

    // Recipes — ADR-0009 mirror: tombstoned (Deleted) recipes never appear in
    // the UI, so they must not feed the HPP/COGS dashboard tables either.
    db.select().from(recipes).where(ne(recipes.status, "Deleted")),

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

    // Production records — cancelled and tombstoned records never count toward
    // the production tracker (ADR 0012 / ADR 0019).
    (async () => {
      const productionConditions = [
        eq(yieldConversions.status, "Active"),
        isNull(yieldConversions.deletedAt),
      ];
      if (user.role === "branch_admin" && user.branchId) {
        productionConditions.push(eq(yieldConversions.branchId, user.branchId));
      } else if (user.role === "area_manager" && user.assignedBranches?.length) {
        productionConditions.push(inArray(yieldConversions.branchId, user.assignedBranches));
      }
      return db
        .select({
          id: yieldConversions.id,
          branchId: yieldConversions.branchId,
          branchName: branches.name,
          notes: yieldConversions.notes,
          productionDate: yieldConversions.productionDate,
          createdAt: yieldConversions.createdAt,
          status: yieldConversions.status,
        })
        .from(yieldConversions)
        .leftJoin(branches, eq(yieldConversions.branchId, branches.id))
        .where(and(...productionConditions))
        .orderBy(desc(yieldConversions.productionDate));
    })(),

    // Waste entries — only Active, non-deleted rows count. Cancelled entries
    // stop counting toward loss totals (CONTEXT: Waste Cancellation) and
    // tombstoned rows never appear in lists.
    (async () => {
      const wasteConditions = [isNull(wasteEntries.deletedAt), eq(wasteEntries.status, "Active")];
      if (user.role === "branch_admin" && user.branchId) {
        wasteConditions.push(eq(wasteEntries.branchId, user.branchId));
      } else if (user.role === "area_manager" && user.assignedBranches?.length) {
        wasteConditions.push(inArray(wasteEntries.branchId, user.assignedBranches));
      }
      return db
        .select({
          id: wasteEntries.id,
          branchId: wasteEntries.branchId,
          branchName: branches.name,
          ingredientId: wasteEntries.ingredientId,
          ingredientName: ingredients.name,
          ingredientUnit: ingredients.stockUnit,
          recipeId: wasteEntries.recipeId,
          recipeName: recipes.name,
          quantity: wasteEntries.quantity,
          category: wasteEntries.category,
          staffName: wasteEntries.staffName,
          notes: wasteEntries.notes,
          valuation: wasteEntries.valuation,
          createdAt: wasteEntries.createdAt,
          status: wasteEntries.status,
        })
        .from(wasteEntries)
        .leftJoin(ingredients, eq(wasteEntries.ingredientId, ingredients.id))
        .leftJoin(recipes, eq(wasteEntries.recipeId, recipes.id))
        .leftJoin(branches, eq(wasteEntries.branchId, branches.id))
        .where(and(...wasteConditions))
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
  const productionIdList = productionData.map((p) => p.id);

  const [
    orderItemsData,
    recipeIngsData,
    childRecipes,
    recipeBrandsData,
    soItems,
    mrBrandBreakdowns,
    productionItemsData,
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

    productionIdList.length > 0
      ? db
          .select({
            conversionId: yieldConversionItems.conversionId,
            ingredientId: yieldConversionItems.ingredientId,
            ingredientName: ingredients.name,
            stockUnit: ingredients.stockUnit,
            quantity: yieldConversionItems.quantity,
            direction: yieldConversionItems.direction,
          })
          .from(yieldConversionItems)
          .leftJoin(ingredients, eq(yieldConversionItems.ingredientId, ingredients.id))
          .where(inArray(yieldConversionItems.conversionId, productionIdList))
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
    production: productionData.map((record) => {
      const recordItems = productionItemsData.filter((item) => item.conversionId === record.id);
      return {
        ...record,
        out: recordItems
          .filter((item) => item.direction === "OUT")
          .map((item) => ({
            ingredientId: item.ingredientId,
            ingredientName: item.ingredientName,
            stockUnit: item.stockUnit,
            quantity: item.quantity,
          })),
        produced: recordItems
          .filter((item) => item.direction === "PRODUCED")
          .map((item) => ({
            ingredientId: item.ingredientId,
            ingredientName: item.ingredientName,
            stockUnit: item.stockUnit,
            quantity: item.quantity,
          })),
      };
    }),
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
