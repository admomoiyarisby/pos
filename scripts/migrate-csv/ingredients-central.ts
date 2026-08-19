/**
 * Ingredients migration — Central Kitchen list.
 *
 * Reads `docs/csv/Detail POS - List Item Central Kitchen.csv` and inserts
 * the rows into `ingredients`. Uses the cross-reference layer
 * (`./normalize`) for:
 *   - canonicalising variant names
 *   - classifying category + skuType
 *   - skipping non-ingredient items (operational supplies)
 *
 * Codes are generated sequentially: ING-001, ING-002, ... The starting
 * number is read from the DB so this migration is safe to re-run on a
 * pre-populated ingredients table (e.g., after `ingredients-tenant`
 * has inserted some rows).
 *
 * The orchestrator runs `TRUNCATE ingredients CASCADE` before this
 * migration when invoked via `--only ingredients-central` from a clean
 * state. See `scripts/migrate-csv/index.ts`.
 */

import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import * as schema from "../../src/db/schema";
import { parseCsv, findHeader } from "./csv";
import { canonicalName, classify, normaliseUnit } from "./normalize";

config({ path: [".env.local", ".env"] });

const CSV_PATH = resolve(process.cwd(), "docs/csv/Detail POS - List Item Central Kitchen.csv");

type IngredientInsert = typeof schema.ingredients.$inferInsert;

type Skipped = { raw: string; reason: string };

async function nextCodeSeq(client: Client): Promise<number> {
  // Read max ING-NNN from DB so re-runs continue the sequence.
  const result = await client.query<{ code: string }>(
    `SELECT code FROM ingredients WHERE code ~ '^ING-[0-9]+$' ORDER BY code DESC LIMIT 1`,
  );
  if (result.rows.length === 0) return 0;
  const last = result.rows[0]!.code;
  const n = parseInt(last.replace("ING-", ""), 10);
  return Number.isFinite(n) ? n : 0;
}

type RowFromCsvResult = {
  row: IngredientInsert | null;
  nextSeq: number;
};

function rowFromCsv(name: string, unit: string, codeSeq: number): RowFromCsvResult {
  const canonical = canonicalName(name);
  if (canonical === null) {
    return {
      row: null, // marker for skipped
      nextSeq: codeSeq,
    };
  }

  const cls = classify(canonical);
  const stockUnit = normaliseUnit(unit);
  const code = `ING-${String(codeSeq + 1).padStart(3, "0")}`;

  return {
    row: {
      code,
      name: canonical,
      category: cls.category,
      skuType: cls.skuType,
      purchaseUnit: stockUnit,
      stockUnit,
      conversionFactor: 1,
      averageCost: 0,
      rop: 0,
      roq: 0,
      moq: 1,
      status: "Active",
      countable: true,
    },
    nextSeq: codeSeq + 1,
  };
}

export type IngredientsCentralOptions = { dryRun?: boolean };

export async function migrateIngredientsCentral(
  options: IngredientsCentralOptions = {},
): Promise<void> {
  const raw = readFileSync(CSV_PATH, "utf-8");
  const table = parseCsv(raw);

  // The Central CSV has a title row ("List Item Central Kitchen,,") before
  // the actual header. findHeader scans rows for the real one.
  const detected = findHeader(table, ["Nama Bahan", "Satuan"]);
  if (!detected) {
    throw new Error(`CSV missing expected columns. Header was: [${table.header.join(", ")}]`);
  }
  const nameCol = detected.indices["nama bahan"]!;
  const unitCol = detected.indices["satuan"]!;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new Client({ connectionString: url });
  await client.connect();

  let codeSeq: number;
  if (options.dryRun) {
    codeSeq = 0;
  } else {
    codeSeq = await nextCodeSeq(client);
  }

  const rows: IngredientInsert[] = [];
  const skipped: Skipped[] = [];
  let seq = codeSeq;
  for (const row of detected.data) {
    const name = (row[nameCol] ?? "").trim();
    const unit = (row[unitCol] ?? "").trim();
    if (!name) continue;
    const result = rowFromCsv(name, unit, seq);
    if (result.row == null) {
      skipped.push({ raw: name, reason: "non-ingredient (operational)" });
      continue;
    }
    rows.push(result.row);
    seq = result.nextSeq;
  }

  if (options.dryRun) {
    console.log(
      `[ingredients-central] dry-run: would insert ${rows.length} rows ` +
        `(${skipped.length} skipped as non-ingredient)`,
    );
    for (const r of rows)
      console.log(`  - ${r.code}  ${r.name}  ${r.category}/${r.skuType}  ${r.stockUnit}`);
    for (const s of skipped) console.log(`  - skip: ${s.raw} (${s.reason})`);
    await client.end();
    return;
  }

  try {
    await client.query("BEGIN");
    const db = drizzle(client, { schema });
    if (rows.length > 0) await db.insert(schema.ingredients).values(rows);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }

  console.log(
    `[ingredients-central] inserted ${rows.length} rows ` + `(${skipped.length} skipped)`,
  );
  for (const r of rows)
    console.log(`  - ${r.code}  ${r.name}  ${r.category}/${r.skuType}  ${r.stockUnit}`);
  for (const s of skipped) console.log(`  - skip: ${s.raw} (${s.reason})`);
}
