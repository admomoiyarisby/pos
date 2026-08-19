/**
 * ShopeeFood menu delta migration.
 *
 * Layered AFTER the CSV migrations (per wayfinder #44: `migrate-csv` is the
 * canonical seed path). The CSVs are the frozen primary source and already
 * contain the core menu; this module adds the items the CSVs OMIt that
 * Omoiyari actually sells on ShopeeFood, plus the shared "Tambahan" modifier
 * group (Tambah Telur / Tambah Cabe) attached to all rice-bowl + ala-carte
 * recipes.
 *
 * Source of the delta: docs/agents/shopeefood-catalog-delta.md (#36) and
 * docs/agents/new-item-boms.md (#37). Design: docs/agents/menu-shopeefood-design.md (#39).
 *
 * Behaviour:
 *   - Inserts 6 recipes (Choco Latte, Hojicha Latte, Choco Ichigo Latte,
 *     Curry Omurice, Japanese Caramel Pudding, Katsu Bento) with BOMs.
 *   - Creates the "Tambahan" modifier group (MG-005) with Tambah Telur
 *     (MOD-014) and Tambah Cabe (MOD-015), each linked to an ingredient so
 *     COGS updates on order.
 *   - Links the "Tambahan" group to every recipe whose category is in
 *     {makanan, snack, add_ons} (NOT minuman) — including the pre-existing
 *     CSV recipes, not just the 6 new ones.
 *   - Idempotent: upsert-by-name; on re-run, existing recipes/groups/links
 *     are left untouched. NO TRUNCATE (the CSV steps own truncation).
 */

import { config } from "dotenv";
import { Client } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../../src/db/schema";

config({ path: [".env.local", ".env"] });

type RecipeCategory = "makanan" | "minuman" | "snack" | "add_ons" | "paket_bundle";

// ─── Ingredient references (resolved by name at runtime) ───
// Every ingredient below already exists in the ingredient master (seeded by
// ingredients-central / ingredients-tenant). See #37 — no new ingredients.
type BomLine = { ingredient: string; qty: number };

type NewRecipe = {
  code: string; // assigned at runtime from nextCodeSeq
  name: string;
  category: RecipeCategory;
  basePrice: number;
  totalCogs: number;
  bom: BomLine[];
};

