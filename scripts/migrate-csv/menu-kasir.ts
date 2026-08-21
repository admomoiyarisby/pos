/**
 * Recipes migration — List Menu Kasir (cashier prices).
 *
 * Reads `docs/csv/Detail POS - List Menu Kasir.csv`, which has a
 * sectioned layout (Rice Bowl / Ala Carte / Minuman / Add Ons / ... /
 * Barang Keluar). Each section repeats the header
 * "No.,Nama Menu X,HPP,Harga Offline" with a different "X".
 *
 * Behaviour:
 *   - For each menu, look up the recipe by canonical name. If found,
 *     update `basePrice` (Harga Offline) and `totalCogs` (HPP).
 *   - If the recipe isn't in the DB (e.g., "BUY 1 GET 1 KATSU DON" is
 *     a BOGO combo that Rincian doesn't list), insert a new recipe.
 *   - "FREE" prices → 0.
 *   - Section "Barang Keluar (Operasional)" is non-recipe (operational
 *     supplies); skipped.
 *   - Aliases ("Japanese Curry Karaage Don" → "Curry Karage Don",
 *     "Es Teh" → "Ice Tea", etc.) are normalised via `./normalize` +
 *     the small ALIAS_RECIPES map at the top of this file.
 *
 * The orchestrator runs `TRUNCATE recipes CASCADE` before this
 * migration when invoked from a clean state — wait, that would also
 * wipe Rincian Menu's recipes. Instead, this migration ONLY updates
 * existing rows + inserts NEW rows; it does NOT truncate.
 */

import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import * as schema from "../../src/db/schema";
import { lookupLabel } from "../../src/lib/label-lookup";
import { parseCsv, findColumns } from "./csv";

config({ path: [".env.local", ".env"] });

const CSV_PATH = resolve(process.cwd(), "docs/csv/Detail POS - List Menu Kasir.csv");

type RecipeInsert = typeof schema.recipes.$inferInsert;
type RecipeCategory = "makanan" | "minuman" | "snack" | "add_ons" | "paket_bundle";

const ALIAS_RECIPES = {
  "japanese curry karaage don": "Curry Karage Don",
  "japanese curry katsu don": "Curry Katsu Don",
  gohan: "nasi putih",
  "es teh": "Ice Tea",
  "caramel puding": "Caramel Pudding",
  "extra curry sauce": "Curry Sauce",
} satisfies Record<string, string>;

function canonicalRecipeName(raw: string): string {
  const norm = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (norm in ALIAS_RECIPES) return lookupLabel(ALIAS_RECIPES, norm)!;
  return raw.trim();
}

/** Parse "Rp 11.670,16" or "Rp 27,000.00" or "14,890.40" or "FREE" → integer IDR. */
function parseIdr(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toUpperCase() === "FREE") return 0;
  // Strip "Rp" prefix and any non-digit/non-separator characters.
  const cleaned = trimmed.replace(/[^\d.,]/g, "");
  if (!cleaned) return 0;
  const hasDot = cleaned.includes(".");
  const hasComma = cleaned.includes(",");
  if (hasDot && hasComma) {
    // Whichever separator appears LAST is the decimal separator.
    const lastDot = cleaned.lastIndexOf(".");
    const lastComma = cleaned.lastIndexOf(",");
    if (lastComma > lastDot) {
      // Indonesian: "11.670,16"
      const normalised = cleaned.replace(/\./g, "").replace(",", ".");
      return Math.round(parseFloat(normalised));
    } else {
      // American: "27,000.00"
      const normalised = cleaned.replace(/,/g, "");
      return Math.round(parseFloat(normalised));
    }
  }
  // Single separator. Decide decimal vs thousands by digit count after.
  if (hasComma) {
    const after = cleaned.slice(cleaned.lastIndexOf(",") + 1);
    if (after.length === 2) {
      // Decimal: "235,00" → 235
      return Math.round(parseFloat(cleaned.replace(",", ".")));
    }
    // Thousands: "27,000" → 27000
    return parseInt(cleaned.replace(/,/g, ""), 10);
  }
  if (hasDot) {
    const after = cleaned.slice(cleaned.lastIndexOf(".") + 1);
    if (after.length === 2) {
      // Decimal: "235.00" → 235
      return Math.round(parseFloat(cleaned));
    }
    // Thousands: "27.000" → 27000
    return parseInt(cleaned.replace(/\./g, ""), 10);
  }
  return parseInt(cleaned, 10);
}

