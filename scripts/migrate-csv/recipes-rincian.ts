/**
 * Recipes migration — Rincian Menu (recipe BOM).
 *
 * Reads `docs/csv/Detail POS - Rincian Menu.csv` and inserts rows into
 * `recipes` + `recipe_ingredients`. The CSV groups ingredients by
 * recipe name (the "Menu" column); subsequent rows with an empty Menu
 * continue the previous recipe.
 *
 * Each line's "Bahan" is canonicalised via `./normalize` and looked up
 * in the `ingredients` table (inserted by `ingredients-central` /
 * `ingredients-tenant`). Lines whose ingredient can't be resolved are
 * logged and skipped.
 *
 * Recipe categorisation uses a name-based heuristic; everything defaults
 * to "makanan". Drinks go to "minuman"; standalone sauces and "extra"
 * add-ons go to "add_ons".
 *
 * The orchestrator runs `TRUNCATE recipes CASCADE` before this
 * migration when invoked from a clean state (CASCADE also clears
 * recipe_ingredients, recipe_brands, recipe_modifier_groups, etc.).
 */

import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import * as schema from "../../src/db/schema";
import { parseCsv, findColumns } from "./csv";
import { canonicalName } from "./normalize";

config({ path: [".env.local", ".env"] });

const CSV_PATH = resolve(process.cwd(), "docs/csv/Detail POS - Rincian Menu.csv");

type RecipeInsert = typeof schema.recipes.$inferInsert;
type RecipeIngredientInsert = typeof schema.recipeIngredients.$inferInsert;

type RecipeCategory = "makanan" | "minuman" | "snack" | "add_ons" | "paket_bundle";

function classifyRecipe(name: string): RecipeCategory {
  const lower = name.toLowerCase();
  if (/\b(latte|tea|jus|es teh|matcha|coffee)\b/.test(lower)) return "minuman";
  if (lower.includes("sauce") || lower.startsWith("extra ") || lower.includes("add"))
    return "add_ons";
  return "makanan";
}

async function nextCodeSeq(client: Client): Promise<number> {
  const result = await client.query<{ code: string }>(
    `SELECT code FROM recipes WHERE code ~ '^REC-[0-9]+$' ORDER BY code DESC LIMIT 1`,
  );
  if (result.rows.length === 0) return 0;
  const n = parseInt(result.rows[0]!.code.replace("REC-", ""), 10);
  return Number.isFinite(n) ? n : 0;
}

async function loadIngredientCodesByName(
  client: Client,
): Promise<Map<string, { id: string; code: string }>> {
  const result = await client.query<{ id: string; name: string; code: string }>(
    `SELECT id, name, code FROM ingredients`,
  );
  const m = new Map<string, { id: string; code: string }>();
  for (const r of result.rows) m.set(r.name.toLowerCase(), { id: r.id, code: r.code });
  return m;
}

/**
 * For dry-run: read the two ingredient CSVs (Central + Tenant) to
 * compute the union of canonical ingredient names without touching the
 * DB. Lets the dry-run accurately flag "this recipe line references an
 * ingredient we don't know about".
 */
function loadIngredientCodesFromCsvs(): Map<string, { code: string }> {
  const names = new Set<string>();
  for (const path of [
    "docs/csv/Detail POS - List Item Central Kitchen.csv",
    "docs/csv/Detail POS - List Item Tenant (Cabang).csv",
  ]) {
    const raw = readFileSync(resolve(process.cwd(), path), "utf-8");
    const table = parseCsv(raw);
    const detected = findColumns(table, ["Nama Bahan"]);
    if (!detected) continue;
    const nameCol = detected.indices["nama bahan"]!;
    for (const row of detected.data) {
      const raw2 = (row[nameCol] ?? "").trim();
      if (!raw2) continue;
      const canonical = canonicalName(raw2);
      if (canonical) names.add(canonical);
    }
  }
  const m = new Map<string, { code: string }>();
  let seq = 0;
  for (const name of names) {
    seq += 1;
    m.set(name.toLowerCase(), { code: `ING-${String(seq).padStart(3, "0")}` });
  }
  return m;
}

type BomLine = { seq: number; rawName: string; canonical: string | null; qty: number };

type RecipeGroup = {
  menu: string;
  recipe: RecipeInsert;
  lines: BomLine[];
};

export type RecipesRincianOptions = { dryRun?: boolean };

