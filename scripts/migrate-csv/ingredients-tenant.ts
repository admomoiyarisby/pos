/**
 * Ingredients migration — Tenant (Cabang) list.
 *
 * Reads `docs/csv/Detail POS - List Item Tenant (Cabang).csv` and inserts
 * rows into `ingredients`. Items already inserted by
 * `ingredients-central` (matched by canonical name) are skipped — the
 * `ingredients` table is the union of both CSVs, deduped by name.
 *
 * New codes pick up where central left off (ING-NNN sequential). This
 * migration depends on `ingredients-central` having run first; the
 * orchestrator enforces order. Running this in isolation without
 * `ingredients-central` first is fine (all rows would be "new"), but
 * re-running it on an already-populated DB is a no-op for the
 * already-inserted rows.
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

const CSV_PATH = resolve(process.cwd(), "docs/csv/Detail POS - List Item Tenant (Cabang).csv");

type IngredientInsert = typeof schema.ingredients.$inferInsert;

async function loadExistingCodesByName(client: Client): Promise<Map<string, string>> {
  const result = await client.query<{ name: string; code: string }>(
    `SELECT name, code FROM ingredients`,
  );
  const m = new Map<string, string>();
  for (const r of result.rows) m.set(r.name.toLowerCase(), r.code);
  return m;
}

async function nextCodeSeq(client: Client): Promise<number> {
  const result = await client.query<{ code: string }>(
    `SELECT code FROM ingredients WHERE code ~ '^ING-[0-9]+$' ORDER BY code DESC LIMIT 1`,
  );
  if (result.rows.length === 0) return 0;
  const n = parseInt(result.rows[0]!.code.replace("ING-", ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export type IngredientsTenantOptions = { dryRun?: boolean };

export async function migrateIngredientsTenant(
  options: IngredientsTenantOptions = {},
): Promise<void> {
  const raw = readFileSync(CSV_PATH, "utf-8");
  const table = parseCsv(raw);

  const detected = findHeader(table, ["Nama Bahan", "Satuan Inventory"]);
  if (!detected) {
    throw new Error(`CSV missing expected columns. Header was: [${table.header.join(", ")}]`);
  }
  const nameCol = detected.indices["nama bahan"]!;
  const unitCol = detected.indices["satuan inventory"]!;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new Client({ connectionString: url });
  await client.connect();

  const existing = options.dryRun
    ? new Map<string, string>()
    : await loadExistingCodesByName(client);
  let seq = options.dryRun ? 0 : await nextCodeSeq(client);

  const rows: IngredientInsert[] = [];
  const skipped: { raw: string; reason: string }[] = [];

  for (const row of detected.data) {
    const name = (row[nameCol] ?? "").trim();
    const unit = (row[unitCol] ?? "").trim();
    if (!name) continue;

    const canonical = canonicalName(name);
    if (canonical === null) {
      skipped.push({ raw: name, reason: "non-ingredient (operational)" });
      continue;
    }

    const normKey = canonical.toLowerCase();
    if (existing.has(normKey)) {
      skipped.push({ raw: name, reason: `dup of ${existing.get(normKey)} (${canonical})` });
      continue;
    }

    const cls = classify(canonical);
    const stockUnit = normaliseUnit(unit);
    seq += 1;
    const code = `ING-${String(seq).padStart(3, "0")}`;

    rows.push({
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
    });
    existing.set(normKey, code);
  }

  if (options.dryRun) {
    console.log(
      `[ingredients-tenant] dry-run: would insert ${rows.length} rows ` +
        `(${skipped.length} skipped)`,
    );
    for (const r of rows)
      console.log(`  + ${r.code}  ${r.name}  ${r.category}/${r.skuType}  ${r.stockUnit}`);
    for (const s of skipped) console.log(`  - ${s.raw} (${s.reason})`);
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
    `[ingredients-tenant] inserted ${rows.length} rows ` +
      `(${skipped.length} skipped as duplicates of central)`,
  );
  for (const r of rows)
    console.log(`  + ${r.code}  ${r.name}  ${r.category}/${r.skuType}  ${r.stockUnit}`);
  for (const s of skipped) console.log(`  - ${s.raw} (${s.reason})`);
}
