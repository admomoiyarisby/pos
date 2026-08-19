/**
 * Branches migration: imports `docs/csv/Detail POS - List Cabang.csv`
 * into the `branches` table.
 *
 * Strategy: TRUNCATE + INSERT in a single transaction. The CSV is a
 * one-time starter snapshot (it won't be edited post-migration), so we
 * don't need upsert complexity. CENTRAL is re-inserted as a structural
 * fixture — every other table that references a branch (users,
 * inventory, scm_procurements, ...) needs at least one Central row to
 * function.
 *
 * CSV → schema mapping:
 *   "*Brand - Outletname"     → name
 *   "Outlet Location Address" → location (street + kelurahan + kecamatan + kota)
 *   "No telp"                 → phone          (ADR 0005)
 *   "No Pengaduan"            → complaintPhone (ADR 0005)
 *
 * Code/protoId: hard-coded `BRANCH_CODE_MAP` because the CSV is frozen.
 * Adding a new outlet means editing this map (or extending a future
 * migration) — see ADR 0005.
 */

import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import * as schema from "../../src/db/schema";
import { lookupLabel } from "../../src/lib/label-lookup";
import { parseCsv, findColumn } from "./csv";
import { formatLocation, parseAddress } from "./address";

config({ path: [".env.local", ".env"] });

const CSV_PATH = resolve(process.cwd(), "docs/csv/Detail POS - List Cabang.csv");

type BranchInsert = typeof schema.branches.$inferInsert;

const CENTRAL_FIXTURE: BranchInsert = {
  code: "CENTRAL",
  name: "Central Warehouse",
  location: "Pusat",
  type: "Central",
  active: true,
  isOnline: true,
  pb1Rate: 11,
  phone: null,
  complaintPhone: null,
};

/**
 * Frozen mapping from CSV outlet name → 3-letter code prefix.
 * The CSV is a one-time starter dataset; if new outlets arrive they go
 * through a future migration that extends this map (or replaces it).
 */
const BRANCH_CODE_MAP = {
  "Omoiyari Wiyung": "WYG",
  "Omoiyari Darmo Permai": "DRM",
  "Omoiyari Tenggilis": "TGL",
  "Omoiyari Mulyorejo": "MLY",
  "Omoiyari Jambangan": "JMB",
  "Omoiyari Pucang": "PCG",
  "Omoiyari Siwalankerto": "SWL",
} satisfies Record<string, string>;

function rowFromCsv(
  idx: number,
  name: string,
  address: string,
  phone: string,
  complaintPhone: string,
): BranchInsert {
  const prefix = lookupLabel(BRANCH_CODE_MAP, name);
  if (!prefix) {
    throw new Error(
      `Row ${idx + 2}: no code mapping for "${name}". ` +
        `Add it to BRANCH_CODE_MAP in scripts/migrate-csv/branches.ts.`,
    );
  }

  const location = formatLocation(parseAddress(address));

  return {
    code: `${prefix}-01`,
    name,
    location,
    type: "Outlet",
    active: true,
    isOnline: true,
    pb1Rate: 11,
    phone: phone || null,
    complaintPhone: complaintPhone || null,
  };
}

export type BranchesMigrationOptions = {
  /** Parse CSV and print rows without touching the database. */
  dryRun?: boolean;
};

export async function migrateBranches(options: BranchesMigrationOptions = {}): Promise<void> {
  const raw = readFileSync(CSV_PATH, "utf-8");
  const table = parseCsv(raw);

  const nameCol = findColumn(table.header, "Brand - Outletname");
  const addrCol = findColumn(table.header, "Outlet Location Address");
  const telpCol = findColumn(table.header, "No telp");
  const aduanCol = findColumn(table.header, "No Pengaduan");

  if (nameCol < 0 || addrCol < 0 || telpCol < 0 || aduanCol < 0) {
    throw new Error(`CSV missing expected columns. Header was: [${table.header.join(", ")}]`);
  }

  const csvBranches: BranchInsert[] = table.rows.map((row, idx) => {
    const name = (row[nameCol] ?? "").trim();
    if (!name) throw new Error(`Row ${idx + 2}: empty outlet name`);
    return rowFromCsv(
      idx,
      name,
      row[addrCol] ?? "",
      (row[telpCol] ?? "").trim(),
      (row[aduanCol] ?? "").trim(),
    );
  });

  const allBranches: BranchInsert[] = [CENTRAL_FIXTURE, ...csvBranches];

  if (options.dryRun) {
    console.log(
      `[branches] dry-run: would insert ${allBranches.length} rows ` +
        `(1 CENTRAL fixture + ${csvBranches.length} from CSV)`,
    );
    for (const b of allBranches) {
      console.log(`  - ${b.code}  ${b.name}  ${b.location}`);
    }
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query('TRUNCATE TABLE "branches" CASCADE');
    const db = drizzle(client, { schema });
    await db.insert(schema.branches).values(allBranches);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }

  console.log(
    `[branches] inserted ${allBranches.length} rows ` +
      `(1 CENTRAL fixture + ${csvBranches.length} from CSV)`,
  );
  for (const b of allBranches) {
    console.log(`  - ${b.code}  ${b.name}  ${b.location}`);
  }
}
