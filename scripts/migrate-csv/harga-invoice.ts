/**
 * Ingredients migration — Harga Invoice all (per-item costs).
 *
 * Reads `docs/csv/Detail POS - Harga Invoice all.csv`. The CSV has a
 * two-table layout (one side-by-side):
 *
 *   "Harga Invoice All Tenant (per Item)"  |  "Harga Invoice Pucang (per Item)"
 *     No, Item, Quantity, _, Harga,         |    No, Item, Quantity, _, _,
 *         Harga+5%, HargaPerItem, Satuan    |        _, _, HargaPerItem, Satuan
 *
 * The Pucang column is a 5% markup on All Tenant's "Harga per item".
 * We only load All Tenant (the base price) into `ingredients.averageCost`;
 * the per-branch markup would live in a separate table when the schema
 * grows one. Until then, the Pucang column is ignored.
 *
 * Behaviour:
 *   - For each row, look up the ingredient by canonical name.
 *   - If found, UPDATE `averageCost` to the per-item price.
 *   - If the item is operational (e.g., "sunlight 1500"), skip silently.
 *
 * No truncate — UPDATE only.
 */

import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import * as schema from "../../src/db/schema";
import {
  assessCostChange,
  needsCostConfirmation,
  resolveQuotedCost,
} from "../../src/lib/cost-guard";
import { parseCsv, findColumns } from "./csv";
import { canonicalName } from "./normalize";

config({ path: [".env.local", ".env"] });

const CSV_PATH = resolve(process.cwd(), "docs/csv/Detail POS - Harga Invoice all.csv");

// Column indices for the LEFT (All Tenant) table, hard-coded based on
// the header row structure (8 columns + 1 separator column).
const COL_LEFT_NO = 0;
const COL_LEFT_ITEM = 1;
const COL_LEFT_PER_UNIT = 6;
const COL_LEFT_UNIT = 7;

function parseIdrPerUnit(raw: string): number {
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
  // IDR per-unit prices use comma as decimal: "Rp 49,00" or "Rp 1.350,00".
  if (hasComma) {
    const after = cleaned.slice(cleaned.lastIndexOf(",") + 1);
    if (after.length <= 2) {
      return Math.round(parseFloat(cleaned.replace(",", ".")));
    }
    return parseInt(cleaned.replace(/,/g, ""), 10);
  }
  if (hasDot) {
    const after = cleaned.slice(cleaned.lastIndexOf(".") + 1);
    if (after.length <= 2) {
      return Math.round(parseFloat(cleaned));
    }
    return parseInt(cleaned.replace(/\./g, ""), 10);
  }
  return parseInt(cleaned, 10);
}

interface CostTarget {
  id: string;
  name: string;
  averageCost: number;
  stockUnit: string;
  purchaseUnit: string;
  conversionFactor: number;
}

async function loadIngredientCodesByName(client: Client): Promise<Map<string, CostTarget>> {
  const result = await client.query<CostTarget>(
    `SELECT id, name, average_cost as "averageCost", stock_unit as "stockUnit",
            purchase_unit as "purchaseUnit", conversion_factor as "conversionFactor"
       FROM ingredients`,
  );
  const m = new Map<string, CostTarget>();
  for (const r of result.rows) m.set(r.name.toLowerCase(), r);
  return m;
}

/**
 * For dry-run: read both ingredient CSVs to know which canonical names
 * are recognised (without DB).
 */
function loadIngredientNamesFromCsvs(): Map<string, CostTarget> {
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
      const r = (row[nameCol] ?? "").trim();
      if (!r) continue;
      const canonical = canonicalName(r);
      if (canonical) names.add(canonical);
    }
  }
  const m = new Map<string, CostTarget>();
  for (const n of names) {
    m.set(n.toLowerCase(), {
      id: `dry-${n}`,
      name: n,
      averageCost: 0,
      stockUnit: "",
      purchaseUnit: "",
      conversionFactor: 1,
    });
  }
  return m;
}

export type HargaInvoiceOptions = {
  dryRun?: boolean;
  /** Apply rows the cost guard flags as suspicious (unit mismatch or a >5x jump). */
  applySuspect?: boolean;
};

