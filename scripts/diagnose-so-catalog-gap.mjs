// Read-only: per branch, catalog size (isBranchVisible + countable + not Deleted)
// vs inventory rows vs SO items actually listed. Shows the "missing items" gap.
//
// `so_items_old` is the pre-fix trigger scope (driven FROM inventory). It is
// what the production count sheets carried. `so_items_new` is the post-fix
// scope (driven FROM ingredients LEFT JOIN inventory) — the catalog, plus the
// quantity when a stock record exists, 0 when it does not.
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
  WITH cat AS (
    -- Branch catalog = ingredients flagged for branches (isBranchVisible),
    -- countable, not tombstoned — whether or not a stock row exists.
    SELECT count(*) FILTER (WHERE is_branch_visible AND countable AND status <> 'Deleted') AS catalog
    FROM ingredients
  ),
  ml AS (SELECT count(*) AS master_total, count(*) FILTER (WHERE is_branch_visible) AS visible_total FROM ingredients WHERE status <> 'Deleted')
  SELECT b.name, b.type, b.code,
    (SELECT master_total FROM ml) AS master,
    (SELECT visible_total FROM ml) AS master_visible,
    (SELECT catalog FROM cat) AS catalog,
    (SELECT count(*) FROM inventory i WHERE i.branch_id = b.id) AS inv_rows,
    (SELECT count(*) FROM inventory i JOIN ingredients ing ON ing.id = i.ingredient_id
      WHERE i.branch_id = b.id AND ing.countable AND ing.status <> 'Deleted'
        AND (b.type <> 'Outlet' OR ing.is_branch_visible)) AS so_items_old,
    (SELECT count(*) FROM ingredients ing
      LEFT JOIN inventory i ON i.ingredient_id = ing.id AND i.branch_id = b.id
      WHERE ing.countable AND ing.status <> 'Deleted'
        AND (b.type <> 'Outlet' OR ing.is_branch_visible)) AS so_items_new,
    (SELECT count(*) FROM stock_opname_items si JOIN stock_opnames so ON so.id = si.stock_opname_id
      WHERE so.branch_id = b.id AND so.deleted_at IS NULL
        AND so.created_at = (SELECT max(s2.created_at) FROM stock_opnames s2 WHERE s2.branch_id = b.id AND s2.deleted_at IS NULL)) AS last_so_items
  FROM branches b
  ORDER BY b.type, b.name;
`);

console.log(
  "branch".padEnd(30),
  "type".padEnd(9),
  "master".padEnd(7),
  "mstrVis".padEnd(8),
  "catalog".padEnd(8),
  "invRows".padEnd(8),
  "oldSO".padEnd(7),
  "newSO",
);
for (const x of r.rows) {
  console.log(
    `${x.name} (${x.code})`.padEnd(30),
    String(x.type).padEnd(9),
    String(x.master).padEnd(7),
    String(x.master_visible).padEnd(8),
    String(x.catalog).padEnd(8),
    String(x.inv_rows).padEnd(8),
    String(x.so_items_old).padEnd(7),
    String(x.so_items_new),
  );
}

// Which catalog items are stocked-in-theory but have no inventory row at each outlet?
// These are the lines the old trigger (FROM inventory) silently dropped. They
// now reach the count sheet at systemStock 0.
const miss = await pool.query(`
  SELECT b.name AS branch, count(*) AS missing_catalog_items
  FROM ingredients ing
  JOIN branches b ON b.type = 'Outlet'
  WHERE ing.is_branch_visible AND ing.countable AND ing.status <> 'Deleted'
    AND NOT EXISTS (SELECT 1 FROM inventory i WHERE i.branch_id = b.id AND i.ingredient_id = ing.id)
  GROUP BY b.name ORDER BY missing_catalog_items DESC;
`);
console.log(
  "\n=== Catalog items with NO stock record — dropped by the old trigger, now counted at 0 ===",
);
for (const m of miss.rows)
  console.log(`  ${m.branch.padEnd(30)} was missing: ${m.missing_catalog_items}`);

await pool.end();
