/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- withTx harness uses live pg BEGIN/ROLLBACK; TestDb surface is validated by DB round-trips */
import { Client } from "pg";
import { describe, expect, it } from "vite-plus/test";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";

type TestDb = NodePgDatabase<typeof schema>;
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

async function withTx<T>(fn: (db: TestDb, client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const db = drizzle(client, { schema });
    const result = await fn(db, client);
    return result;
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

function suid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

describe.skipIf(!hasDatabaseUrl)("db-risky calls — FK and transaction audit (map #129)", () => {
  describe("modifier-groups FK (restrict) — mirrors original bug d71419fc…", () => {
    it("deleting a modifier used in order_item_modifiers must FK-fail (raw delete), guard query must find it", async () => {
      await withTx(async (db, client) => {
        // Seed required ancestors
        const branchId = crypto.randomUUID();
        await db.insert(schema.branches).values({
          id: branchId,
          code: suid("BR"),
          name: "Branch FK",
          location: "Loc",
          type: "Outlet",
        });
        const catId = crypto.randomUUID();
        await db.insert(schema.categories).values({ id: catId, code: suid("CAT"), name: "Cat FK" });
        const recipeId = crypto.randomUUID();
        await db.insert(schema.recipes).values({
          id: recipeId,
          code: suid("RCP"),
          name: "Recipe FK",
          categoryId: catId,
          basePrice: 10000,
        });
        const mgId = crypto.randomUUID();
        await db
          .insert(schema.modifierGroups)
          .values({ id: mgId, code: suid("MG"), name: "MG FK" });
        const modId = crypto.randomUUID();
        await db.insert(schema.modifiers).values({
          id: modId,
          code: suid("MOD"),
          modifierGroupId: mgId,
          name: "Extra",
          price: 2000,
        });
        const orderId = crypto.randomUUID();
        await db.insert(schema.orders).values({
          id: orderId,
          branchId,
          channel: "Dine-in",
          subtotal: 10000,
          totalAmount: 12000,
          status: "New",
        });
        const orderItemId = crypto.randomUUID();
        await db.insert(schema.orderItems).values({
          id: orderItemId,
          orderId,
          recipeId,
          quantity: 1,
          price: 10000,
        });
        await db.insert(schema.orderItemModifiers).values({
          id: crypto.randomUUID(),
          orderItemId,
          modifierGroupId: mgId,
          modifierId: modId,
        });

        // Guard query (as used in fixed updateModifierGroup) must find the modifier
        const guarded = await db
          .select({ rid: schema.orderItemModifiers.modifierId })
          .from(schema.orderItemModifiers)
          .where(inArray(schema.orderItemModifiers.modifierId, [modId]));
        expect(guarded.length).toBe(1);

        // Raw delete must throw FK violation (restrict, no cascade) — this is the original bug's "Failed query: delete from modifiers"
        await client.query("SAVEPOINT sp_mod_del1");
        await expect(
          db.delete(schema.modifiers).where(eq(schema.modifiers.id, modId)),
        ).rejects.toThrow();
        await client.query("ROLLBACK TO SAVEPOINT sp_mod_del1");

        // Also delete by group must throw
        await client.query("SAVEPOINT sp_mod_del2");
        await expect(
          db.delete(schema.modifiers).where(eq(schema.modifiers.modifierGroupId, mgId)),
        ).rejects.toThrow();
        await client.query("ROLLBACK TO SAVEPOINT sp_mod_del2");

        // Deleting an unused modifier must succeed (positive control)
        const unusedModId = crypto.randomUUID();
        await db.insert(schema.modifiers).values({
          id: unusedModId,
          code: suid("MOD"),
          modifierGroupId: mgId,
          name: "Unused",
          price: 0,
        });
        await expect(
          db.delete(schema.modifiers).where(eq(schema.modifiers.id, unusedModId)),
        ).resolves.toBeDefined();
        const [stillUsed] = await db
          .select()
          .from(schema.modifiers)
          .where(eq(schema.modifiers.id, modId));
        expect(stillUsed).toBeDefined();
      });
    });

    it("deleting modifierGroup with used modifier must FK-fail via modifier path", async () => {
      await withTx(async (db, client) => {
        const branchId = crypto.randomUUID();
        await db.insert(schema.branches).values({
          id: branchId,
          code: suid("BR"),
          name: "Branch G2",
          location: "Loc",
          type: "Outlet",
        });
        const catId = crypto.randomUUID();
        await db.insert(schema.categories).values({ id: catId, code: suid("CAT"), name: "Cat G2" });
        const recipeId = crypto.randomUUID();
        await db.insert(schema.recipes).values({
          id: recipeId,
          code: suid("RCP"),
          name: "Recipe G2",
          categoryId: catId,
          basePrice: 10000,
        });
        const mgId = crypto.randomUUID();
        await db
          .insert(schema.modifierGroups)
          .values({ id: mgId, code: suid("MG"), name: "MG G2" });
        const modId = crypto.randomUUID();
        await db.insert(schema.modifiers).values({
          id: modId,
          code: suid("MOD"),
          modifierGroupId: mgId,
          name: "Used",
          price: 1000,
        });
        const orderId = crypto.randomUUID();
        await db.insert(schema.orders).values({
          id: orderId,
          branchId,
          channel: "Dine-in",
          subtotal: 10000,
          totalAmount: 10000,
          status: "New",
        });
        const orderItemId = crypto.randomUUID();
        await db.insert(schema.orderItems).values({
          id: orderItemId,
          orderId,
          recipeId,
          quantity: 1,
          price: 10000,
        });
        await db.insert(schema.orderItemModifiers).values({
          id: crypto.randomUUID(),
          orderItemId,
          modifierGroupId: mgId,
          modifierId: modId,
        });

        // Deleting the group itself must also eventually fail because its modifier is restricted
        // First step in deleteModifierGroup is delete(modifiers where group) — that already throws
        await client.query("SAVEPOINT sp_mod_group_del");
        await expect(
          db.delete(schema.modifiers).where(eq(schema.modifiers.modifierGroupId, mgId)),
        ).rejects.toThrow();
        await client.query("ROLLBACK TO SAVEPOINT sp_mod_group_del");
      });
    });
  });

  describe("updateRecipe non-transactional delete+re-insert — half-deleted BOM risk", () => {
    it("without transaction, a mid-path failure leaves half-deleted state; with transaction it rolls back", async () => {
      await withTx(async (db, client) => {
        const catId = crypto.randomUUID();
        await db.insert(schema.categories).values({ id: catId, code: suid("CAT"), name: "Cat R" });
        const ingId = crypto.randomUUID();
        await db.insert(schema.ingredients).values({
          id: ingId,
          code: suid("ING"),
          name: "Ing R",
          category: "Dry",
          skuType: "RM",
          purchaseUnit: "kg",
          stockUnit: "kg",
          conversionFactor: 1,
          averageCost: 1000,
        });
        const brandId = crypto.randomUUID();
        await db.insert(schema.brands).values({ id: brandId, code: suid("BRD"), name: "Brand R" });
        const branchId = crypto.randomUUID();
        await db.insert(schema.branches).values({
          id: branchId,
          code: suid("BR"),
          name: "Branch R",
          location: "Loc",
          type: "Outlet",
        });
        const mgId = crypto.randomUUID();
        await db.insert(schema.modifierGroups).values({ id: mgId, code: suid("MG"), name: "MG R" });
        const childRecipeId = crypto.randomUUID();
        await db.insert(schema.recipes).values({
          id: childRecipeId,
          code: suid("RCP"),
          name: "Child R",
          categoryId: catId,
          basePrice: 5000,
        });
        const recipeId = crypto.randomUUID();
        await db.insert(schema.recipes).values({
          id: recipeId,
          code: suid("RCP"),
          name: "Parent R",
          categoryId: catId,
          basePrice: 10000,
        });
        // Seed full relations (as updateRecipe would see them)
        await db.insert(schema.recipeBrands).values({ recipeId, brandId });
        await db
          .insert(schema.recipeIngredients)
          .values({ recipeId, ingredientId: ingId, quantity: 1 });
        await db
          .insert(schema.recipeChildRecipes)
          .values({ parentRecipeId: recipeId, childRecipeId, quantity: 1 });
        await db.insert(schema.recipeModifierGroups).values({ recipeId, modifierGroupId: mgId });
        await db.insert(schema.recipeBranches).values({ recipeId, branchId });

        // Verify seeded
        const brandsBefore = await db
          .select()
          .from(schema.recipeBrands)
          .where(eq(schema.recipeBrands.recipeId, recipeId));
        expect(brandsBefore.length).toBe(1);
        const ingsBefore = await db
          .select()
          .from(schema.recipeIngredients)
          .where(eq(schema.recipeIngredients.recipeId, recipeId));
        expect(ingsBefore.length).toBe(1);

        // --- Non-transactional path: delete 2 tables, then fail on 3rd insert (dup unique) ---
        // This mirrors updateRecipe's current 5 sequential deletes without txn
        await db.delete(schema.recipeBrands).where(eq(schema.recipeBrands.recipeId, recipeId));
        await db
          .delete(schema.recipeIngredients)
          .where(eq(schema.recipeIngredients.recipeId, recipeId));
        await db
          .delete(schema.recipeChildRecipes)
          .where(eq(schema.recipeChildRecipes.parentRecipeId, recipeId));
        // Now fail: insert duplicate child link (unique parent+child) twice in one insert batch
        const dupChild = { parentRecipeId: recipeId, childRecipeId: childRecipeId, quantity: 1 };
        await db.insert(schema.recipeChildRecipes).values([dupChild]); // first insert succeeds (now empty)
        // Second identical insert in same batch would violate unique — simulate by inserting dup again
        await client.query("SAVEPOINT sp_dup_child");
        await expect(db.insert(schema.recipeChildRecipes).values(dupChild)).rejects.toThrow();
        await client.query("ROLLBACK TO SAVEPOINT sp_dup_child");
        // At this point, first 2 deletes are already committed (no txn) — recipe has 0 brands, 0 ingredients but has 1 child (half-deleted)
        const brandsAfterFail = await db
          .select()
          .from(schema.recipeBrands)
          .where(eq(schema.recipeBrands.recipeId, recipeId));
        const ingsAfterFail = await db
          .select()
          .from(schema.recipeIngredients)
          .where(eq(schema.recipeIngredients.recipeId, recipeId));
        expect(brandsAfterFail.length).toBe(0); // lost — half-deleted
        expect(ingsAfterFail.length).toBe(0);
        // Cleanup the child we inserted for the fail case so next sub-test starts clean
        await db
          .delete(schema.recipeChildRecipes)
          .where(eq(schema.recipeChildRecipes.parentRecipeId, recipeId));

        // --- Transactional path: same deletes but inside db.transaction, with same failure, must rollback ---
        // Re-seed deleted relations
        await db.insert(schema.recipeBrands).values({ recipeId, brandId });
        await db
          .insert(schema.recipeIngredients)
          .values({ recipeId, ingredientId: ingId, quantity: 1 });

        await client.query("SAVEPOINT sp_trx_recipe2");
        let trxFailed = false;
        try {
          await db.delete(schema.recipeBrands).where(eq(schema.recipeBrands.recipeId, recipeId));
          await db
            .delete(schema.recipeIngredients)
            .where(eq(schema.recipeIngredients.recipeId, recipeId));
          // Child already deleted above, so first insert succeeds
          await db
            .insert(schema.recipeChildRecipes)
            .values({ parentRecipeId: recipeId, childRecipeId: childRecipeId, quantity: 1 });
          // Now duplicate again — should throw and rollback whole savepoint
          await db
            .insert(schema.recipeChildRecipes)
            .values({ parentRecipeId: recipeId, childRecipeId: childRecipeId, quantity: 1 });
          await client.query("RELEASE SAVEPOINT sp_trx_recipe2");
        } catch {
          await client.query("ROLLBACK TO SAVEPOINT sp_trx_recipe2");
          trxFailed = true;
        }
        expect(trxFailed).toBe(true);

        // After rollback, the 2 deletes must NOT have persisted — brands+ings still there
        const brandsAfterTxn = await db
          .select()
          .from(schema.recipeBrands)
          .where(eq(schema.recipeBrands.recipeId, recipeId));
        const ingsAfterTxn = await db
          .select()
          .from(schema.recipeIngredients)
          .where(eq(schema.recipeIngredients.recipeId, recipeId));
        expect(brandsAfterTxn.length).toBe(1);
        expect(ingsAfterTxn.length).toBe(1);
        // Cleanup child inserted then rolled back? Rollback already undid it, but ensure clean
        const childAfterTxn = await db
          .select()
          .from(schema.recipeChildRecipes)
          .where(eq(schema.recipeChildRecipes.parentRecipeId, recipeId));
        // child insert was rolled back, so 0
        expect(childAfterTxn.length).toBe(0);
      });
    });
  });

  describe("updateIngredient / updateUser branch links — non-atomic delete+insert", () => {
    it("ingredientBranches: non-transactional delete then bad insert leaves 0 rows (visible everywhere) vs txn rollback keeps old", async () => {
      await withTx(async (db, client) => {
        const ingId = crypto.randomUUID();
        await db.insert(schema.ingredients).values({
          id: ingId,
          code: suid("ING"),
          name: "Ing B",
          category: "Dry",
          skuType: "RM",
          purchaseUnit: "kg",
          stockUnit: "kg",
          conversionFactor: 1,
          averageCost: 1000,
        });
        const b1 = crypto.randomUUID();
        const b2 = crypto.randomUUID();
        for (const bid of [b1, b2]) {
          await db.insert(schema.branches).values({
            id: bid,
            code: suid("BR"),
            name: `Branch ${bid.slice(0, 4)}`,
            location: "Loc",
            type: "Outlet",
          });
        }
        await db.insert(schema.ingredientBranches).values([
          { ingredientId: ingId, branchId: b1 },
          { ingredientId: ingId, branchId: b2 },
        ]);

        const before = await db
          .select()
          .from(schema.ingredientBranches)
          .where(eq(schema.ingredientBranches.ingredientId, ingId));
        expect(before.length).toBe(2);

        // Non-txn: delete then insert with bogus FK -> delete already committed, insert fails, left with 0 (wrong - visible everywhere)
        // Wrap the failing insert in a savepoint so outer withTx transaction stays valid for the assertion
        await db
          .delete(schema.ingredientBranches)
          .where(eq(schema.ingredientBranches.ingredientId, ingId));
        const bogusBranch = crypto.randomUUID(); // not in branches table -> FK fail
        await client.query("SAVEPOINT sp_branches_bogus");
        await expect(
          db
            .insert(schema.ingredientBranches)
            .values({ ingredientId: ingId, branchId: bogusBranch }),
        ).rejects.toThrow();
        await client.query("ROLLBACK TO SAVEPOINT sp_branches_bogus");
        const afterFail = await db
          .select()
          .from(schema.ingredientBranches)
          .where(eq(schema.ingredientBranches.ingredientId, ingId));
        expect(afterFail.length).toBe(0);

        // Re-seed for txn test
        await db.insert(schema.ingredientBranches).values([
          { ingredientId: ingId, branchId: b1 },
          { ingredientId: ingId, branchId: b2 },
        ]);

        // Txn version must rollback to 2 rows (proper atomicity via savepoint)
        await client.query("SAVEPOINT sp_txn_branches2");
        let failed = false;
        try {
          await db
            .delete(schema.ingredientBranches)
            .where(eq(schema.ingredientBranches.ingredientId, ingId));
          await db
            .insert(schema.ingredientBranches)
            .values({ ingredientId: ingId, branchId: bogusBranch });
          await client.query("RELEASE SAVEPOINT sp_txn_branches2");
        } catch {
          await client.query("ROLLBACK TO SAVEPOINT sp_txn_branches2");
          failed = true;
        }
        expect(failed).toBe(true);
        const afterTxn = await db
          .select()
          .from(schema.ingredientBranches)
          .where(eq(schema.ingredientBranches.ingredientId, ingId));
        expect(afterTxn.length).toBe(2);
      });
    });

    it("areaManagerBranches: same non-atomic risk", async () => {
      await withTx(async (db, client) => {
        const userId = crypto.randomUUID();
        await db.insert(schema.users).values({
          id: userId,
          name: "AM Test",
          email: suid("am") + "@test.local",
          role: "area_manager",
          status: "Active",
        });
        const b1 = crypto.randomUUID();
        const b2 = crypto.randomUUID();
        for (const bid of [b1, b2]) {
          await db.insert(schema.branches).values({
            id: bid,
            code: suid("BR"),
            name: `Branch AM ${bid.slice(0, 4)}`,
            location: "Loc",
            type: "Outlet",
          });
        }
        await db.insert(schema.areaManagerBranches).values([
          { userId, branchId: b1 },
          { userId, branchId: b2 },
        ]);

        const before = await db
          .select()
          .from(schema.areaManagerBranches)
          .where(eq(schema.areaManagerBranches.userId, userId));
        expect(before.length).toBe(2);

        await db
          .delete(schema.areaManagerBranches)
          .where(eq(schema.areaManagerBranches.userId, userId));
        const bogus = crypto.randomUUID();
        await client.query("SAVEPOINT sp_am_bogus");
        await expect(
          db.insert(schema.areaManagerBranches).values({ userId, branchId: bogus }),
        ).rejects.toThrow();
        await client.query("ROLLBACK TO SAVEPOINT sp_am_bogus");
        const afterFail = await db
          .select()
          .from(schema.areaManagerBranches)
          .where(eq(schema.areaManagerBranches.userId, userId));
        expect(afterFail.length).toBe(0);

        await db.insert(schema.areaManagerBranches).values([
          { userId, branchId: b1 },
          { userId, branchId: b2 },
        ]);
        await client.query("SAVEPOINT sp_txn_am");
        let rolledBack = false;
        try {
          await db
            .delete(schema.areaManagerBranches)
            .where(eq(schema.areaManagerBranches.userId, userId));
          await db.insert(schema.areaManagerBranches).values({ userId, branchId: bogus });
          await client.query("RELEASE SAVEPOINT sp_txn_am");
        } catch {
          await client.query("ROLLBACK TO SAVEPOINT sp_txn_am");
          rolledBack = true;
        }
        expect(rolledBack).toBe(true);
        const afterTxn = await db
          .select()
          .from(schema.areaManagerBranches)
          .where(eq(schema.areaManagerBranches.userId, userId));
        expect(afterTxn.length).toBe(2);
      });
    });
  });

  describe("deleteIngredient hardDelete guard (tombstone ADR-0009)", () => {
    it("hardDelete must be blocked when ingredient is used in recipeIngredients (friendly count check)", async () => {
      await withTx(async (db, client) => {
        const ingId = crypto.randomUUID();
        await db.insert(schema.ingredients).values({
          id: ingId,
          code: suid("ING"),
          name: "Ing Hard",
          category: "Dry",
          skuType: "RM",
          purchaseUnit: "kg",
          stockUnit: "kg",
          conversionFactor: 1,
          averageCost: 1000,
        });
        const catId = crypto.randomUUID();
        await db
          .insert(schema.categories)
          .values({ id: catId, code: suid("CAT"), name: "Cat Hard" });
        const recipeId = crypto.randomUUID();
        await db.insert(schema.recipes).values({
          id: recipeId,
          code: suid("RCP"),
          name: "Recipe Hard",
          categoryId: catId,
          basePrice: 10000,
        });
        await db
          .insert(schema.recipeIngredients)
          .values({ recipeId, ingredientId: ingId, quantity: 1 });

        // This is the guard used in deleteIngredient: count recipeIngredients where ingredientId
        const [cnt] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.recipeIngredients)
          .where(eq(schema.recipeIngredients.ingredientId, ingId));
        expect(Number(cnt.count)).toBe(1);

        // Raw hard delete would FK-fail (restrict) — verify (savepoint so outer txn stays valid)
        await client.query("SAVEPOINT sp_hard_delete");
        await expect(
          db.delete(schema.ingredients).where(eq(schema.ingredients.id, ingId)),
        ).rejects.toThrow();
        await client.query("ROLLBACK TO SAVEPOINT sp_hard_delete");

        // Soft delete (tombstone) must succeed even when referenced
        const [soft] = await db
          .update(schema.ingredients)
          .set({ status: "Deleted" })
          .where(eq(schema.ingredients.id, ingId))
          .returning();
        expect(soft.status).toBe("Deleted");
      });
    });
  });

  describe("category reassign+delete — positive control (already transactional)", () => {
    it("deleteCategory pattern (update recipes.categoryId + delete category) is atomic when in transaction", async () => {
      await withTx(async (db, _client) => {
        const c1 = crypto.randomUUID();
        const c2 = crypto.randomUUID();
        await db.insert(schema.categories).values([
          { id: c1, code: suid("CAT"), name: "C1" },
          { id: c2, code: suid("CAT"), name: "C2" },
        ]);
        const r1 = crypto.randomUUID();
        await db.insert(schema.recipes).values({
          id: r1,
          code: suid("RCP"),
          name: "R1",
          categoryId: c1,
          basePrice: 10000,
        });
        // Simulate transactional deleteCategory: reassign then delete
        await db.transaction(async (tx) => {
          await tx
            .update(schema.recipes)
            .set({ categoryId: c2 })
            .where(eq(schema.recipes.categoryId, c1));
          await tx.delete(schema.categories).where(eq(schema.categories.id, c1));
        });
        const [gone] = await db
          .select()
          .from(schema.categories)
          .where(eq(schema.categories.id, c1));
        expect(gone).toBeUndefined();
        const [moved] = await db.select().from(schema.recipes).where(eq(schema.recipes.id, r1));
        expect(moved.categoryId).toBe(c2);

        // Verify rollback: same but with bogus dest FK -> whole txn must rollback, C1 stays, recipe not moved
        const c3 = crypto.randomUUID();
        await db.insert(schema.categories).values({ id: c3, code: suid("CAT"), name: "C3" });
        const r2 = crypto.randomUUID();
        await db.insert(schema.recipes).values({
          id: r2,
          code: suid("RCP"),
          name: "R2",
          categoryId: c3,
          basePrice: 10000,
        });
        const bogusDest = crypto.randomUUID(); // not a category -> FK fail on update
        const failed = await db
          .transaction(async (tx) => {
            await tx
              .update(schema.recipes)
              .set({ categoryId: bogusDest })
              .where(eq(schema.recipes.categoryId, c3));
            await tx.delete(schema.categories).where(eq(schema.categories.id, c3));
          })
          .then(() => false)
          .catch(() => true);
        expect(failed).toBe(true);
        const [c3Still] = await db
          .select()
          .from(schema.categories)
          .where(eq(schema.categories.id, c3));
        expect(c3Still).toBeDefined();
        const [r2Still] = await db.select().from(schema.recipes).where(eq(schema.recipes.id, r2));
        expect(r2Still.categoryId).toBe(c3);
      });
    });
  });
});
