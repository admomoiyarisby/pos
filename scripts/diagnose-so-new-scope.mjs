// Read-only: what does the NEW outlet scope produce per branch?
// scope = branch catalog (flag + allow-list) UNION everything the branch holds,
// minus the opname-only exclusions (countable, not Deleted).
import pg from "pg";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="));
const url = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const rows = await pool.query(`
  SELECT b.name AS branch,
    count(*) FILTER (WHERE ing.countable AND ing.status <> 'Deleted'
                       AND (ing.is_branch_visible
                            AND (NOT EXISTS (SELECT 1 FROM ingredient_branches ib WHERE ib.ingredient_id = ing.id)
                                 OR EXISTS (SELECT 1 FROM ingredient_branches ib2 WHERE ib2.ingredient_id = ing.id AND ib2.branch_id = b.id)))) AS catalog_lines,
    count(*) FILTER (WHERE ing.countable AND ing.status <> 'Deleted'
                       AND NOT ing.is_branch_visible
                       AND EXISTS (SELECT 1 FROM inventory i WHERE i.ingredient_id = ing.id AND i.branch_id = b.id)) AS held_outside_catalog,
    count(*) FILTER (WHERE ing.countable AND ing.status <> 'Deleted'
                       AND (
                         (ing.is_branch_visible
                          AND (NOT EXISTS (SELECT 1 FROM ingredient_branches ib WHERE ib.ingredient_id = ing.id)
                               OR EXISTS (SELECT 1 FROM ingredient_branches ib2 WHERE ib2.ingredient_id = ing.id AND ib2.branch_id = b.id)))
                         OR (NOT ing.is_branch_visible
                             AND EXISTS (SELECT 1 FROM inventory i WHERE i.ingredient_id = ing.id AND i.branch_id = b.id))
                       )) AS counted_lines
  FROM branches b
  CROSS JOIN ingredients ing
  WHERE b.type = 'Outlet'
  GROUP BY b.id, b.name
  HAVING count(*) FILTER (WHERE ing.countable AND ing.status <> 'Deleted') > 0
  ORDER BY b.name;
`);

console.log("branch".padEnd(26), "catalog", "held-out", "= sheet lines");
let tC = 0;
let tH = 0;
for (const x of rows.rows) {
  const catalog = Number(x.catalog_lines);
  const held = Number(x.held_outside_catalog);
  tC += catalog;
  tH += held;
  console.log(
    x.branch.padEnd(26),
    String(catalog).padStart(7),
    String(held).padStart(8),
    String(Number(x.counted_lines)).padStart(10),
  );
}
console.log("-".repeat(52));
console.log(
  "total".padEnd(26),
  String(tC).padStart(7),
  String(tH).padStart(8),
  String(tC + tH).padStart(10),
);

await pool.end();
