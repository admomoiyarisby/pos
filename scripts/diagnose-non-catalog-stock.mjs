// Read-only: what movement created a stock record for an item that is flagged
// OUT of the outlet catalog? The stock ledger records every movement, so the
// rows for these ingredient/branch pairs name the cause.
import pg from "pg";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="));
const url = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

// The 4 items the catalog-gap report finds: stocked at an outlet, but flagged
// out of the outlet catalog (is_branch_visible = false).
const items = await pool.query(`
  SELECT ing.id, ing.code, ing.name, ing.is_branch_visible, ing.countable
  FROM ingredients ing
  WHERE ing.code IN ('ING-054', 'ING-074', 'ING-075', 'ING-078')
  ORDER BY ing.code;
`);

console.log("=== the items ===");
for (const i of items.rows) {
  console.log(
    `  ${i.code.padEnd(10)} ${String(i.name).padEnd(32)} isBranchVisible=${i.is_branch_visible} countable=${i.countable}`,
  );
}

for (const i of items.rows) {
  const rows = await pool.query(
    `
    SELECT b.name AS branch, b.type, l.type AS movement, l.quantity, l.balance,
           l.reference, l.notes, l.created_at
    FROM stock_ledger l
    JOIN branches b ON b.id = l.branch_id
    WHERE l.ingredient_id = $1
      AND b.type = 'Outlet'
    ORDER BY b.name, l.created_at
    LIMIT 12;
    `,
    [i.id],
  );
  console.log(`\n=== ${i.code} ${i.name} — ledger rows at Outlets (${rows.rows.length}) ===`);
  for (const r of rows.rows) {
    console.log(
      `  ${String(r.branch).padEnd(24)} ${String(r.movement).padEnd(4)} qty ${String(r.quantity).padStart(8)} bal ${String(r.balance).padStart(8)}  ref=${r.reference ?? "-"}`,
    );
    if (r.notes) console.log(`      notes: ${r.notes}`);
  }
}

// Which movement types are able to create these rows?
const byType = await pool.query(`
  SELECT l.type AS movement, count(*) AS rows
  FROM stock_ledger l
  JOIN ingredients ing ON ing.id = l.ingredient_id
  JOIN branches b ON b.id = l.branch_id
  WHERE b.type = 'Outlet' AND NOT ing.is_branch_visible AND ing.countable
    AND ing.status <> 'Deleted'
  GROUP BY l.type ORDER BY rows DESC;
`);
console.log("\n=== movement types that wrote ledger rows for non-catalog items at Outlets ===");
for (const r of byType.rows) console.log(`  ${String(r.movement).padEnd(28)} ${r.rows}`);

await pool.end();
