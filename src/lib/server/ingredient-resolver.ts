import { db } from "#/lib/server/db";
import type * as schema from "#/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  recipes,
  recipeIngredients,
  recipeChildRecipes,
  recipeModifierExclusions,
  modifierIngredients,
  modifierRecipes,
  orderItemModifiers,
  orderItemExclusions,
  orderItems,
  ingredients,
} from "#/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

export type Db = NodePgDatabase<typeof schema>;

/** Transaction client type — same shape as the SCM effects `FsmTx`. */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Any database handle we accept — pooled db or an active transaction. */
export type DbOrTx = Db | DbTx;

// =============================================================================
// Types
// =============================================================================

export interface ResolvedIngredient {
  ingredientId: string;
  quantity: number; // positive = consumed, negative = excluded/restored
  ingredientName: string;
  cost?: number; // only when includeCost is true
}

export interface ResolvedItemIngredients {
  /** Flat list of ingredient deltas for the order item */
  ingredients: ResolvedIngredient[];
  /** Exclusion records that must be persisted to orderItemExclusions */
  exclusionRecords: Array<{ ingredientId: string; quantity: number }>;
}

// =============================================================================
// Helper — batch ingredient name fetch
// =============================================================================

async function fetchIngredientNames(
  ingredientIds: string[],
  tx?: DbOrTx,
): Promise<Map<string, string>> {
  if (ingredientIds.length === 0) return new Map();

  const conn = tx ?? db;
  const rows = await conn
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .where(inArray(ingredients.id, ingredientIds));

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.id, row.name);
  }
  return map;
}

// =============================================================================
// Helper — build flat ingredient list from recipe BOM
// =============================================================================

interface BOMEntry {
  recipeId: string;
  quantity: number;
}

async function resolveRecipeBOM(
  entries: BOMEntry[],
  addonModifierIds: string[],
  includeCost: boolean,
  tx?: DbOrTx,
): Promise<Map<string, { qty: number; cost: number }>> {
  const ingredientMap = new Map<string, { qty: number; cost: number }>();

  // Collect all recipe IDs
  const recipeIds = entries.map((e) => e.recipeId);

  if (recipeIds.length === 0) return ingredientMap;

  // Batch-fetch recipe ingredients for all involved recipes
  const baseSelect = {
    recipeId: recipeIngredients.recipeId,
    ingredientId: recipeIngredients.ingredientId,
    qty: recipeIngredients.quantity,
  };

  const conn = tx ?? db;
  const recipeIngs = await conn
    .select({
      ...baseSelect,
      cost: includeCost ? ingredients.averageCost : sql<number | null>`null`,
    })
    .from(recipeIngredients)
    .leftJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(inArray(recipeIngredients.recipeId, recipeIds));

  // Accumulate per recipe entry
  for (const entry of entries) {
    for (const ing of recipeIngs.filter((r) => r.recipeId === entry.recipeId)) {
      const totalQty = ing.qty * entry.quantity;
      const existing = ingredientMap.get(ing.ingredientId) ?? { qty: 0, cost: 0 };
      existing.qty += totalQty;
      if (ing.cost != null) {
        existing.cost = existing.cost + ing.cost * totalQty;
      }
      ingredientMap.set(ing.ingredientId, existing);
    }
  }

  // Batch-fetch modifier ingredients
  if (addonModifierIds.length > 0) {
    const modBaseSelect = {
      modifierId: modifierIngredients.modifierId,
      ingredientId: modifierIngredients.ingredientId,
      qty: modifierIngredients.quantity,
    };

    const modIngs = await conn
      .select({
        ...modBaseSelect,
        cost: includeCost ? ingredients.averageCost : sql<number | null>`null`,
      })
      .from(modifierIngredients)
      .leftJoin(ingredients, eq(modifierIngredients.ingredientId, ingredients.id))
      .where(inArray(modifierIngredients.modifierId, addonModifierIds));

    // Group modifiers by their modifierId and multiply by quantity
    for (const mi of modIngs) {
      const existing = ingredientMap.get(mi.ingredientId) ?? { qty: 0, cost: 0 };
      existing.qty += mi.qty;
      if (mi.cost != null) {
        existing.cost = existing.cost + mi.cost * mi.qty;
      }
      ingredientMap.set(mi.ingredientId, existing);
    }

    const modRecipes = await conn
      .select({
        modifierId: modifierRecipes.modifierId,
        recipeId: modifierRecipes.recipeId,
        quantity: modifierRecipes.quantity,
      })
      .from(modifierRecipes)
      .where(inArray(modifierRecipes.modifierId, addonModifierIds));

    // A recipe add-on consumes the add-on recipe's BOM, including its child recipes.
    for (const mr of modRecipes) {
      const childLinks = await conn
        .select()
        .from(recipeChildRecipes)
        .where(eq(recipeChildRecipes.parentRecipeId, mr.recipeId));
      const recipeEntries: BOMEntry[] = [
        { recipeId: mr.recipeId, quantity: mr.quantity },
        ...childLinks.map((link) => ({
          recipeId: link.childRecipeId,
          quantity: link.quantity * mr.quantity,
        })),
      ];
      const addOnIngredients = await resolveRecipeBOM(recipeEntries, [], includeCost, tx);
      for (const [ingredientId, data] of addOnIngredients) {
        const existing = ingredientMap.get(ingredientId) ?? { qty: 0, cost: 0 };
        existing.qty += data.qty;
        existing.cost += data.cost;
        ingredientMap.set(ingredientId, existing);
      }
    }
  }

  return ingredientMap;
}