// HPP from Excel LIST HPP sheet (#36); basePrice = HPP × markup (decision #39-1).
const NEW_RECIPES: Omit<NewRecipe, "code">[] = [
  {
    name: "Choco Latte",
    category: "minuman",
    basePrice: 21000, // HPP 6013.63 × 3.5 ≈ 21048 → 21000
    totalCogs: 6014,
    bom: [
      { ingredient: "Choco Latte", qty: 1 },
      { ingredient: "Susu Fresh Milk", qty: 125 },
      { ingredient: "Air", qty: 50 },
      { ingredient: "Es Batu", qty: 180 },
      { ingredient: "Simple Syrup", qty: 15 },
      { ingredient: "Cup gelas PP 14Oz", qty: 1 },
      { ingredient: "Sedotan", qty: 1 },
    ],
  },
  {
    name: "Hojicha Latte",
    category: "minuman",
    basePrice: 28500, // HPP 8150.63 × 3.5 ≈ 28527 → 28500
    totalCogs: 8151,
    bom: [
      { ingredient: "Bubuk Hojicha", qty: 1 },
      { ingredient: "Susu Fresh Milk", qty: 125 },
      { ingredient: "Air", qty: 50 },
      { ingredient: "Es Batu", qty: 180 },
      { ingredient: "Simple Syrup", qty: 15 },
      { ingredient: "Cup gelas PP 14Oz", qty: 1 },
      { ingredient: "Sedotan", qty: 1 },
    ],
  },
  {
    name: "Choco Ichigo Latte",
    category: "minuman",
    basePrice: 25000, // HPP 7131.43 × 3.5 ≈ 24960 → 25000
    totalCogs: 7131,
    bom: [
      { ingredient: "Choco Latte", qty: 1 },
      { ingredient: "Strawberry Sauce", qty: 20 },
      { ingredient: "Susu Fresh Milk", qty: 125 },
      { ingredient: "Air", qty: 50 },
      { ingredient: "Es Batu", qty: 180 },
      { ingredient: "Simple Syrup", qty: 15 },
      { ingredient: "Cup gelas PP 14Oz", qty: 1 },
      { ingredient: "Sedotan", qty: 1 },
    ],
  },
  {
    name: "Curry Omurice",
    category: "makanan",
    basePrice: 27700, // HPP 9229.59 × 3 ≈ 27689 → 27700
    totalCogs: 9230,
    bom: [
      { ingredient: "Beras", qty: 67.5 },
      { ingredient: "Beras Ketan", qty: 7.5 },
      { ingredient: "Air", qty: 117 },
      { ingredient: "Cuka Nasi", qty: 1.25 },
      { ingredient: "Bowl Mangkok", qty: 1 },
      { ingredient: "Tutup Mangkok", qty: 1 },
      { ingredient: "inner tray bowl", qty: 1 },
      { ingredient: "Curry Sauce", qty: 1 },
      { ingredient: "Telor Ayam", qty: 1 },
      { ingredient: "Daun Bawang", qty: 1 },
    ],
  },
  {
    name: "Japanese Caramel Pudding",
    category: "snack",
    basePrice: 7200, // HPP 2064.84 × 3.5 ≈ 7227 → 7200
    totalCogs: 2065,
    bom: [
      { ingredient: "Pudding Caramel", qty: 1 },
      { ingredient: "Susu Fresh Milk", qty: 100 },
      { ingredient: "Telor Ayam", qty: 1 },
      { ingredient: "Vanili Pasta", qty: 1 },
      { ingredient: "Sendok Pudding", qty: 1 },
      { ingredient: "Cup gelas PP 12Oz", qty: 1 },
    ],
  },
  {
    name: "Katsu Bento",
    category: "makanan",
    basePrice: 31600, // HPP 10521.31 × 3 ≈ 31564 → 31600
    totalCogs: 10521,
    bom: [
      { ingredient: "Katsu Chicken", qty: 1 },
      { ingredient: "Beras", qty: 67.5 },
      { ingredient: "Beras Ketan", qty: 7.5 },
      { ingredient: "Air", qty: 117 },
      { ingredient: "Cuka Nasi", qty: 1.25 },
      { ingredient: "Bowl Mangkok", qty: 1 },
      { ingredient: "Tutup Mangkok", qty: 1 },
      { ingredient: "Bento Tray", qty: 1 },
      { ingredient: "Edamame", qty: 1 },
    ],
  },
];

const TAMBAHAN_GROUP_CODE = "MG-005";
const TAMBAH_TELUR_CODE = "MOD-014";
const TAMBAH_CABE_CODE = "MOD-015";

// Categories that get the Tambahan group (decision #39-3).
const TAMBAHAN_CATEGORIES = new Set<RecipeCategory>(["makanan", "snack", "add_ons"]);

async function nextRecipeCodeSeq(client: Client): Promise<number> {
  const result = await client.query<{ code: string }>(
    `SELECT code FROM recipes WHERE code ~ '^REC-[0-9]+$' ORDER BY code DESC LIMIT 1`,
  );
  if (result.rows.length === 0) return 0;
  const n = parseInt(result.rows[0]!.code.replace("REC-", ""), 10);
  return Number.isFinite(n) ? n : 0;
}

async function loadRecipeIdsByName(client: Client): Promise<Map<string, string>> {
  const result = await client.query<{ id: string; name: string }>(`SELECT id, name FROM recipes`);
  const m = new Map<string, string>();
  for (const r of result.rows) m.set(r.name.toLowerCase(), r.id);
  return m;
}

async function loadIngredientIdsByName(client: Client): Promise<Map<string, string>> {
  const result = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM ingredients`,
  );
  const m = new Map<string, string>();
  for (const r of result.rows) m.set(r.name.toLowerCase(), r.id);
  return m;
}

async function loadModifierGroupByCode(client: Client): Promise<Map<string, string>> {
  const result = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM modifier_groups`,
  );
  const m = new Map<string, string>();
  for (const r of result.rows) m.set(r.code, r.id);
  return m;
}

