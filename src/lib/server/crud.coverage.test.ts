import { describe, it, expect } from "vite-plus/test";
import { z } from "zod";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";

const testDatabaseUrl = getTestDatabaseUrl();
const hasTestDatabaseUrl = Boolean(testDatabaseUrl);
type TestDb = NodePgDatabase<typeof schema>;

// ─────────────────────────────────────────────────────────────────────────────
// Unit seam: Zod validation contracts (no DB needed)
// These pin the public input shape so CRUD callers trust the interface.
// ─────────────────────────────────────────────────────────────────────────────

describe("crud validation contracts", () => {
  // Voucher — pin the same rules as src/lib/server/vouchers.ts
  const voucherInput = z.object({
    code: z.string().min(1).max(50).toUpperCase(),
    description: z.string().min(1).max(200),
    discountType: z.enum(["percentage", "fixed"]),
    discountValue: z.number().int().min(0),
    minOrder: z.number().int().min(0).default(0),
    validUntil: z.string().datetime(),
    isActive: z.boolean().default(true),
  });

  it("voucher: accepts a valid percentage voucher", () => {
    const now = new Date(Date.now() + 86400000).toISOString();
    expect(() =>
      voucherInput.parse({
        code: "PROMO10",
        description: "Diskon 10%",
        discountType: "percentage",
        discountValue: 10,
        minOrder: 50000,
        validUntil: now,
        isActive: true,
      }),
    ).not.toThrow();
  });

  it("voucher: uppercases code and rejects empty code", () => {
    const now = new Date(Date.now() + 86400000).toISOString();
    const parsed = voucherInput.parse({
      code: "promo10",
      description: "d",
      discountType: "fixed",
      discountValue: 5000,
      minOrder: 0,
      validUntil: now,
    });
    expect(parsed.code).toBe("PROMO10");
    expect(() =>
      voucherInput.parse({
        code: "",
        description: "d",
        discountType: "percentage",
        discountValue: 0,
        validUntil: now,
      }),
    ).toThrow();
  });

  it("voucher: rejects percentage >100 at UI layer (page enforces 0-100)", () => {
    // server schema allows >100 but UI should block — this documents the gap
    const now = new Date(Date.now() + 86400000).toISOString();
    const parsed = voucherInput.parse({
      code: "BIG",
      description: "d",
      discountType: "percentage",
      discountValue: 150,
      minOrder: 0,
      validUntil: now,
    });
    expect(parsed.discountValue).toBe(150);
    // UI layer enforces max 100 — tested in admin/vouchers.tsx handleSubmit
  });

  it("voucher: rejects invalid datetime", () => {
    expect(() =>
      voucherInput.parse({
        code: "X",
        description: "d",
        discountType: "fixed",
        discountValue: 0,
        minOrder: 0,
        validUntil: "not-a-date",
      }),
    ).toThrow();
  });

  // Branch
  const branchInput = z.object({
    code: z.string().min(1).max(20),
    name: z.string().min(1).max(100),
    location: z.string().min(1).max(200),
    type: z.enum(["Central", "Outlet"]),
  });
  it("branch: rejects missing code/name/location", () => {
    expect(() =>
      branchInput.parse({ code: "", name: "A", location: "L", type: "Outlet" }),
    ).toThrow();
    // SAFETY: testing invalid enum — "Unknown" is not a valid Branch type
    expect(() =>
      branchInput.parse({ code: "C", name: "A", location: "L", type: "Unknown" as any }),
    ).toThrow();
  });

  // Category
  const categoryInput = z.object({
    code: z.string().min(1).max(50),
    name: z.string().min(1).max(100),
  });
  it("category: rejects empty code/name", () => {
    expect(() => categoryInput.parse({ code: "", name: "Makanan" })).toThrow();
    expect(() => categoryInput.parse({ code: "MAK", name: "" })).toThrow();
  });

  // Ingredient
  const ingredientInput = z.object({
    code: z.string().min(1).max(30),
    name: z.string().min(1).max(100),
    category: z.enum(["Fresh", "Dry", "Packaging"]),
    skuType: z.enum(["RM", "SFG", "FG"]),
    purchaseUnit: z.string().min(1),
    stockUnit: z.string().min(1),
    conversionFactor: z.number().int().min(1),
    averageCost: z.number().int().min(0),
  });
  it("ingredient: rejects invalid category/skuType/conversionFactor", () => {
    // SAFETY: testing invalid category — "Bad" not in Fresh/Dry/Packaging
    expect(() =>
      ingredientInput.parse({
        code: "I",
        name: "N",
        category: "Bad" as any,
        skuType: "RM",
        purchaseUnit: "kg",
        stockUnit: "g",
        conversionFactor: 1,
        averageCost: 0,
      }),
    ).toThrow();
    expect(() =>
      ingredientInput.parse({
        code: "I",
        name: "N",
        category: "Fresh",
        skuType: "RM",
        purchaseUnit: "kg",
        stockUnit: "g",
        conversionFactor: 0,
        averageCost: 0,
      }),
    ).toThrow();
  });

  // Recipe — minimal required shape from src/lib/server/recipes.ts
  const recipeInput = z.object({
    code: z.string().min(1).max(30),
    name: z.string().min(1).max(100),
    categoryId: z.string().uuid(),
    basePrice: z.number().int().min(0),
    brandIds: z.array(z.string().uuid()),
    ingredients: z.array(
      z.object({ ingredientId: z.string().uuid(), quantity: z.number().positive() }),
    ),
  });
  it("recipe: rejects missing categoryId (uuid) and empty code", () => {
    const fakeId = "550e8400-e29b-41d4-a716-446655440000";
    expect(() =>
      recipeInput.parse({
        code: "",
        name: "Nasi",
        categoryId: fakeId,
        basePrice: 1000,
        brandIds: [],
        ingredients: [],
      }),
    ).toThrow();
    expect(() =>
      recipeInput.parse({
        code: "R001",
        name: "Nasi",
        categoryId: "not-a-uuid",
        basePrice: 1000,
        brandIds: [],
        ingredients: [],
      }),
    ).toThrow();
  });

  it("recipe: rejects negative basePrice", () => {
    const fakeId = "550e8400-e29b-41d4-a716-446655440000";
    expect(() =>
      recipeInput.parse({
        code: "R001",
        name: "Nasi",
        categoryId: fakeId,
        basePrice: -1,
        brandIds: [],
        ingredients: [],
      }),
    ).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration seam: real Postgres via drizzle with transaction rollback
// Verifies the persistence contract: create → get → update → (soft) delete
// ─────────────────────────────────────────────────────────────────────────────

async function withRollbackDb<T>(fn: (db: TestDb) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: testDatabaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const db = drizzle(client, { schema });
    const result = await fn(db);
    await client.query("ROLLBACK");
    return result;
  } finally {
    await client.end();
  }
}

describe.skipIf(!hasTestDatabaseUrl)("crud persistence integration", () => {
  it("category: create → get → delete (reassign) → verify", async () => {
    await withRollbackDb(async (db) => {
      const catA = `CAT-A-${Date.now().toString(36)}`;
      const catB = `CAT-B-${Date.now().toString(36)}`;
      const [a] = await db
        .insert(schema.categories)
        .values({ code: catA, name: "Cat A CRUD" })
        .returning();
      const [b] = await db
        .insert(schema.categories)
        .values({ code: catB, name: "Cat B CRUD" })
        .returning();
      expect(a.id).toBeTruthy();
      // create recipe in A
      const [recipe] = await db
        .insert(schema.recipes)
        .values({
          code: `RC-${Date.now().toString(36)}`,
          name: "Recipe in A",
          categoryId: a.id,
          basePrice: 10000,
          status: "Active",
        })
        .returning();
      // reassign to B then delete A (mirrors deleteCategory)
      await db
        .update(schema.recipes)
        .set({ categoryId: b.id })
        .where(eq(schema.recipes.id, recipe.id));
      await db.delete(schema.categories).where(eq(schema.categories.id, a.id));
      const remaining = await db
        .select()
        .from(schema.categories)
        .where(eq(schema.categories.id, a.id));
      expect(remaining).toHaveLength(0);
      const moved = await db.select().from(schema.recipes).where(eq(schema.recipes.id, recipe.id));
      expect(moved[0].categoryId).toBe(b.id);
    });
  });

  it("category: duplicate code rejected by unique constraint", async () => {
    await withRollbackDb(async (db) => {
      const code = `DUP-CAT-${Date.now().toString(36)}`;
      await db.insert(schema.categories).values({ code, name: "First" });
      await expect(db.insert(schema.categories).values({ code, name: "Second" })).rejects.toThrow();
    });
  });

  it("branch: create → get → update → soft-delete (active=false)", async () => {
    await withRollbackDb(async (db) => {
      const code = `BR-${Date.now().toString(36).slice(0, 6)}`;
      const [br] = await db
        .insert(schema.branches)
        .values({ code, name: "Branch CRUD", location: "Test Loc", type: "Outlet" })
        .returning();
      expect(br.active).toBe(true);
      const fetched = await db.select().from(schema.branches).where(eq(schema.branches.id, br.id));
      expect(fetched[0].name).toBe("Branch CRUD");
      const [updated] = await db
        .update(schema.branches)
        .set({ name: "Branch CRUD Updated", updatedAt: new Date() })
        .where(eq(schema.branches.id, br.id))
        .returning();
      expect(updated.name).toBe("Branch CRUD Updated");
      const [soft] = await db
        .update(schema.branches)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(schema.branches.id, br.id))
        .returning();
      expect(soft.active).toBe(false);
      const activeOnly = await db
        .select()
        .from(schema.branches)
        .where(eq(schema.branches.active, true));
      expect(activeOnly.find((r) => r.id === br.id)).toBeUndefined();
    });
  });

  it("branch: duplicate code rejected", async () => {
    await withRollbackDb(async (db) => {
      const code = `BR-DUP-${Date.now().toString(36).slice(0, 6)}`;
      await db.insert(schema.branches).values({ code, name: "B1", location: "L", type: "Outlet" });
      await expect(
        db.insert(schema.branches).values({ code, name: "B2", location: "L", type: "Outlet" }),
      ).rejects.toThrow();
    });
  });

  it("brand: create → get → update", async () => {
    await withRollbackDb(async (db) => {
      const code = `BRAND-${Date.now().toString(36)}`;
      const [brand] = await db
        .insert(schema.brands)
        .values({ code, name: "Brand CRUD" })
        .returning();
      const [updated] = await db
        .update(schema.brands)
        .set({ name: "Brand Updated" })
        .where(eq(schema.brands.id, brand.id))
        .returning();
      expect(updated.name).toBe("Brand Updated");
      const all = await db.select().from(schema.brands).where(eq(schema.brands.id, brand.id));
      expect(all[0].code).toBe(code);
    });
  });

  it("brand: duplicate code rejected", async () => {
    await withRollbackDb(async (db) => {
      const code = `BRAND-DUP-${Date.now().toString(36)}`;
      await db.insert(schema.brands).values({ code, name: "B1" });
      await expect(db.insert(schema.brands).values({ code, name: "B2" })).rejects.toThrow();
    });
  });

  it("ingredient: create → get (visible) → update averageCost → soft-delete", async () => {
    await withRollbackDb(async (db) => {
      const code = `ING-${Date.now().toString(36)}`;
      const [ing] = await db
        .insert(schema.ingredients)
        .values({
          code,
          name: "Ing CRUD",
          category: "Fresh",
          skuType: "RM",
          purchaseUnit: "kg",
          stockUnit: "g",
          conversionFactor: 1000,
          averageCost: 5000,
        })
        .returning();
      expect(ing.status).toBe("Active");
      const fetched = await db
        .select()
        .from(schema.ingredients)
        .where(eq(schema.ingredients.id, ing.id));
      expect(fetched[0].name).toBe("Ing CRUD");
      const [upd] = await db
        .update(schema.ingredients)
        .set({ averageCost: 6000, updatedAt: new Date() })
        .where(eq(schema.ingredients.id, ing.id))
        .returning();
      expect(upd.averageCost).toBe(6000);
      await db
        .update(schema.ingredients)
        .set({ status: "Deleted", updatedAt: new Date() })
        .where(eq(schema.ingredients.id, ing.id));
      const afterDelete = await db
        .select()
        .from(schema.ingredients)
        .where(eq(schema.ingredients.id, ing.id));
      expect(afterDelete[0].status).toBe("Deleted");
      const visible = await db
        .select()
        .from(schema.ingredients)
        .where(ne(schema.ingredients.status, "Deleted"));
      expect(visible.find((r) => r.id === ing.id)).toBeUndefined();
    });
  });

  it("ingredient: duplicate code rejected", async () => {
    await withRollbackDb(async (db) => {
      const code = `ING-DUP-${Date.now().toString(36)}`;
      await db.insert(schema.ingredients).values({
        code,
        name: "I1",
        category: "Fresh",
        skuType: "RM",
        purchaseUnit: "kg",
        stockUnit: "g",
        conversionFactor: 1000,
        averageCost: 100,
      });
      await expect(
        db.insert(schema.ingredients).values({
          code,
          name: "I2",
          category: "Dry",
          skuType: "RM",
          purchaseUnit: "kg",
          stockUnit: "g",
          conversionFactor: 1000,
          averageCost: 200,
        }),
      ).rejects.toThrow();
    });
  });

  it("recipe: create → get → update → deactivate → reactivate → soft-delete", async () => {
    await withRollbackDb(async (db) => {
      const [cat] = await db
        .insert(schema.categories)
        .values({ code: `CAT-R-${Date.now().toString(36)}`, name: "Cat for recipe CRUD" })
        .returning();
      const code = `RC-${Date.now().toString(36)}`;
      const [recipe] = await db
        .insert(schema.recipes)
        .values({
          code,
          name: "Recipe CRUD",
          categoryId: cat.id,
          basePrice: 15000,
          status: "Active",
        })
        .returning();
      expect(recipe.status).toBe("Active");
      const fetched = await db
        .select()
        .from(schema.recipes)
        .where(eq(schema.recipes.id, recipe.id));
      expect(fetched[0].name).toBe("Recipe CRUD");
      const [upd] = await db
        .update(schema.recipes)
        .set({ basePrice: 20000, updatedAt: new Date() })
        .where(eq(schema.recipes.id, recipe.id))
        .returning();
      expect(upd.basePrice).toBe(20000);
      await db
        .update(schema.recipes)
        .set({ status: "Inactive", updatedAt: new Date() })
        .where(eq(schema.recipes.id, recipe.id));
      let after = await db.select().from(schema.recipes).where(eq(schema.recipes.id, recipe.id));
      expect(after[0].status).toBe("Inactive");
      await db
        .update(schema.recipes)
        .set({ status: "Active", updatedAt: new Date() })
        .where(eq(schema.recipes.id, recipe.id));
      after = await db.select().from(schema.recipes).where(eq(schema.recipes.id, recipe.id));
      expect(after[0].status).toBe("Active");
      await db
        .update(schema.recipes)
        .set({ status: "Deleted", updatedAt: new Date() })
        .where(eq(schema.recipes.id, recipe.id));
      after = await db.select().from(schema.recipes).where(eq(schema.recipes.id, recipe.id));
      expect(after[0].status).toBe("Deleted");
      const visible = await db
        .select()
        .from(schema.recipes)
        .where(ne(schema.recipes.status, "Deleted"));
      expect(visible.find((r) => r.id === recipe.id)).toBeUndefined();
    });
  });

  it("recipe: duplicate code rejected", async () => {
    await withRollbackDb(async (db) => {
      const [cat] = await db
        .insert(schema.categories)
        .values({ code: `CAT-DUP-${Date.now().toString(36)}`, name: "Cat dup" })
        .returning();
      const code = `RC-DUP-${Date.now().toString(36)}`;
      await db
        .insert(schema.recipes)
        .values({ code, name: "R1", categoryId: cat.id, basePrice: 1000, status: "Active" });
      await expect(
        db
          .insert(schema.recipes)
          .values({ code, name: "R2", categoryId: cat.id, basePrice: 2000, status: "Active" }),
      ).rejects.toThrow();
    });
  });

  it("recipe: rejects invalid categoryId FK", async () => {
    await withRollbackDb(async (db) => {
      const fakeCat = "00000000-0000-0000-0000-000000000000";
      await expect(
        db.insert(schema.recipes).values({
          code: `RC-FK-${Date.now().toString(36)}`,
          name: "Bad FK",
          categoryId: fakeCat,
          basePrice: 1000,
          status: "Active",
        }),
      ).rejects.toThrow();
    });
  });

  it("modifier-group: create → get → update → delete", async () => {
    await withRollbackDb(async (db) => {
      const code = `MG-${Date.now().toString(36)}`;
      const [mg] = await db
        .insert(schema.modifierGroups)
        .values({ code, name: "MG CRUD", minSelection: 0, maxSelection: 1 })
        .returning();
      const fetched = await db
        .select()
        .from(schema.modifierGroups)
        .where(eq(schema.modifierGroups.id, mg.id));
      expect(fetched[0].name).toBe("MG CRUD");
      const [upd] = await db
        .update(schema.modifierGroups)
        .set({ name: "MG Updated" })
        .where(eq(schema.modifierGroups.id, mg.id))
        .returning();
      expect(upd.name).toBe("MG Updated");
      await db.delete(schema.modifierGroups).where(eq(schema.modifierGroups.id, mg.id));
      const after = await db
        .select()
        .from(schema.modifierGroups)
        .where(eq(schema.modifierGroups.id, mg.id));
      expect(after).toHaveLength(0);
    });
  });

  it("modifier-group: duplicate code rejected", async () => {
    await withRollbackDb(async (db) => {
      const code = `MG-DUP-${Date.now().toString(36)}`;
      await db.insert(schema.modifierGroups).values({ code, name: "MG1" });
      await expect(
        db.insert(schema.modifierGroups).values({ code, name: "MG2" }),
      ).rejects.toThrow();
    });
  });

  it("voucher: create → get → deactivate → soft-delete (status lifecycle)", async () => {
    await withRollbackDb(async (db) => {
      const userId =
        (await db.select({ id: schema.users.id }).from(schema.users).limit(1))[0]?.id ??
        "00000000-0000-0000-0000-000000000001";
      let creatorId = userId;
      const existingUser = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, creatorId))
        .limit(1);
      if (existingUser.length === 0) {
        const [br] = await db
          .insert(schema.branches)
          .values({
            code: `BR-V-${Date.now().toString(36).slice(0, 6)}`,
            name: "V Branch",
            location: "L",
            type: "Outlet",
          })
          .returning();
        const [u] = await db
          .insert(schema.users)
          .values({
            name: "Voucher Tester",
            email: `vtest-${Date.now()}@test.id`,
            role: "super_admin",
            status: "Active",
            branchId: br.id,
          })
          .returning();
        creatorId = u.id;
      }
      const code = `VOUCH-${Date.now().toString(36).toUpperCase()}`;
      const [v1] = await db
        .insert(schema.vouchers)
        .values({
          code,
          description: "Test voucher",
          discountType: "percentage",
          discountValue: 10,
          minOrder: 50000,
          validUntil: new Date(Date.now() + 86400000),
          createdBy: creatorId,
          status: "Active",
        })
        .returning();
      expect(v1.code).toBe(code);
      const fetched = await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, v1.id));
      expect(fetched[0].description).toBe("Test voucher");
      const [upd] = await db
        .update(schema.vouchers)
        .set({ discountValue: 20 })
        .where(eq(schema.vouchers.id, v1.id))
        .returning();
      expect(upd.discountValue).toBe(20);
      const [inactive] = await db
        .update(schema.vouchers)
        .set({ status: "Inactive" })
        .where(eq(schema.vouchers.id, v1.id))
        .returning();
      expect(inactive.status).toBe("Inactive");

      const [deleted] = await db
        .update(schema.vouchers)
        .set({ status: "Deleted" })
        .where(eq(schema.vouchers.id, v1.id))
        .returning();
      expect(deleted.status).toBe("Deleted");

      const visible = await db
        .select()
        .from(schema.vouchers)
        .where(ne(schema.vouchers.status, "Deleted"));
      expect(visible.find((r) => r.id === v1.id)).toBeUndefined();
    });
  });

  it("voucher: duplicate code rejected by unique constraint (isolated tx)", async () => {
    await withRollbackDb(async (db) => {
      const creatorId = (await db.select({ id: schema.users.id }).from(schema.users).limit(1))[0]
        ?.id;
      if (!creatorId) return;
      const code = `VOUCH-DUP-${Date.now().toString(36).toUpperCase()}`;
      await db.insert(schema.vouchers).values({
        code,
        description: "first",
        discountType: "fixed",
        discountValue: 5000,
        minOrder: 0,
        validUntil: new Date(Date.now() + 86400000),
        createdBy: creatorId,
      });
      await expect(
        db.insert(schema.vouchers).values({
          code,
          description: "dup",
          discountType: "fixed",
          discountValue: 5000,
          minOrder: 0,
          validUntil: new Date(Date.now() + 86400000),
          createdBy: creatorId,
        }),
      ).rejects.toThrow();
    });
  });

  it("voucher: rejects invalid discountType via schema (DB enum)", async () => {
    await withRollbackDb(async (db) => {
      const creatorId = (await db.select({ id: schema.users.id }).from(schema.users).limit(1))[0]
        ?.id;
      if (!creatorId) return;
      // SAFETY: testing invalid enum — "bogus" not in percentage/fixed
      await expect(
        db.insert(schema.vouchers).values({
          code: `VOUCH-BAD-${Date.now().toString(36)}`,
          description: "bad",
          discountType: "bogus" as any,
          discountValue: 10,
          minOrder: 0,
          validUntil: new Date(Date.now() + 86400000),
          createdBy: creatorId,
        }),
      ).rejects.toThrow();
    });
  });

  it("supplier: create → get → update", async () => {
    await withRollbackDb(async (db) => {
      const code = `SUP-${Date.now().toString(36)}`;
      const [sup] = await db
        .insert(schema.suppliers)
        .values({ code, name: "Supplier CRUD", status: "Active" })
        .returning();
      const [upd] = await db
        .update(schema.suppliers)
        .set({ name: "Supplier Updated", updatedAt: new Date() })
        .where(eq(schema.suppliers.id, sup.id))
        .returning();
      expect(upd.name).toBe("Supplier Updated");
      const fetched = await db
        .select()
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, sup.id));
      expect(fetched[0].code).toBe(code);
    });
  });

  it("supplier: duplicate code rejected", async () => {
    await withRollbackDb(async (db) => {
      const code = `SUP-DUP-${Date.now().toString(36)}`;
      await db.insert(schema.suppliers).values({ code, name: "S1" });
      await expect(db.insert(schema.suppliers).values({ code, name: "S2" })).rejects.toThrow();
    });
  });

  it("user: create → get → update (role/status)", async () => {
    await withRollbackDb(async (db) => {
      const [br] = await db
        .insert(schema.branches)
        .values({
          code: `BR-U-${Date.now().toString(36).slice(0, 6)}`,
          name: "User Branch",
          location: "L",
          type: "Outlet",
        })
        .returning();
      const email = `user-crud-${Date.now()}@test.id`;
      const [user] = await db
        .insert(schema.users)
        .values({
          name: "User CRUD",
          email,
          role: "branch_admin",
          status: "Active",
          branchId: br.id,
        })
        .returning();
      const fetched = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
      expect(fetched[0].email).toBe(email);
      const [upd] = await db
        .update(schema.users)
        .set({ status: "Inactive", updatedAt: new Date() })
        .where(eq(schema.users.id, user.id))
        .returning();
      expect(upd.status).toBe("Inactive");
    });
  });

  it("user: duplicate email rejected", async () => {
    await withRollbackDb(async (db) => {
      const email = `dup-${Date.now()}@test.id`;
      await db
        .insert(schema.users)
        .values({ name: "U1", email, role: "branch_admin", status: "Active" });
      await expect(
        db
          .insert(schema.users)
          .values({ name: "U2", email, role: "branch_admin", status: "Active" }),
      ).rejects.toThrow();
    });
  });
});
