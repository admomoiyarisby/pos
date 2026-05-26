import { db } from "#/lib/server/db";
import {
  recipeIngredients,
  recipeChildRecipes,
  recipeModifierExclusions,
  modifierIngredients,
  orderItemModifiers,
  orderItemExclusions,
  orderItems,
  ingredients,
} from "#/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

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

async function fetchIngredientNames(ingredientIds: string[]): Promise<Map<string, string>> {
  if (ingredientIds.length === 0) return new Map();

  const rows = await db
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

  const recipeIngs = await db
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

    const modIngs = await db
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
  opts?: { includeCost?: boolean },
): Promise<ResolvedItemIngredients> {
  const includeCost = opts?.includeCost ?? false;
  const modifiers = selectedModifiers ?? [];

  // 1. Resolve child recipes for bundling
  const childLinks = await db
    .select()
    .from(recipeChildRecipes)
    .where(eq(recipeChildRecipes.parentRecipeId, recipeId));

  // 2. Build BOM entries: parent + children
  const bomEntries: BOMEntry[] = [
    { recipeId, quantity },
    ...childLinks.map((link) => ({
      recipeId: link.childRecipeId,
      quantity: link.quantity * quantity,
    })),
  ];

  // 3. Separate modifier IDs: add-ons vs exclusions
  const addonModifierIds = modifiers.filter((m) => !m.isExclusion).map((m) => m.modifierId);

  const exclusionModIds = modifiers.filter((m) => m.isExclusion).map((m) => m.modifierId);

  // 4. Resolve BOM (recipe ingredients + modifier add-ons)
  const ingredientMap = await resolveRecipeBOM(bomEntries, addonModifierIds, includeCost);

  // 5. Fetch exclusion records
  const exclusionRecords: Array<{ ingredientId: string; quantity: number }> = [];
  if (exclusionModIds.length > 0) {
    const exclusions = await db
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
      const totalQty = ex.quantity * quantity;
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
  const nameMap = await fetchIngredientNames(ingredientIds);

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
  opts?: { includeCost?: boolean },
): Promise<ResolvedItemIngredients> {
  const includeCost = opts?.includeCost ?? false;

  // 1. Look up the order item to find its recipeId and quantity

  const [orderItem] = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.id, orderItemId))
    .limit(1);

  if (!orderItem) {
    throw new Error(`Order item not found: ${orderItemId}`);
  }

  const { recipeId, quantity } = orderItem;

  // 2. Get modifiers and exclusions from persisted tables
  const [persistedMods, persistedExclusions] = await Promise.all([
    db
      .select({ modifierId: orderItemModifiers.modifierId })
      .from(orderItemModifiers)
      .where(eq(orderItemModifiers.orderItemId, orderItemId)),
    db.select().from(orderItemExclusions).where(eq(orderItemExclusions.orderItemId, orderItemId)),
  ]);

  // 3. Build BOM: parent recipe + children
  const childLinks = await db
    .select()
    .from(recipeChildRecipes)
    .where(eq(recipeChildRecipes.parentRecipeId, recipeId));

  const bomEntries: BOMEntry[] = [
    { recipeId, quantity },
    ...childLinks.map((link) => ({
      recipeId: link.childRecipeId,
      quantity: link.quantity * quantity,
    })),
  ];

  // 4. Resolve add-on modifier IDs (all persisted modifiers are assumed to be add-ons)
  const addonModifierIds = persistedMods.map((m) => m.modifierId);

  // 5. Resolve BOM
  const ingredientMap = await resolveRecipeBOM(bomEntries, addonModifierIds, includeCost);

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
  const nameMap = await fetchIngredientNames(ingredientIds);

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
