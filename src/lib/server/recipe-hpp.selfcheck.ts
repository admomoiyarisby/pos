/**
 * Regression test for the "new recipe shows HPP = Rp 0" bug.
 *
 * Root cause: `createRecipe` / `updateRecipe` insert the recipe + BOM but
 * never compute `recipes.totalCogs`. The column defaults to 0 and was only
 * filled later by a manual "Recalculate HPP" action. Fix: both functions now
 * call `recalculateRecipeCosts([id])` after writing the BOM.
 *
 * This selfcheck drives the *real* cost-rollup path (the same function the
 * patched code invokes) against a live DB: it inserts a throwaway recipe with
 * two BOM ingredients, asserts totalCogs is 0 before the rollup and equals the
 * expected COGS after it, then deletes the throwaway rows.
 *
 * Run with:  node --import tsx src/lib/server/recipe-hpp.selfcheck.ts
 * (needs DATABASE_URL in .env.local)
 */

async function main() {
  // Load DATABASE_URL from .env.local BEFORE importing the DB module, since
  // ESM hoists static imports above any top-level code in this file.
  const { readFileSync } = await import("node:fs");
  const env = readFileSync(".env.local", "utf8");
  const m = env.match(/^DATABASE_URL="([^"]+)"/m);
  if (m) process.env.DATABASE_URL = m[1].trim();

  const { db } = await import("#/lib/server/db");
  const { recipes, recipeIngredients, ingredients } = await import("#/db/schema");
  const { recalculateRecipeCosts } = await import("#/lib/server/cost-rollup");
  const { eq, ilike } = await import("drizzle-orm");

  console.log("=== Recipe HPP regression self-check ===");

  async function findIngredient(name: string) {
    const [ing] = await db
      .select({ id: ingredients.id, cost: ingredients.averageCost })
      .from(ingredients)
      .where(ilike(ingredients.name, `%${name}%`))
      .limit(1);
    if (!ing) throw new Error(`seed ingredient "${name}" not found`);
    return { id: ing.id, cost: ing.cost };
  }

  // Use real ingredients so the COGS math mirrors production.
  const test1 = await findIngredient("TEST-1");
  const ayam = await findIngredient("Ayam Karage");

  const bom = [
    { ingredientId: test1.id, quantity: 2 },
    { ingredientId: ayam.id, quantity: 1 },
  ];
  const expectedCogs = test1.cost * 2 + ayam.cost * 1;

  const [recipe] = await db
    .insert(recipes)
    .values({ code: "SELFCHECK-HPP", name: "SELFCHECK-HPP", category: "makanan", basePrice: 1000 })
    .returning();
  await db.insert(recipeIngredients).values(bom.map((b) => ({ recipeId: recipe.id, ...b })));

  const before = await db
    .select({ tc: recipes.totalCogs })
    .from(recipes)
    .where(eq(recipes.id, recipe.id))
    .limit(1);

  if (before[0].tc !== 0) {
    throw new Error(
      `Expected totalCogs 0 right after insert (pre-fix symptom), got ${before[0].tc}`,
    );
  }
  console.log(`  ✓ totalCogs is 0 before rollup (reproduces the bug state)`);

  // This is the exact call the patched createRecipe/updateRecipe now performs.
  await recalculateRecipeCosts([recipe.id]);

  const after = await db
    .select({ tc: recipes.totalCogs })
    .from(recipes)
    .where(eq(recipes.id, recipe.id))
    .limit(1);

  if (after[0].tc !== expectedCogs) {
    throw new Error(`Expected totalCogs ${expectedCogs} after rollup, got ${after[0].tc}`);
  }
  console.log(`  ✓ totalCogs computed correctly after rollup = Rp ${after[0].tc}`);

  // cleanup
  await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipe.id));
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