export async function migrateHargaInvoice(options: HargaInvoiceOptions = {}): Promise<void> {
  const raw = readFileSync(CSV_PATH, "utf-8");
  const table = parseCsv(raw);

  // Detect columns by header names; the left table has "Item" + "Harga per item".
  const detected = findColumns(table, ["Item", "Harga per item"]);
  if (!detected) {
    throw new Error(`CSV missing expected columns. Header was: [${table.header.join(", ")}]`);
  }
  // We need to override: the left-side "Item" is at COL_LEFT_ITEM=1, not
  // the first "Item" we find (the right-side "Item" at column 10 would
  // win findColumns's first-match). Use the explicit left columns
  // instead.
  void detected;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new Client({ connectionString: url });
  await client.connect();

  const ingByName = options.dryRun
    ? loadIngredientNamesFromCsvs()
    : await loadIngredientCodesByName(client);

  let updated = 0;
  let skipped = 0;
  let missing = 0;
  let suspects = 0;
  const updates: { id: string; averageCost: number; rawName: string; previous: number }[] = [];
  const suspectNotes: string[] = [];
  const skipNotes: string[] = [];
  const missingNotes: string[] = [];

  for (const row of table.rows) {
    const rawName = (row[COL_LEFT_ITEM] ?? "").trim();
    if (!rawName) continue;
    // Skip header row + title row + section markers.
    if (rawName.toLowerCase() === "item") continue;
    if (rawName.toLowerCase().startsWith("harga invoice")) continue;
    if (!/^\d+$/.test((row[COL_LEFT_NO] ?? "").trim())) continue;
    const csvUnit = (row[COL_LEFT_UNIT] ?? "").trim().toLowerCase();
    let perUnit = parseIdrPerUnit(row[COL_LEFT_PER_UNIT] ?? "");
    if (!perUnit) continue;
    const canonical = canonicalName(rawName);
    if (canonical === null) {
      skipNotes.push(`skip ${rawName} (operational)`);
      skipped++;
      continue;
    }
    const ing = ingByName.get(canonical.toLowerCase());
    if (!ing) {
      missingNotes.push(`skip ${rawName} (no ingredient "${canonical}" in DB)`);
      missing++;
      continue;
    }

    // The CSV's "Satuan" is the unit its price is quoted in. Writing it straight
    // into `average_cost` is only correct when it is the *stock* unit — a price
    // per purchase unit would otherwise become a price per gram/ml/pcs, which is
    // how a whole day of HPP gets mispriced.
    const resolved = resolveQuotedCost(perUnit, csvUnit, {
      stockUnit: ing.stockUnit,
      purchaseUnit: ing.purchaseUnit,
      conversionFactor: ing.conversionFactor,
    });
    if (!resolved.ok) {
      skipNotes.push(
        `skip ${rawName} (satuan CSV "${csvUnit}" bukan satuan stok "${ing.stockUnit}")`,
      );
      skipped++;
      continue;
    }
    perUnit = resolved.costPerStockUnit;

    if (ing.averageCost === perUnit && perUnit > 0) {
      continue;
    }

    const assessment = assessCostChange(ing.averageCost, perUnit);
    if (needsCostConfirmation(assessment.verdict)) {
      const ratioLabel =
        assessment.ratio === null ? "tanpa harga lama" : `${assessment.ratio.toFixed(2)}x`;
      suspectNotes.push(
        `${rawName}: ${ing.averageCost} -> ${perUnit} /${ing.stockUnit} (${ratioLabel})`,
      );
      suspects++;
      if (!options.applySuspect) continue;
    }

    updates.push({ id: ing.id, averageCost: perUnit, rawName, previous: ing.averageCost });
    updated++;
  }

  const suspectHeader = `  ! ${suspects} baris mencurigakan (perubahan >5x atau satuan tidak cocok)`;
  const suspectLines = suspectNotes.map((n) => `  ! ${n}`);
  const applyNote = options.applySuspect
    ? ""
    : "  ! baris di atas DILEWATI; jalankan dengan --apply-suspect untuk menulisnya";

  if (options.dryRun) {
    console.log(
      `[harga-invoice] dry-run: would update ${updated} ingredients (skipped ${skipped}, missing ${missing})`,
    );
    for (const u of updates) console.log(`  ~ ${u.rawName} → ${u.averageCost}`);
    if (suspects > 0) {
      console.log(suspectHeader);
      for (const line of suspectLines) console.log(line);
      if (applyNote) console.log(applyNote);
    }
    for (const s of skipNotes) console.log(`  - ${s}`);
    for (const m of missingNotes) console.log(`  ? ${m}`);
    await client.end();
    return;
  }

  try {
    await client.query("BEGIN");
    const db = drizzle(client, { schema });
    for (const u of updates) {
      await db
        .update(schema.ingredients)
        .set({ averageCost: u.averageCost })
        .where(eq(schema.ingredients.id, u.id));
    }

    // Reprice the menus that use any touched ingredient, the way the UI path does
    // (`recalculateRecipeCostsForIngredient`). Without it `recipes.total_cogs`
    // keeps the old cost, and the next report is wrong in a new way.
    if (updates.length > 0) {
      await client.query(
        `UPDATE recipes r
            SET total_cogs = sub.total
           FROM (
             SELECT ri.recipe_id,
                    round(sum(i.average_cost * ri.quantity))::int AS total
               FROM recipe_ingredients ri
               JOIN ingredients i ON i.id = ri.ingredient_id
              GROUP BY ri.recipe_id
           ) sub
          WHERE r.id = sub.recipe_id
            AND r.id IN (
              SELECT DISTINCT recipe_id FROM recipe_ingredients WHERE ingredient_id = ANY($1::uuid[])
            )`,
        [updates.map((u) => u.id)],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }

  console.log(
    `[harga-invoice] updated ${updated} ingredients (skipped ${skipped}, missing ${missing})`,
  );
  if (suspects > 0) {
    console.log(suspectHeader);
    for (const line of suspectLines) console.log(line);
    if (applyNote) console.log(applyNote);
  }
  for (const m of missingNotes) console.log(`  ? ${m}`);
}
