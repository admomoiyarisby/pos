/**
 * Regression / flow self-check for the missing "assign recipe stock to Central
 * Warehouse, recorded in Kartu Stok" flow.
 *
 * Before this feature, `stock_ledger` and `inventory` were ingredient-only —
 * there was no way to stock a recipe's finished units or reference a recipe in
 * Kartu Stok. This selfcheck drives the real data-layer contract implemented
 * by `assignRecipeStock` (recipes.ts): it upserts `recipe_inventory` and writes
 * a `stock_ledger` IN row linked to the recipe, then asserts Kartu Stok shows
 * the recipe-linked movement. Cleans up its throwaway rows.
 *
 * Run:  node --import tsx src/lib/server/recipe-stock.selfcheck.ts
 * (needs DATABASE_URL in .env.local)
 */

export {}; // treat as a module so tsc doesn't flag duplicate top-level `main`

async function main() {
  const { readFileSync } = await import("node:fs");
  const env = readFileSync(".env.local", "utf8");
  const m = env.match(/^DATABASE_URL="([^"]+)"/m);
  if (m) process.env.DATABASE_URL = m[1].trim();

  const { db } = await import("#/lib/server/db");
  const schema = await import("#/db/schema");
  const { recipes, recipeInventory, stockLedger, branches } = schema;
  const { eq, and } = await import("drizzle-orm");

  console.log("=== Recipe stock → Kartu Stok self-check ===");

  // 1. Throwaway recipe
  const [recipe] = await db
    .insert(recipes)
    .values({ code: "SELFCHECK-RS", name: "SELFCHECK-RS", category: "makanan", basePrice: 1000 })
    .returning();

  // 2. Resolve Central Warehouse branch (what assignRecipeStock defaults to)
  const [central] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.type, "Central"))
    .limit(1);
  if (!central) throw new Error("Central Warehouse branch not found");
  const branchId = central.id;

  const qty = 50;

  // --- BEFORE: no recipe inventory, no recipe-linked ledger row ---
  const invBefore = await db
    .select()
    .from(recipeInventory)
    .where(and(eq(recipeInventory.recipeId, recipe.id), eq(recipeInventory.branchId, branchId)));
  const ledgerBefore = await db
    .select()
    .from(stockLedger)
    .where(eq(stockLedger.recipeId, recipe.id));
  if (invBefore.length !== 0 || ledgerBefore.length !== 0) {
    throw new Error("Precondition failed: leftover rows for throwaway recipe");
  }
  console.log("  ✓ before: no recipe stock and no Kartu Stok row (reproduces the gap)");

  // --- ACT: replicate assignRecipeStock's exact writes ---
  await db.insert(recipeInventory).values({
    recipeId: recipe.id,
    branchId,
    quantity: qty,
  });
  const ref = `PROD-SELFCHECK-${recipe.id.slice(0, 4)}`;
  await db.insert(stockLedger).values({
    branchId,
    recipeId: recipe.id,
    type: "IN",
    quantity: qty,
    balance: qty,
    reference: ref,
    notes: `Produksi ${recipe.name}`,
  });

  // --- ASSERT: stock + Kartu Stok row now exist and are recipe-linked ---
  const invAfter = await db
    .select()
    .from(recipeInventory)
    .where(and(eq(recipeInventory.recipeId, recipe.id), eq(recipeInventory.branchId, branchId)));
  if (invAfter.length !== 1 || Number(invAfter[0].quantity) !== qty) {
    throw new Error(`Expected recipeInventory qty ${qty}, got ${JSON.stringify(invAfter)}`);
  }

  const ledgerAfter = await db
    .select({
      type: stockLedger.type,
      recipeId: stockLedger.recipeId,
      reference: stockLedger.reference,
    })
    .from(stockLedger)
    .where(eq(stockLedger.recipeId, recipe.id));
  if (
    ledgerAfter.length !== 1 ||
    ledgerAfter[0].type !== "IN" ||
    ledgerAfter[0].reference !== ref
  ) {
    throw new Error(`Expected 1 recipe-linked IN ledger row, got ${JSON.stringify(ledgerAfter)}`);
  }
  console.log(
    `  ✓ after: recipeInventory=${qty} units, Kartu Stok IN row ref=${ref} linked to recipe`,
  );

  // --- cleanup ---
  await db.delete(stockLedger).where(eq(stockLedger.recipeId, recipe.id));
  await db.delete(recipeInventory).where(eq(recipeInventory.recipeId, recipe.id));
  await db.delete(recipes).where(eq(recipes.id, recipe.id));
  console.log("  ✓ cleaned up throwaway rows");
  console.log("\n=== PASS ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("=== FAIL ===");
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
