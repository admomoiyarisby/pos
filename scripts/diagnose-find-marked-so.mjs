// Read-only: find an existing outlet stock opname whose lines include an
// ingredient currently flagged out of the branch catalog. Those are exactly the
// lines that get the "di luar katalog" marker on the detail page.
//
// The marker is computed from the CURRENT flag, so it shows on any old SO whose
// ingredient was flagged TRUE at trigger time and FALSE afterwards.
import pg from "pg";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="));
const url = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const r = await pool.query(`
  SELECT
    so.id AS so_id,
    b.name AS branch,
    b.type AS branch_type,
    so.date,
    so.status,
    so.created_at,
    count(si.id) AS total_lines,
    count(si.id) FILTER (WHERE NOT ing.is_branch_visible) AS marked_lines
  FROM stock_opnames so
  JOIN branches b ON b.id = so.branch_id
  JOIN stock_opname_items si ON si.stock_opname_id = so.id
  JOIN ingredients ing ON ing.id = si.ingredient_id
  WHERE so.deleted_at IS NULL
    AND b.type = 'Outlet'
  GROUP BY so.id, b.name, b.type, so.date, so.status, so.created_at
  HAVING count(si.id) FILTER (WHERE NOT ing.is_branch_visible) > 0
  ORDER BY so.created_at DESC;
`);

console.log(`=== outlet opnames with lines outside the branch catalog: ${r.rows.length} ===`);
for (const x of r.rows) {
  console.log(
    `  ${x.so_id}  ${x.branch.padEnd(26)} ${String(x.date).slice(0, 10).padEnd(12)} ${x.status.padEnd(12)} lines ${String(x.total_lines).padStart(3)}  marked ${x.marked_lines}`,
  );
}

if (r.rows.length > 0) {
  const top = r.rows[0];
  const detail = await pool.query(
    `
    SELECT ing.code, ing.name, si.system_stock, ing.is_branch_visible
    FROM stock_opname_items si
    JOIN ingredients ing ON ing.id = si.ingredient_id
    WHERE si.stock_opname_id = $1 AND NOT ing.is_branch_visible
    ORDER BY ing.name;
    `,
    [top.so_id],
  );
  console.log(`\n=== the marked lines in ${top.so_id} (${top.branch}) ===`);
  for (const d of detail.rows) {
    console.log(
      `  ${String(d.code).padEnd(12)} ${String(d.name).padEnd(32)} system stock ${d.system_stock}`,
    );
  }
}

// How many opnames exist in total, for context.
const all = await pool.query(`
  SELECT count(*) AS total,
         count(*) FILTER (WHERE b.type = 'Outlet') AS outlet_opnames
  FROM stock_opnames so JOIN branches b ON b.id = so.branch_id
  WHERE so.deleted_at IS NULL;
`);
console.log(`\n total opnames: ${all.rows[0].total}  (at outlets: ${all.rows[0].outlet_opnames})`);

await pool.end();
