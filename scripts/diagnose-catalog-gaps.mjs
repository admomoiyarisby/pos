// Read-only: run getBranchCatalogGapsCore's exact query against the live
// database, to confirm it returns the known gap set and the aggregates agree.
import pg from "pg";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="));
const url = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const { rows: gapRows } = await pool.query(`
  SELECT
    ing.code,
    ing.name,
    count(distinct b.id)::int AS outlet_count,
    string_agg(distinct b.name, ', ') AS outlets,
    sum(i.quantity) AS total_quantity
  FROM ingredients ing
  JOIN inventory i ON i.ingredient_id = ing.id
  JOIN branches b ON b.id = i.branch_id
  WHERE ing.is_branch_visible = false
    AND ing.countable
    AND ing.status <> 'Deleted'
    AND b.type = 'Outlet'
  GROUP BY ing.id, ing.code, ing.name, ing.category
  ORDER BY count(distinct b.id) DESC, ing.name;
`);

console.log(`=== catalog gaps: ${gapRows.length} items held at outlets but flagged FALSE ===`);
for (const r of gapRows) {
  console.log(
    `  ${String(r.name).padEnd(34)} ${String(r.code).padEnd(14)} outlets: ${String(r.outlet_count).padStart(2)}  qty: ${r.total_quantity}`,
  );
  console.log(`      → ${r.outlets}`);
}

await pool.end();