const OPERATIONAL_SECTIONS = ["barang keluar", "operasional"];
const OPERATIONAL_NAMES = new Set([
  "galon",
  "lpg",
  "minyak 1 liter",
  "minyak 2 liter",
  "pex 15",
  "pex 20",
  "pex 25",
  "plastik klip",
  "tomat 12 x 25",
  "spons cuci",
  "sealer cup",
  "sunlight 1500",
  "kable ties",
  "tissue",
  "batterai",
  "tomat 20 x 35",
  "wijen 100 gr",
  "kresek sampah",
  "roll kertas nota",
  "isi steples",
  "daun parsley (gram)",
  "tepung ketan (pack)",
]);

function isOperational(section: string, name: string): boolean {
  if (OPERATIONAL_SECTIONS.some((s) => section.toLowerCase().includes(s))) return true;
  return OPERATIONAL_NAMES.has(name.toLowerCase());
}

function classifySection(section: string, name: string): RecipeCategory {
  const s = section.toLowerCase();
  if (s.includes("minuman")) return "minuman";
  if (
    s.includes("add ons") ||
    s.includes("add_ons") ||
    s.includes("pilih saus") ||
    s.includes("alat makan") ||
    s.includes("seasonal")
  )
    return "add_ons";
  if (
    name.toLowerCase().includes("rice") ||
    name.toLowerCase().includes("bowl") ||
    name.toLowerCase().includes("don") ||
    name.toLowerCase().includes("katsu") ||
    name.toLowerCase().includes("gyumeshi") ||
    name.toLowerCase().includes("karage") ||
    name.toLowerCase().includes("gyuniku")
  )
    return "makanan";
  return "makanan";
}

