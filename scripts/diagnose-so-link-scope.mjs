// Read-only: what would applying the ingredient_branches allow-list to the SO
// scope actually change? Per branch type, how many count-sheet lines are held
// by ingredients whose links do not name that branch.
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
  SELECT b.name AS branch, b.type,
    count(*) FILTER (WHERE ing.countable AND ing.status <> 'Deleted'
                       AND (b.type <> 'Outlet' OR ing.is_branch_visible)) AS so_lines,
    count(*) FILTER (WHERE ing.countable AND ing.status <> 'Deleted'
                       AND (b.type <> 'Outlet' OR ing.is_branch_visible)
                       AND EXISTS (SELECT 1 FROM ingredient_branches ib WHERE ib.ingredient_id = ing.id)
                       AND NOT EXISTS (SELECT 1 FROM ingredient_branches ib2 WHERE ib2.ingredient_id = ing.id AND ib2.branch_id = b.id)) AS removed_by_links
  FROM branches b
  CROSS JOIN ingredients ing
  GROUP BY b.id, b.name, b.type
  HAVING count(*) FILTER (WHERE ing.countable AND ing.status <> 'Deleted'
                            AND (b.type <> 'Outlet' OR ing.is_branch_visible)) > 0
  ORDER BY b.type, b.name;
`);
console.log("branch".padEnd(30), "type".padEnd(9), "soLines".padEnd(8), "removedByLinks");
for (const x of r.rows) {
  console.log(
    `${x.branch} (${x.type})`.padEnd(30),
    String(x.type).padEnd(9),
    String(x.so_lines).padEnd(8),
    String(x.removed_by_links),
  );
}

const links = await pool.query(`
  SELECT ib.branch_id, b.name, b.type, count(*) AS linked_ingredients
  FROM ingredient_branches ib JOIN branches b ON b.id = ib.branch_id
  GROUP BY ib.branch_id, b.name, b.type ORDER BY b.type, b.name;
`);
console.log("\n=== Where do the 53 link rows point? ===");
for (const l of links.rows) {
  console.log(
    `  ${String(l.name).padEnd(30)} ${String(l.type).padEnd(9)} links: ${l.linked_ingredients}`,
  );
}

// Ingredients that are linked ONLY to non-central branches — these would leave
// every central SO if the allow-list were applied to central scopes too.
const centralLoss = await pool.query(`
  SELECT count(DISTINCT ing.id) AS ingredients_lost_from_central
  FROM ingredients ing
  WHERE ing.countable AND ing.status <> 'Deleted'
    AND EXISTS (SELECT 1 FROM ingredient_branches ib WHERE ib.ingredient_id = ing.id)
    AND NOT EXISTS (
      SELECT 1 FROM ingredient_branches ib2
      JOIN branches b2 ON b2.id = ib2.branch_id
      WHERE ib2.ingredient_id = ing.id AND b2.type = 'Central'
    );
`);
console.log(
  "\nIngredients linked only to non-central branches (would leave every central SO):",
  centralLoss.rows[0].ingredients_lost_from_central,
);

await pool.end();
