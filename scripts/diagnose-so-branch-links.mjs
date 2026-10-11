// Read-only: does ingredient_branches (per-branch allow-list) have rows, and
// would the SO currently show an ingredient a branch admin cannot see?
import pg from "pg";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="));
const url = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const a = await pool.query(`
  SELECT count(*) AS links,
         count(DISTINCT ingredient_id) AS ingredients_linked
  FROM ingredient_branches;
`);
console.log("ingredient_branches rows:", a.rows[0]);

const b = await pool.query(`
  -- SO lines that exist at outlet branches for ingredients NOT visible to that
  -- branch per the ingredient_branches allow-list used by getIngredients.
  SELECT count(*) AS conflicting_lines
  FROM stock_opname_items si
  JOIN stock_opnames so ON so.id = si.stock_opname_id
  JOIN branches b ON b.id = so.branch_id
  JOIN ingredients ing ON ing.id = si.ingredient_id
  WHERE b.type = 'Outlet'
    AND so.deleted_at IS NULL
    AND ing.status <> 'Deleted'
    AND ing.is_branch_visible
    AND EXISTS (SELECT 1 FROM ingredient_branches ib WHERE ib.ingredient_id = ing.id)
    AND NOT EXISTS (SELECT 1 FROM ingredient_branches ib2 WHERE ib2.ingredient_id = ing.id AND ib2.branch_id = b.id);
`);
console.log(
  "SO lines at outlets where the ingredient is link-restricted away from that branch:",
  b.rows[0],
);

await pool.end();
