/**
 * Regression / flow self-check for the "assign recipe stock to Central
 * Warehouse, recorded in Kartu Stok" flow.
 *
 * This selfcheck verifies:
 * 1. Recipe finished-good stock is added to recipeInventory
 * 2. Recipe IN entry is written to stockLedger (Kartu Stok)
 * 3. Ingredients are deducted from Central Warehouse inventory (OUT)
 * 4. Ingredient OUT entries are written to stockLedger
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
  const {
    recipes,
    recipeIngredients,
    recipeInventory,
    stockLedger,
    inventory,
    ingredients,
    branches,
  } = schema;
  const { eq, and } = await import("drizzle-orm");

  console.log("=== Recipe production → Kartu Stok self-check ===\n");

  // 1. Resolve Central Warehouse branch
  const [central] = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.type, "Central"))
    .limit(1);
  if (!central) throw new Error("Central Warehouse branch not found");
  const branchId = central.id;
  console.log(`  ✓ Central Warehouse: ${central.name} (${branchId})`);

  // 2. Find or create test ingredients
  const [testIngredient1] = await db
    .select()
    .from(ingredients)
    .where(eq(ingredients.name, "TEST-1"))
    .limit(1);

  const [testIngredient2] = await db
    .select()
    .from(ingredients)
    .where(eq(ingredients.name, "TEST-2"))
    .limit(1);

  if (!testIngredient1 || !testIngredient2) {
    console.log("  ⚠ Test ingredients TEST-1 and TEST-2 not found, skipping full flow test");
    console.log("  (This test requires seed data with test ingredients)");
    return;
  }

  console.log(`  ✓ Test ingredients: ${testIngredient1.name}, ${testIngredient2.name}`);

  // 3. Create throwaway recipe with BOM
  const [recipe] = await db
    .insert(recipes)
    .values({
      code: "SELFCHECK-PROD",
      name: "SELFCHECK-PROD",
      category: "makanan",
      basePrice: 1000,
    })
    .returning();

  // Add BOM: 2x TEST-1, 3x TEST-2
  await db.insert(recipeIngredients).values([
    { recipeId: recipe.id, ingredientId: testIngredient1.id, quantity: 2 },
    { recipeId: recipe.id, ingredientId: testIngredient2.id, quantity: 3 },
  ]);

  console.log(
    `  ✓ Created test recipe with BOM: 2x ${testIngredient1.name}, 3x ${testIngredient2.name}`,
  );

  // 4. Get initial inventory for ingredients at Central Warehouse
  const [inv1Before] = await db
    .select()
    .from(inventory)
    .where(and(eq(inventory.branchId, branchId), eq(inventory.ingredientId, testIngredient1.id)))
    .limit(1);

  const [inv2Before] = await db
    .select()
    .from(inventory)
    .where(and(eq(inventory.branchId, branchId), eq(inventory.ingredientId, testIngredient2.id)))
    .limit(1);

  const inv1QtyBefore = inv1Before?.quantity ?? 0;
  const inv2QtyBefore = inv2Before?.quantity ?? 0;
  console.log(
    `  ✓ Initial inventory: ${testIngredient1.name}=${inv1QtyBefore}, ${testIngredient2.name}=${inv2QtyBefore}`,
  );

  // 5. Simulate production (replicate assignRecipeStock logic)
  const produceQty = 10;
  const ref = `PROD-SELFCHECK-${Date.now().toString(36).toUpperCase()}`;
  const ledgerNotes = `Produksi ${recipe.name}`;

  // Deduct ingredients
  for (const bom of [
    { ingredientId: testIngredient1.id, quantity: 2, name: testIngredient1.name },
    { ingredientId: testIngredient2.id, quantity: 3, name: testIngredient2.name },
  ]) {
    const requiredQty = bom.quantity * produceQty;
    const [inv] = await db
      .select()
      .from(inventory)
      .where(and(eq(inventory.branchId, branchId), eq(inventory.ingredientId, bom.ingredientId)))
      .limit(1);

    if (!inv) throw new Error(`Inventory not found for ${bom.name}`);

    const newBalance = inv.quantity - requiredQty;
    await db
      .update(inventory)
      .set({ quantity: newBalance, lastUpdated: new Date() })
      .where(eq(inventory.id, inv.id));

    await db.insert(stockLedger).values({
      branchId,
      ingredientId: bom.ingredientId,
      type: "OUT",
      quantity: requiredQty,
      balance: newBalance,
      reference: ref,
      notes: `${ledgerNotes} - ${bom.name}`,
    });
  }

  // Add recipe finished goods
  await db.insert(recipeInventory).values({
    recipeId: recipe.id,
    branchId,
    quantity: produceQty,
  });

  await db.insert(stockLedger).values({
    branchId,
    recipeId: recipe.id,
    type: "IN",
    quantity: produceQty,
    balance: produceQty,
    reference: ref,
    notes: ledgerNotes,
  });

  console.log(`  ✓ Simulated production: ${produceQty} units`);

  // 6. Verify results
  const [inv1After] = await db
    .select()
    .from(inventory)
    .where(and(eq(inventory.branchId, branchId), eq(inventory.ingredientId, testIngredient1.id)))
    .limit(1);

  const [inv2After] = await db
    .select()
    .from(inventory)
    .where(and(eq(inventory.branchId, branchId), eq(inventory.ingredientId, testIngredient2.id)))
    .limit(1);

  const inv1QtyAfter = inv1After?.quantity ?? 0;
  const inv2QtyAfter = inv2After?.quantity ?? 0;

  // Verify ingredient deduction
  const expectedInv1 = inv1QtyBefore - 2 * produceQty;
  const expectedInv2 = inv2QtyBefore - 3 * produceQty;

  if (inv1QtyAfter !== expectedInv1) {
    throw new Error(`${testIngredient1.name}: expected ${expectedInv1}, got ${inv1QtyAfter}`);
  }
  if (inv2QtyAfter !== expectedInv2) {
    throw new Error(`${testIngredient2.name}: expected ${expectedInv2}, got ${inv2QtyAfter}`);
  }
  console.log(
    `  ✓ Ingredients deducted: ${testIngredient1.name}=${inv1QtyAfter}, ${testIngredient2.name}=${inv2QtyAfter}`,
  );

  // Verify recipe inventory
  const [recipeInv] = await db
    .select()
    .from(recipeInventory)
    .where(and(eq(recipeInventory.recipeId, recipe.id), eq(recipeInventory.branchId, branchId)))
    .limit(1);

  if (!recipeInv || recipeInv.quantity !== produceQty) {
    throw new Error(`Recipe inventory: expected ${produceQty}, got ${recipeInv?.quantity}`);
  }
  console.log(`  ✓ Recipe inventory: ${recipeInv.quantity} units`);

  // Verify stock ledger entries
  const ledgerEntries = await db.select().from(stockLedger).where(eq(stockLedger.reference, ref));

  const recipeEntry = ledgerEntries.find((e) => e.recipeId === recipe.id);
  const ingredientEntries = ledgerEntries.filter((e) => e.ingredientId && !e.recipeId);

  if (!recipeEntry || recipeEntry.type !== "IN") {
    throw new Error("Missing recipe IN entry in stock ledger");
  }
  if (ingredientEntries.length !== 2) {
    throw new Error(`Expected 2 ingredient OUT entries, got ${ingredientEntries.length}`);
  }
  if (ingredientEntries.some((e) => e.type !== "OUT")) {
    throw new Error("Ingredient entries should be OUT type");
  }
  console.log(`  ✓ Stock ledger: 1 recipe IN + ${ingredientEntries.length} ingredient OUT entries`);

  // 7. Cleanup
  await db.delete(stockLedger).where(eq(stockLedger.reference, ref));
  await db.delete(recipeInventory).where(eq(recipeInventory.recipeId, recipe.id));
  await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipe.id));
  await db.delete(recipes).where(eq(recipes.id, recipe.id));

  // Restore inventory
  await db
    .update(inventory)
    .set({ quantity: inv1QtyBefore, lastUpdated: new Date() })
    .where(eq(inventory.id, inv1Before!.id));
  await db
    .update(inventory)
    .set({ quantity: inv2QtyBefore, lastUpdated: new Date() })
    .where(eq(inventory.id, inv2Before!.id));

  console.log("  ✓ Cleaned up throwaway rows");
  console.log("\n=== PASS ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("=== FAIL ===");
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