export type MenuShopeefoodOptions = { dryRun?: boolean };

export async function migrateMenuShopeefood(options: MenuShopeefoodOptions = {}): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = new Client({ connectionString: url });
  await client.connect();

  const recipeByName = await loadRecipeIdsByName(client);
  const ingredientByName = await loadIngredientIdsByName(client);
  const groupByCode = await loadModifierGroupByCode(client);

  let seq = options.dryRun ? 0 : await nextRecipeCodeSeq(client);

  const warnings: string[] = [];
  const inserts: (NewRecipe & { code: string })[] = [];

  // 1) Compute the recipe inserts (skip ones already present by name).
  for (const r of NEW_RECIPES) {
    if (recipeByName.has(r.name.toLowerCase())) {
      warnings.push(`${r.name}: already exists — skipped (idempotent)`);
      continue;
    }
    seq += 1;
    inserts.push({ ...r, code: `REC-${String(seq).padStart(3, "0")}` });
  }

  if (options.dryRun) {
    console.log(
      `[menu-shopeefood] dry-run: would insert ${inserts.length} recipes, create "Tambahan" group (${TAMBAHAN_GROUP_CODE}), attach to makanan/snack/add_ons recipes`,
    );
    for (const i of inserts) {
      console.log(
        `  + ${i.code}  ${i.name}  [${i.category}] basePrice=${i.basePrice} totalCogs=${i.totalCogs}`,
      );
      for (const b of i.bom) {
        const ok = ingredientByName.has(b.ingredient.toLowerCase());
        console.log(
          `      ${ok ? " " : "!"}${b.ingredient} × ${b.qty}${ok ? "" : "  (ingredient missing!)"}`,
        );
      }
    }
    console.log(
      `  + ${TAMBAHAN_GROUP_CODE} "Tambahan" → ${TAMBAH_TELUR_CODE} "Tambah Telur" (+5000, Telor Ayam ×1), ${TAMBAH_CABE_CODE} "Tambah Cabe" (+1000, Cabe bubuk ×5)`,
    );
    for (const w of warnings) console.log(`  ! ${w}`);
    await client.end();
    return;
  }

  // 2) Real run.
  try {
    await client.query("BEGIN");
    const db = drizzle(client, { schema });

    const recipeIdByName = new Map<string, string>();
    if (inserts.length > 0) {
      const recipeRows: (typeof schema.recipes.$inferInsert)[] = inserts.map((r) => ({
        code: r.code,
        name: r.name,
        category: r.category,
        isSubRecipe: false,
        basePrice: r.basePrice,
        totalCogs: r.totalCogs,
        isBOGO: false,
        status: "Active",
      }));
      const inserted = await db
        .insert(schema.recipes)
        .values(recipeRows)
        .returning({ id: schema.recipes.id, name: schema.recipes.name });
      for (const row of inserted) recipeIdByName.set(row.name.toLowerCase(), row.id);
    }
    // Include pre-existing recipes so the Tambahan group can attach to them too.
    for (const [name, id] of recipeByName) recipeIdByName.set(name, id);

    // 3) BOMs for the new recipes.
    const recipeIngredients: (typeof schema.recipeIngredients.$inferInsert)[] = [];
    for (const r of inserts) {
      const recipeId = recipeIdByName.get(r.name.toLowerCase());
      if (!recipeId) {
        warnings.push(`${r.name}: missing recipe id after insert`);
        continue;
      }
      for (const b of r.bom) {
        const ingId = ingredientByName.get(b.ingredient.toLowerCase());
        if (!ingId) {
          warnings.push(`${r.name}: skip BOM "${b.ingredient}" (ingredient not found)`);
          continue;
        }
        recipeIngredients.push({ recipeId, ingredientId: ingId, quantity: b.qty });
      }
    }
    if (recipeIngredients.length > 0) {
      await db.insert(schema.recipeIngredients).values(recipeIngredients);
    }

    // 4) Tambahan modifier group + modifiers (idempotent by code).
    let groupId = groupByCode.get(TAMBAHAN_GROUP_CODE);
    if (!groupId) {
      const [g] = await db
        .insert(schema.modifierGroups)
        .values({ code: TAMBAHAN_GROUP_CODE, name: "Tambahan", minSelection: 0, maxSelection: 2 })
        .returning({ id: schema.modifierGroups.id });
      groupId = g!.id;
    }
    const modByCode = new Map<string, string>();
    {
      const result = await client.query<{ id: string; code: string }>(
        `SELECT id, code FROM modifiers WHERE modifier_group_id = $1`,
        [groupId],
      );
      for (const row of result.rows) modByCode.set(row.code, row.id);
    }

    const telurIng = ingredientByName.get("telor ayam");
    const cabeIng = ingredientByName.get("cabe bubuk");

    const telurModId = await upsertModifier(
      client,
      db,
      modByCode,
      groupId,
      TAMBAH_TELUR_CODE,
      "Tambah Telur",
      5000,
      telurIng,
      1,
      warnings,
      "Tambah Telur",
    );
    const cabeModId = await upsertModifier(
      client,
      db,
      modByCode,
      groupId,
      TAMBAH_CABE_CODE,
      "Tambah Cabe",
      1000,
      cabeIng,
      5,
      warnings,
      "Tambah Cabe",
    );

    // 5) Attach Tambahan to all makanan/snack/add_ons recipes (not minuman).
    const existingLinks = new Map<string, string>();
    {
      const result = await client.query<{ recipe_id: string }>(
        `SELECT recipe_id FROM recipe_modifier_groups WHERE modifier_group_id = $1`,
        [groupId],
      );
      for (const row of result.rows) existingLinks.set(row.recipe_id, row.recipe_id);
    }
    const allRecipes = await client.query<{ id: string; category: RecipeCategory }>(
      `SELECT id, category FROM recipes`,
    );
    const links: (typeof schema.recipeModifierGroups.$inferInsert)[] = [];
    for (const r of allRecipes.rows) {
      if (existingLinks.has(r.id)) continue;
      const cat = r.category;
      if (!TAMBAHAN_CATEGORIES.has(cat)) continue;
      links.push({ recipeId: r.id, modifierGroupId: groupId });
    }
    if (links.length > 0) {
      await db.insert(schema.recipeModifierGroups).values(links);
    }

    void telurModId;
    void cabeModId;

    await client.query("COMMIT");
    console.log(
      `[menu-shopeefood] inserted ${inserts.length} recipes, ${recipeIngredients.length} recipe_ingredients, ` +
        `Tambahan group (${groupId ? "created/exists" : "MISSING"}), attached to ${links.length} recipes`,
    );
    for (const w of warnings) console.log(`  ! ${w}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

async function upsertModifier(
  client: Client,
  db: NodePgDatabase<typeof schema>,
  modByCode: Map<string, string>,
  groupId: string,
  code: string,
  name: string,
  price: number,
  ingredientId: string | undefined,
  qty: number,
  warnings: string[],
  label: string,
): Promise<string | undefined> {
  let modId = modByCode.get(code);
  if (!modId) {
    const [m] = await db
      .insert(schema.modifiers)
      .values({ code, modifierGroupId: groupId, name, price, isExclusion: false })
      .returning({ id: schema.modifiers.id });
    modId = m!.id;
  }
  if (ingredientId) {
    const existing = await client.query<{ modifier_id: string }>(
      `SELECT modifier_id FROM modifier_ingredients WHERE modifier_id = $1 AND ingredient_id = $2 LIMIT 1`,
      [modId!, ingredientId],
    );
    if (existing.rows.length === 0) {
      await db.insert(schema.modifierIngredients).values({
        modifierId: modId!,
        ingredientId,
        quantity: qty,
      });
    }
  } else {
    warnings.push(`${label}: ingredient not found — modifier created without COGS ingredient link`);
  }
  return modId;
}