async function loadRecipeCodesByName(
  client: Client,
): Promise<Map<string, { id: string; code: string }>> {
  const result = await client.query<{ id: string; name: string; code: string }>(
    `SELECT id, name, code FROM recipes`,
  );
  const m = new Map<string, { id: string; code: string }>();
  for (const r of result.rows) m.set(r.name.toLowerCase(), { id: r.id, code: r.code });
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

type ParsedMenu = {
  rawName: string;
  canonicalName: string;
  section: string;
  hpp: number;
  price: number;
  isBOGO: boolean;
};

function parseCsvSections(raw: string): { section: string | null; items: ParsedMenu[] }[] {
  const table = parseCsv(raw);
  // The CSV has many short sections. Use findColumns to locate columns
  // by header name. Sections that lack "HPP"/"Harga Offline" don't have
  // the schema we need; skip them.
  const detected = findColumns(table, ["Nama Menu Rice Bowl", "HPP", "Harga Offline"]);
  if (!detected) {
    throw new Error(`CSV missing expected columns. Header was: [${table.header.join(", ")}]`);
  }
  // We need to find any row that has BOTH "Nama Menu X" AND "HPP" AND
  // "Harga Offline". findColumns doesn't tell us which section each row
  // belongs to, so we re-scan each section header to determine the
  // current section name.
  void detected;

  // Manual scan: each section header has a "Nama Menu X" cell where X
  // is the section name. The data rows that follow have the same
  // column shape.
  const result: { section: string | null; items: ParsedMenu[] }[] = [];
  let currentSection: string | null = null;
  let currentItems: ParsedMenu[] = [];
  let currentHeaderCols: { name: number; hpp: number; price: number } | null = null;

  const pushSection = () => {
    if (currentItems.length > 0) {
      result.push({ section: currentSection, items: currentItems });
    }
    currentItems = [];
    currentSection = null;
    currentHeaderCols = null;
  };

  for (const row of table.rows) {
    // Detect section header: a row with both "HPP" and "Harga Offline"
    // cells (the data row marker). Section names live in the cell that
    // starts with "No."'s neighbour column — typically "Nama Menu X" or
    // "Nama Add Ons X" or "Barang Keluar X". Pick whichever cell has
    // the longer non-"No." / non-"HPP" / non-"Harga Offline" content.
    const lower = row.map((c) => c.trim().toLowerCase());
    const hppIdx = lower.indexOf("hpp");
    const priceIdx = lower.indexOf("harga offline");
    if (hppIdx >= 0 && priceIdx >= 0) {
      pushSection();
      // Find the section label: any cell that isn't No./HPP/Harga Offline
      // and isn't empty is the label.
      const labelCells = row
        .map((c, i) => ({ cell: c.trim(), idx: i }))
        .filter(
          ({ cell, idx }) =>
            cell.length > 0 &&
            idx !== 0 && // not "No."
            idx !== hppIdx &&
            idx !== priceIdx,
        );
      currentSection = labelCells[0]?.cell ?? "";
      currentHeaderCols = {
        name: labelCells[0]?.idx ?? -1,
        hpp: hppIdx,
        price: priceIdx,
      };
      continue;
    }
    if (!currentHeaderCols || currentHeaderCols.name < 0) continue;
    const rawName = (row[currentHeaderCols.name] ?? "").trim();
    if (!rawName) continue;
    const hpp = parseIdr(row[currentHeaderCols.hpp] ?? "");
    const price = parseIdr(row[currentHeaderCols.price] ?? "");
    const lowerName = rawName.toLowerCase();
    const isBOGO = /\b(buy\s*\d+\s*get\s*\d+|bogo|free)\b/.test(lowerName);
    const canonical = canonicalRecipeName(rawName);
    currentItems.push({
      rawName,
      canonicalName: canonical,
      section: currentSection ?? "",
      hpp,
      price,
      isBOGO,
    });
  }
  pushSection();
  return result;
}

export type MenuKasirOptions = { dryRun?: boolean };

export async function migrateMenuKasir(options: MenuKasirOptions = {}): Promise<void> {
  const raw = readFileSync(CSV_PATH, "utf-8");
  const sections = parseCsvSections(raw);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new Client({ connectionString: url });
  await client.connect();

  const recipeByName = options.dryRun
    ? new Map<string, { id: string; code: string }>()
    : await loadRecipeCodesByName(client);
  let seq = options.dryRun ? 0 : await nextCodeSeq(client);

  const updates: { id: string; basePrice: number; totalCogs: number; isBOGO?: boolean }[] = [];
  const inserts: { recipe: RecipeInsert; categoryCode: RecipeCategory }[] = [];
  const warnings: string[] = [];

  for (const sec of sections) {
    for (const item of sec.items) {
      if (isOperational(sec.section ?? "", item.canonicalName)) continue;
      const existing = recipeByName.get(item.canonicalName.toLowerCase());
      if (existing) {
        updates.push({
          id: existing.id,
          basePrice: item.price,
          totalCogs: item.hpp,
          isBOGO: item.isBOGO ? true : undefined,
        });
      } else {
        seq += 1;
        const code = `REC-${String(seq).padStart(3, "0")}`;
        const categoryCode = classifySection(sec.section ?? "", item.canonicalName);
        inserts.push({
          recipe: {
            code,
            name: item.canonicalName,
            categoryId: "", // resolved from categoryCode before insert
            isSubRecipe: false,
            basePrice: item.price,
            totalCogs: item.hpp,
            isBOGO: item.isBOGO,
            status: "Active",
          },
          categoryCode,
        });
        recipeByName.set(item.canonicalName.toLowerCase(), { id: `dry-${code}`, code });
      }
    }
  }

  if (options.dryRun) {
    console.log(
      `[menu-kasir] dry-run: would update ${updates.length} recipes, insert ${inserts.length} new recipes`,
    );
    for (const u of updates) {
      console.log(
        `  ~ update recipe ${u.id} → basePrice=${u.basePrice} totalCogs=${u.totalCogs}${u.isBOGO ? " isBOGO" : ""}`,
      );
    }
    for (const i of inserts) {
      console.log(
        `  + insert ${i.recipe.code}  ${i.recipe.name}  [${i.categoryCode}] basePrice=${i.recipe.basePrice} totalCogs=${i.recipe.totalCogs}${i.recipe.isBOGO ? " BOGO" : ""}`,
      );
    }
    await client.end();
    return;
  }

  // Resolve category ids by code so recipes can be inserted with the
  // categoryId FK (the legacy recipe_category enum column was dropped).
  const catRows = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM categories`,
  );
  const categoryIdByCode = new Map(catRows.rows.map((r) => [r.code, r.id]));
  for (const i of inserts) {
    const id = categoryIdByCode.get(i.categoryCode);
    if (!id) {
      throw new Error(
        `No categories row for code "${i.categoryCode}" (recipe ${i.recipe.code} ${i.recipe.name})`,
      );
    }
    i.recipe.categoryId = id;
  }
  try {
    await client.query("BEGIN");
    const db = drizzle(client, { schema });
    for (const u of updates) {
      const set: Partial<typeof schema.recipes.$inferInsert> = {
        basePrice: u.basePrice,
        totalCogs: u.totalCogs,
      };
      if (u.isBOGO !== undefined) set.isBOGO = u.isBOGO;
      await db.update(schema.recipes).set(set).where(eq(schema.recipes.id, u.id));
    }
    if (inserts.length > 0) await db.insert(schema.recipes).values(inserts.map((i) => i.recipe));
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }

  console.log(
    `[menu-kasir] updated ${updates.length} recipes, inserted ${inserts.length} new recipes`,
  );
  for (const w of warnings) console.log(`  ! ${w}`);
}