export async function migrateRecipesRincian(options: RecipesRincianOptions = {}): Promise<void> {
  const raw = readFileSync(CSV_PATH, "utf-8");
  const table = parseCsv(raw);

  const detected = findColumns(table, ["Menu", "Bahan", "Berat"]);
  if (!detected) {
    throw new Error(`CSV missing expected columns. Header was: [${table.header.join(", ")}]`);
  }
  const menuCol = detected.indices["menu"]!;
  const bahanCol = detected.indices["bahan"]!;
  const beratCol = detected.indices["berat"]!;
  const data = detected.data;

  // Group rows by recipe (carry-forward empty Menu cells).
  const groups: RecipeGroup[] = [];
  let current: RecipeGroup | null = null;
  for (const row of data) {
    const menu = (row[menuCol] ?? "").trim();
    if (menu) {
      current = {
        menu,
        recipe: {
          code: "", // assigned after we know starting seq
          name: menu,
          category: classifyRecipe(menu),
          isSubRecipe: false,
          basePrice: 0,
          totalCogs: 0,
          isBOGO: false,
          status: "Active",
        },
        lines: [],
      };
      groups.push(current);
    }
    if (!current) continue;
    const no = groups.indexOf(current) >= 0 ? groups.indexOf(current) + 1 : 0;
    const name = (row[bahanCol] ?? "").trim();
    const qtyRaw = parseFloat((row[beratCol] ?? "0").trim());
    const qty = Number.isFinite(qtyRaw) ? Math.round(qtyRaw) : 0;
    if (!name) continue;
    current.lines.push({
      seq: current.lines.length + 1,
      rawName: name,
      canonical: canonicalName(name),
      qty,
    });
    void no;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new Client({ connectionString: url });
  await client.connect();

  // For dry-run, simulate dependencies by reading the ingredient CSVs.
  // For real run, query the DB.
  const ingByCanonical = options.dryRun
    ? loadIngredientCodesFromCsvs()
    : await loadIngredientCodesByName(client);
  let seq = options.dryRun ? 0 : await nextCodeSeq(client);
  for (const g of groups) {
    seq += 1;
    g.recipe.code = `REC-${String(seq).padStart(3, "0")}`;
  }

  const warnings: string[] = [];
  const recipeIngredients: RecipeIngredientInsert[] = [];

  if (options.dryRun) {
    console.log(`[recipes-rincian] dry-run: would insert ${groups.length} recipes`);
    for (const g of groups) {
      console.log(`  - ${g.recipe.code}  ${g.recipe.name}  [${g.recipe.category}]`);
      for (const l of g.lines) {
        const ing = l.canonical ? ingByCanonical.get(l.canonical.toLowerCase()) : null;
        const marker = ing ? " " : "!";
        const label = ing ? ing.code : `(missing: ${l.canonical ?? l.rawName})`;
        console.log(`      ${marker} ${l.seq}. ${l.canonical ?? l.rawName} [${label}] × ${l.qty}`);
      }
    }
    for (const g of groups) {
      for (const l of g.lines) {
        if (l.canonical === null) {
          warnings.push(`${g.menu}: skip "${l.rawName}" (non-ingredient)`);
        } else if (!ingByCanonical.has(l.canonical.toLowerCase())) {
          warnings.push(
            `${g.menu}: skip "${l.rawName}" (no ingredient with canonical "${l.canonical}")`,
          );
        }
      }
    }
    for (const w of warnings) console.log(`  ! ${w}`);
    await client.end();
    return;
  }

  // Build the recipe_ingredients with real recipe IDs after insert.
  try {
    await client.query("BEGIN");
    const db = drizzle(client, { schema });
    const recipeRows = groups.map((g) => g.recipe);
    const insertedRecipes = await db
      .insert(schema.recipes)
      .values(recipeRows)
      .returning({ id: schema.recipes.id, code: schema.recipes.code });
    const idByCode = new Map(insertedRecipes.map((r) => [r.code, r.id]));

    for (const g of groups) {
      const recipeId = idByCode.get(g.recipe.code);
      if (!recipeId) throw new Error(`Missing inserted recipe id for ${g.recipe.code}`);
      for (const line of g.lines) {
        if (line.canonical === null) {
          warnings.push(`${g.menu}: skip "${line.rawName}" (non-ingredient)`);
          continue;
        }
        const ing = ingByCanonical.get(line.canonical.toLowerCase()) as
          | { id: string; code: string }
          | undefined;
        if (!ing) {
          warnings.push(
            `${g.menu}: skip "${line.rawName}" (no ingredient with canonical "${line.canonical}")`,
          );
          continue;
        }
        recipeIngredients.push({
          recipeId,
          ingredientId: ing.id,
          quantity: line.qty,
        });
      }
    }
    if (recipeIngredients.length > 0) {
      await db.insert(schema.recipeIngredients).values(recipeIngredients);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }

  console.log(
    `[recipes-rincian] inserted ${groups.length} recipes, ${recipeIngredients.length} recipe_ingredients`,
  );
  for (const w of warnings) console.log(`  ! ${w}`);
}
