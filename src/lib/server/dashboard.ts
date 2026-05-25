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
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth } from "./auth";

export const getDashboardData = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAuth();

  const branchFilter =
    user.role === "branch_admin" && user.branchId ? eq(orders.branchId, user.branchId) : undefined;

  // Orders with items
  const allOrders = await db
    .select()
    .from(orders)
    .where(branchFilter ? and(branchFilter) : undefined)
    .orderBy(desc(orders.createdAt))
    .limit(100);

  const orderIdList = allOrders.map((o) => o.id);
  const orderItemsData =
    orderIdList.length > 0
      ? await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIdList))
      : [];

  // Inventory
  const invFilter =
    user.role === "branch_admin" && user.branchId
      ? eq(inventory.branchId, user.branchId)
      : undefined;
  const inventoryData = await db
    .select()
    .from(inventory)
    .where(invFilter ? and(invFilter) : undefined);

  // Recipes with ingredients
  const allRecipes = await db.select().from(recipes);
  const recipeIdList = allRecipes.map((r) => r.id);
  const recipeIngsData =
    recipeIdList.length > 0
      ? await db
          .select()
          .from(recipeIngredients)
          .where(inArray(recipeIngredients.recipeId, recipeIdList))
      : [];
  const childRecipes =
    recipeIdList.length > 0
      ? await db
          .select()
          .from(recipeChildRecipes)
          .where(inArray(recipeChildRecipes.parentRecipeId, recipeIdList))
      : [];
  const recipeBrandsData =
    recipeIdList.length > 0
      ? await db.select().from(recipeBrands).where(inArray(recipeBrands.recipeId, recipeIdList))
      : [];

  // Ingredients
  const allIngredients = await db.select().from(ingredients);

  // Branches
  const allBranches = await db.select().from(branches);

  // Brands
  const allBrands = await db.select().from(brands);

  // Platform fees
  const allPlatformFees = await db.select().from(platformFees);

  // Stock opnames with items
  const allStockOpnames = await db
    .select()
    .from(stockOpnames)
    .orderBy(desc(stockOpnames.createdAt));
  const soIdList = allStockOpnames.map((s) => s.id);
  const soItems =
    soIdList.length > 0
      ? await db
          .select()
          .from(stockOpnameItems)
          .where(inArray(stockOpnameItems.stockOpnameId, soIdList))
      : [];

  // Waste entries
  const wasteFilter =
    user.role === "branch_admin" && user.branchId
      ? eq(wasteEntries.branchId, user.branchId)
      : undefined;
  const wasteData = await db
    .select()
    .from(wasteEntries)
    .where(wasteFilter ? and(wasteFilter) : undefined)
    .orderBy(desc(wasteEntries.createdAt));

  // Manual revenues with brand breakdowns
  const manualRevData =
    user.role === "super_admin"
      ? await db.select().from(manualRevenues).orderBy(desc(manualRevenues.date)).limit(100)
      : [];
  const mrIdList = manualRevData.map((m) => m.id);
  const mrBrandBreakdowns =
    mrIdList.length > 0
      ? await db
          .select()
          .from(manualRevenueBrandBreakdowns)
          .where(inArray(manualRevenueBrandBreakdowns.manualRevenueId, mrIdList))
      : [];

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
});
