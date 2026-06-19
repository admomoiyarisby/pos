// Smoke test for the CSV migrations. Not part of `vp test` — run manually
// with: tsx scripts/migrate-csv/smoke-test.ts
//
// Prints the rows each migration *would* insert, without touching the DB.
// Useful when iterating on parser logic or canonical-name tables.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseCsv, findColumn, findHeader } from "./csv";
import { formatLocation, parseAddress } from "./address";
import { canonicalName, classify, normaliseUnit } from "./normalize";

// ─── 1. Branches ─────────────────────────────────────────────────────────
{
  const CSV = "docs/csv/Detail POS - List Cabang.csv";
  const raw = readFileSync(resolve(process.cwd(), CSV), "utf-8");
  const table = parseCsv(raw);
  const nameCol = findColumn(table.header, "Brand - Outletname");
  const addrCol = findColumn(table.header, "Outlet Location Address");
  const telpCol = findColumn(table.header, "No telp");
  const aduanCol = findColumn(table.header, "No Pengaduan");

  console.log(`\n── branches (${table.rows.length} rows) ──`);
  for (const row of table.rows) {
    const name = (row[nameCol] ?? "").trim();
    const addr = row[addrCol] ?? "";
    const parsed = parseAddress(addr);
    console.log(`  ${name}`);
    console.log(`    location: ${formatLocation(parsed)}`);
    console.log(`    phone:    ${row[telpCol]}`);
    console.log(`    aduan:    ${row[aduanCol]}`);
  }
}

// ─── 2. Ingredients — Central ─────────────────────────────────────────────
{
  const CSV = "docs/csv/Detail POS - List Item Central Kitchen.csv";
  const raw = readFileSync(resolve(process.cwd(), CSV), "utf-8");
  const table = parseCsv(raw);
  const detected = findHeader(table, ["Nama Bahan", "Satuan"]);
  if (!detected) {
    console.log(`\n── ingredients-central: no header found ──`);
  } else {
    const nameCol = detected.indices["nama bahan"]!;
    const unitCol = detected.indices["satuan"]!;
    console.log(`\n── ingredients-central (${detected.data.length} rows) ──`);
    let inserted = 0;
    let skipped = 0;
    for (const row of detected.data) {
      const name = (row[nameCol] ?? "").trim();
      const unit = (row[unitCol] ?? "").trim();
      if (!name) continue;
      const canonical = canonicalName(name);
      if (canonical === null) {
        console.log(`  skip: ${name} (operational)`);
        skipped++;
        continue;
      }
      const cls = classify(canonical);
      console.log(
        `  ${canonical.padEnd(35)} ${cls.category.padEnd(10)} ${cls.skuType.padEnd(3)} ${normaliseUnit(unit)}`,
      );
      inserted++;
    }
    console.log(`  → ${inserted} inserted, ${skipped} skipped`);
  }
}

// ─── 3. Ingredients — Tenant ──────────────────────────────────────────────
{
  const CSV = "docs/csv/Detail POS - List Item Tenant (Cabang).csv";
  const raw = readFileSync(resolve(process.cwd(), CSV), "utf-8");
  const table = parseCsv(raw);
  const detected = findHeader(table, ["Nama Bahan", "Satuan Inventory"]);
  if (!detected) {
    console.log(`\n── ingredients-tenant: no header found ──`);
  } else {
    const nameCol = detected.indices["nama bahan"]!;
    const unitCol = detected.indices["satuan inventory"]!;
    console.log(`\n── ingredients-tenant (${detected.data.length} rows) ──`);
    const seen = new Set<string>();
    let inserted = 0;
    let skipped = 0;
    for (const row of detected.data) {
      const name = (row[nameCol] ?? "").trim();
      const unit = (row[unitCol] ?? "").trim();
      if (!name) continue;
      const canonical = canonicalName(name);
      if (canonical === null) {
        console.log(`  skip: ${name} (operational)`);
        skipped++;
        continue;
      }
      const normKey = canonical.toLowerCase();
      if (seen.has(normKey)) {
        console.log(`  dup:  ${canonical} (already seen)`);
        skipped++;
        continue;
      }
      seen.add(normKey);
      const cls = classify(canonical);
      console.log(
        `  ${canonical.padEnd(35)} ${cls.category.padEnd(10)} ${cls.skuType.padEnd(3)} ${normaliseUnit(unit)}`,
      );
      inserted++;
    }
    console.log(`  → ${inserted} new, ${skipped} skipped`);
  }
}