// =============================================================================
// Function A — For createOrder flow (resolves from client input)
// =============================================================================

export async function resolveNewItemIngredients(
  recipeId: string,
  quantity: number,
  selectedModifiers?: Array<{ modifierId: string; isExclusion?: boolean }>,
  opts?: { includeCost?: boolean; tx?: DbOrTx },
): Promise<ResolvedItemIngredients> {
  const includeCost = opts?.includeCost ?? false;
  const tx = opts?.tx;
  const conn = tx ?? db;
  const modifiers = selectedModifiers ?? [];

  // 1. Check if the recipe is BOGO — effective quantity is doubled
  const [recipe] = await conn
    .select({ isBOGO: recipes.isBOGO })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .limit(1);
  const effectiveQuantity = recipe?.isBOGO ? quantity * 2 : quantity;

  // 2. Resolve child recipes for bundling
  const childLinks = await conn
    .select()
    .from(recipeChildRecipes)
    .where(eq(recipeChildRecipes.parentRecipeId, recipeId));

  // 3. Build BOM entries: parent + children, using effective quantity
  const bomEntries: BOMEntry[] = [
    { recipeId, quantity: effectiveQuantity },
    ...childLinks.map((link) => ({
      recipeId: link.childRecipeId,
      quantity: link.quantity * effectiveQuantity,
    })),
  ];

  // 3. Separate modifier IDs: add-ons vs exclusions
  const addonModifierIds = modifiers.filter((m) => !m.isExclusion).map((m) => m.modifierId);

  const exclusionModIds = modifiers.filter((m) => m.isExclusion).map((m) => m.modifierId);

  // 4. Resolve BOM (recipe ingredients + modifier add-ons)
  const ingredientMap = await resolveRecipeBOM(bomEntries, addonModifierIds, includeCost, tx);

  // 5. Fetch exclusion records
  const exclusionRecords: Array<{ ingredientId: string; quantity: number }> = [];
  if (exclusionModIds.length > 0) {
    const exclusions = await conn
      .select({
        modifierId: recipeModifierExclusions.modifierId,
        ingredientId: recipeModifierExclusions.ingredientId,
        quantity: recipeModifierExclusions.quantity,
      })
      .from(recipeModifierExclusions)
      .where(
        and(
          eq(recipeModifierExclusions.recipeId, recipeId),
          inArray(recipeModifierExclusions.modifierId, exclusionModIds),
        ),
      );

    for (const ex of exclusions) {
      const totalQty = ex.quantity * effectiveQuantity;
      exclusionRecords.push({
        ingredientId: ex.ingredientId,
        quantity: totalQty,
      });

      // Add as negative quantity in ingredient map
      const existing = ingredientMap.get(ex.ingredientId) ?? { qty: 0, cost: 0 };
      existing.qty -= totalQty;
      ingredientMap.set(ex.ingredientId, existing);
    }
  }

  // 6. Fetch ingredient names
  const ingredientIds = [...ingredientMap.keys()];
  const nameMap = await fetchIngredientNames(ingredientIds, tx);

  // 7. Build result
  const ingredientsList: ResolvedIngredient[] = [];
  for (const [id, data] of ingredientMap) {
    if (data.qty === 0) continue;

    const entry: ResolvedIngredient = {
      ingredientId: id,
      quantity: data.qty,
      ingredientName: nameMap.get(id) ?? id,
    };
    if (includeCost) {
      // cost per unit, not total
      entry.cost = Math.round(data.cost);
    }
    ingredientsList.push(entry);
  }

  return {
    ingredients: ingredientsList,
    exclusionRecords,
  };
}

