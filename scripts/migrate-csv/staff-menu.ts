/**
 * Recipes migration — Menu Makan Staff (staff meals).
 *
 * Reads `docs/csv/Detail POS - Menu Makan Staff.csv` which has two
 * sections:
 *   1. "Harga HPP Makan Pegawai" — staff menu names + discounted prices
 *   2. "Rincian Menu Makan Staff" — recipe BOM (same format as Rincian
 *      Menu) for the BASE recipes (not the staff-named ones).
 *
 * Behaviour:
 *   - Insert a new recipe per staff menu item (name preserved verbatim,
 *     category "makanan", basePrice = staff HPP).
 *   - For BOM, the section lists the BASE recipe names (Karage Don,
 *     nasi putih, Chicken Katsu Don). We copy those BOM rows onto the
 *     matching staff recipe via a hard-coded mapping
 *     (CHICKEN_KARAAGE → Karage Don, NASI → nasi putih, etc.).
 *   - "Telor Staff" has no BOM in the source CSV — inserted without
 *     recipe_ingredients (admin can attach later).
 */

import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import * as schema from "../../src/db/schema";
import { lookupLabel } from "../../src/lib/label-lookup";
import { parseCsv, findColumns } from "./csv";
import { canonicalName } from "./normalize";

config({ path: [".env.local", ".env"] });

const CSV_PATH = resolve(process.cwd(), "docs/csv/Detail POS - Menu Makan Staff.csv");

type RecipeInsert = typeof schema.recipes.$inferInsert;
type RecipeIngredientInsert = typeof schema.recipeIngredients.$inferInsert;

/**
 * Map a staff recipe name → the BASE recipe name whose BOM it inherits.
 * If no base found, the staff recipe is inserted without BOM.
 */
const STAFF_TO_BASE = {
  "Chicken Katsu Staff": "Chicken Katsu Don",
  "Chicken Karaage Staff": "Karage Don",
  "Nasi Staff": "nasi putih",
} satisfies Record<string, string>;

function parseIdr(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const cleaned = trimmed.replace(/[^\d.,]/g, "");
  if (!cleaned) return 0;
  const hasDot = cleaned.includes(".");
  const hasComma = cleaned.includes(",");
  if (hasDot && hasComma) {
    const lastDot = cleaned.lastIndexOf(".");
    const lastComma = cleaned.lastIndexOf(",");
    if (lastComma > lastDot) {
      return Math.round(parseFloat(cleaned.replace(/\./g, "").replace(",", ".")));
    }
    return Math.round(parseFloat(cleaned.replace(/,/g, "")));
  }
  if (hasComma) {
    const after = cleaned.slice(cleaned.lastIndexOf(",") + 1);
    if (after.length === 2) {
      return Math.round(parseFloat(cleaned.replace(",", ".")));
    }
    return parseInt(cleaned.replace(/,/g, ""), 10);
  }
  if (hasDot) {
    const after = cleaned.slice(cleaned.lastIndexOf(".") + 1);
    if (after.length === 2) {
      return Math.round(parseFloat(cleaned));
    }
    return parseInt(cleaned.replace(/\./g, ""), 10);
  }
  return parseInt(cleaned, 10);
}

type StaffPrice = { name: string; price: number };
type BomLine = { seq: number; rawName: string; canonical: string | null; qty: number };

function parseStaffPrices(table: ReturnType<typeof parseCsv>): StaffPrice[] {
  const detected = findColumns(table, ["Harga HPP Makan Pegawai", "Harga"]);
  if (!detected) return [];
  const nameCol = detected.indices["harga hpp makan pegawai"]!;
  const priceCol = detected.indices["harga"]!;
  const out: StaffPrice[] = [];
  for (const row of detected.data) {
    // Stop at empty separator rows or section markers like
    // "Rincian Menu Makan Staff" (which signals the BOM section starts).
    const allEmpty = row.every((c) => !c.trim());
    if (allEmpty) break;
    if (row.some((c) => /rincian menu/i.test(c.trim()))) break;
    const name = (row[nameCol] ?? "").trim();
    if (!name) continue;
    if (name.toLowerCase() === "harga hpp makan pegawai") continue;
    const price = parseIdr(row[priceCol] ?? "");
    out.push({ name, price });
  }
  return out;
}

function parseStaffBom(table: ReturnType<typeof parseCsv>): Map<string, BomLine[]> {
  const detected = findColumns(table, ["Menu", "Bahan", "Berat"]);
  if (!detected) return new Map();
  const menuCol = detected.indices["menu"]!;
  const bahanCol = detected.indices["bahan"]!;
  const beratCol = detected.indices["berat"]!;
  const map = new Map<string, BomLine[]>();
  let current: { menu: string; lines: BomLine[] } | null = null;
  for (const row of detected.data) {
    const menu = (row[menuCol] ?? "").trim();
    if (menu) {
      current = { menu, lines: [] };
      map.set(menu, current.lines);
    }
    if (!current) continue;
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
  }
  return map;
}

