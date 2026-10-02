// Read-only diagnostic: why does CA review show "Stok Pusat 0 (habis)" for
// every item? Checks (1) how many branches have type 'Central' — the query
// and the ship-time check both do `.limit(1)`, (2) what the first Central is,
// (3) inventory rows at each Central for a sample procurement's ingredients.
import "dotenv/config";
import { readFileSync } from "node:fs";
import pg from "pg";

function loadEnvLocal() {
  try {
    const env = readFileSync(".env.local", "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnvLocal();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("No DATABASE_URL");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

// 1. All Central-type branches
const centrals = await client.query(
  `SELECT id, code, name, created_at FROM branches WHERE type = 'Central' ORDER BY created_at`,
);
console.log(`\n=== Branches of type 'Central': ${centrals.rows.length} ===`);
for (const b of centrals.rows) {
  console.log(
    `  ${b.id}  code=${b.code}  name=${b.name}  created=${b.created_at?.toISOString?.()}`,
  );
}

// 2. The most recent procurement in UnderReview (what the screenshot shows)
const proc = await client.query(
  `SELECT id, code, branch_id, status, created_at
   FROM scm_procurements
   ORDER BY created_at DESC
   LIMIT 5`,
);
console.log(`\n=== Recent procurements ===`);
for (const p of proc.rows) {
  console.log(`  ${p.code}  status=${p.status}  created=${p.created_at?.toISOString?.()}`);
}
const latest = proc.rows.find((p) => p.status === "UnderReview") ?? proc.rows[0];
if (!latest) {
  console.log("No procurements found.");
  await client.end();
  process.exit(0);
}
console.log(`\nInspecting: ${latest.code} (${latest.id})`);

// 3. Its items
const items = await client.query(
  `SELECT i.ingredient_id, g.name AS ingredient_name
   FROM scm_procurement_items i
   JOIN ingredients g ON g.id = i.ingredient_id
   WHERE i.scm_procurement_id = $1`,
  [latest.id],
);
console.log(`Items: ${items.rows.length}`);

// 4. Inventory at EVERY Central branch for these ingredients + total branch count
const invByCentral = {};
for (const c of centrals.rows) {
  const inv = await client.query(
    `SELECT ingredient_id, quantity FROM inventory WHERE branch_id = $1`,
    [c.id],
  );
  invByCentral[c.id] = new Map(inv.rows.map((r) => [r.ingredient_id, Number(r.quantity)]));
  const anyInv = await client.query(
    `SELECT count(*)::int AS n FROM inventory WHERE branch_id = $1`,
    [c.id],
  );
  console.log(`\nCentral ${c.code} (${c.name}): total inventory rows = ${anyInv.rows[0].n}`);
}

console.log(`\n=== Per-item stock at each Central branch ===`);
for (const it of items.rows) {
  const parts = centrals.rows.map((c) => {
    const q = invByCentral[c.id].get(it.ingredient_id);
    return `${c.code}=${q ?? "NO ROW"}`;
  });
  console.log(`  ${it.ingredient_name.padEnd(28)} ${parts.join("  ")}`);
}

// 5. Sanity: branches table types in use
const types = await client.query(
  `SELECT type, count(*)::int AS n FROM branches GROUP BY type ORDER BY type`,
);
console.log(`\n=== Branch types ===`);
for (const t of types.rows) console.log(`  ${t.type}: ${t.n}`);

await client.end();