// =============================================================================
// Function B — For voidOrder flow (resolves from persisted DB state)
// =============================================================================

export async function resolvePersistedItemIngredients(
  orderItemId: string,
  opts?: { includeCost?: boolean; tx?: DbOrTx },
): Promise<ResolvedItemIngredients> {
  const includeCost = opts?.includeCost ?? false;
  const tx = opts?.tx;
  const conn = tx ?? db;

  // 1. Look up the order item to find its recipeId and quantity

  const [orderItem] = await conn
    .select()
    .from(orderItems)
    .where(eq(orderItems.id, orderItemId))
    .limit(1);

  if (!orderItem) {
    throw new Error(`Order item not found: ${orderItemId}`);
  }

  const { recipeId, quantity } = orderItem;

  // 2. Check BOGO — effective quantity is doubled
  const [recipe] = await conn
    .select({ isBOGO: recipes.isBOGO })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .limit(1);
  const effectiveQuantity = recipe?.isBOGO ? quantity * 2 : quantity;

  // 3. Get modifiers and exclusions from persisted tables
  const [persistedMods, persistedExclusions] = await Promise.all([
    conn
      .select({ modifierId: orderItemModifiers.modifierId })
      .from(orderItemModifiers)
      .where(eq(orderItemModifiers.orderItemId, orderItemId)),
    conn.select().from(orderItemExclusions).where(eq(orderItemExclusions.orderItemId, orderItemId)),
  ]);

  // 4. Build BOM: parent recipe + children, using effective quantity
  const childLinks = await conn
    .select()
    .from(recipeChildRecipes)
    .where(eq(recipeChildRecipes.parentRecipeId, recipeId));

  const bomEntries: BOMEntry[] = [
    { recipeId, quantity: effectiveQuantity },
    ...childLinks.map((link) => ({
      recipeId: link.childRecipeId,
      quantity: link.quantity * effectiveQuantity,
    })),
  ];

  // 5. Resolve add-on modifier IDs (all persisted modifiers are assumed to be add-ons)
  const addonModifierIds = persistedMods.map((m) => m.modifierId);

  // 5. Resolve BOM
  const ingredientMap = await resolveRecipeBOM(bomEntries, addonModifierIds, includeCost, tx);

  // 6. Apply exclusions (re-deduct what was excluded during void restore)
  // In voidOrder, we need to NOT restore excluded ingredients — they weren't consumed.
  // The caller will do: inv.quantity + entry.quantity
  // So exclusions should have NEGATIVE quantity (meaning: subtract when restoring)
  const exclusionRecords: Array<{ ingredientId: string; quantity: number }> = [];
  for (const ex of persistedExclusions) {
    exclusionRecords.push({
      ingredientId: ex.ingredientId,
      quantity: ex.quantity,
    });

    const existing = ingredientMap.get(ex.ingredientId) ?? { qty: 0, cost: 0 };
    existing.qty -= ex.quantity; // don't restore excluded ingredients
    ingredientMap.set(ex.ingredientId, existing);
  }

  // 7. Fetch ingredient names
  const ingredientIds = [...ingredientMap.keys()];
  const nameMap = await fetchIngredientNames(ingredientIds, tx);

  // 8. Build result
  const ingredientsList: ResolvedIngredient[] = [];
  for (const [id, data] of ingredientMap) {
    if (data.qty === 0) continue;

    const entry: ResolvedIngredient = {
      ingredientId: id,
      quantity: data.qty,
      ingredientName: nameMap.get(id) ?? id,
    };
    if (includeCost) {
      entry.cost = Math.round(data.cost);
    }
    ingredientsList.push(entry);
  }

  return {
    ingredients: ingredientsList,
    exclusionRecords,
  };
}