async function loadRecipeByName(client: Client): Promise<Map<string, { id: string }>> {
  const result = await client.query<{ id: string; name: string }>(`SELECT id, name FROM recipes`);
  const m = new Map<string, { id: string }>();
  for (const r of result.rows) m.set(r.name.toLowerCase(), { id: r.id });
  return m;
}

async function loadIngredientCodesByName(client: Client): Promise<Map<string, { id: string }>> {
  const result = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM ingredients`,
  );
  const m = new Map<string, { id: string }>();
  for (const r of result.rows) m.set(r.name.toLowerCase(), { id: r.id });
  return m;
}

async function nextCodeSeq(client: Client): Promise<number> {
  const result = await client.query<{ code: string }>(
    `SELECT code FROM recipes WHERE code ~ '^REC-[0-9]+$' ORDER BY code DESC LIMIT 1`,
  );
  if (result.rows.length === 0) return 0;
  const n = parseInt(result.rows[0]!.code.replace("REC-", ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export type StaffMenuOptions = { dryRun?: boolean };

export async function migrateStaffMenu(options: StaffMenuOptions = {}): Promise<void> {
  const raw = readFileSync(CSV_PATH, "utf-8");
  const table = parseCsv(raw);
  const prices = parseStaffPrices(table);
  const bom = parseStaffBom(table);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new Client({ connectionString: url });
  await client.connect();

  const recipeByName = options.dryRun
    ? new Map<string, { id: string }>()
    : await loadRecipeByName(client);
  const ingByName = options.dryRun
    ? new Map<string, { id: string }>()
    : await loadIngredientCodesByName(client);
  let seq = options.dryRun ? 0 : await nextCodeSeq(client);

  const inserts: { recipe: RecipeInsert; baseName: string | null }[] = [];
  const recipeIngredients: RecipeIngredientInsert[] = [];
  const warnings: string[] = [];

  for (const p of prices) {
    if (recipeByName.has(p.name.toLowerCase())) {
      // Already exists — skip; we don't overwrite prices.
      warnings.push(`${p.name}: already exists, skipping`);
      continue;
    }
    seq += 1;
    const code = `REC-${String(seq).padStart(3, "0")}`;
    const recipe: RecipeInsert = {
      code,
      name: p.name,
      category: "makanan",
      isSubRecipe: false,
      basePrice: p.price,
      totalCogs: 0,
      isBOGO: false,
      status: "Active",
    };
    inserts.push({ recipe, baseName: lookupLabel(STAFF_TO_BASE, p.name) ?? null });
  }

  if (options.dryRun) {
    console.log(
      `[staff-menu] dry-run: would insert ${inserts.length} recipes, ${recipeIngredients.length} recipe_ingredients`,
    );
    for (const { recipe: r, baseName } of inserts) {
      const lines = bom.get(baseName ?? "")?.length ?? 0;
      console.log(
        `  + ${r.code}  ${r.name}  basePrice=${r.basePrice}  (BOM from ${baseName ?? "(none)"}: ${lines} lines)`,
      );
    }
    for (const w of warnings) console.log(`  ! ${w}`);
    await client.end();
    return;
  }

  // Insert staff recipes first; capture their UUIDs for BOM copy.
  let insertedRecipes: { id: string; name: string }[];
  try {
    await client.query("BEGIN");
    const db = drizzle(client, { schema });
    insertedRecipes = await db
      .insert(schema.recipes)
      .values(inserts.map((i) => i.recipe))
      .returning({ id: schema.recipes.id, name: schema.recipes.name });
    const idByName = new Map(insertedRecipes.map((r) => [r.name, r.id]));

    for (const { recipe, baseName } of inserts) {
      if (!baseName) continue;
      const bomLines = bom.get(baseName);
      if (!bomLines || bomLines.length === 0) {
        warnings.push(`${recipe.name}: no BOM for base "${baseName}"`);
        continue;
      }
      const staffId = idByName.get(recipe.name);
      if (!staffId) {
        warnings.push(`${recipe.name}: staff recipe id not found after insert`);
        continue;
      }
      for (const line of bomLines) {
        if (line.canonical === null) {
          warnings.push(`${recipe.name}: skip "${line.rawName}" (non-ingredient)`);
          continue;
        }
        const ing = ingByName.get(line.canonical.toLowerCase());
        if (!ing) {
          warnings.push(
            `${recipe.name}: skip "${line.rawName}" (no ingredient "${line.canonical}")`,
          );
          continue;
        }
        recipeIngredients.push({
          recipeId: staffId,
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
    `[staff-menu] inserted ${inserts.length} recipes, ${recipeIngredients.length} recipe_ingredients`,
  );
  for (const w of warnings) console.log(`  ! ${w}`);
}
