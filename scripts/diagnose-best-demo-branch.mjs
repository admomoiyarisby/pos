// Read-only: which branch gives the clearest demo of the "di luar katalog"
// marker, i.e. the most held-outside-catalog lines on a new opname?
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
  SELECT b.id, b.code, b.name, count(*) AS marked
  FROM branches b
  CROSS JOIN ingredients ing
  WHERE b.type = 'Outlet'
    AND NOT ing.is_branch_visible
    AND ing.countable
    AND ing.status <> 'Deleted'
    AND EXISTS (SELECT 1 FROM inventory i WHERE i.ingredient_id = ing.id AND i.branch_id = b.id)
  GROUP BY b.id, b.code, b.name
  HAVING count(*) > 0
  ORDER BY marked DESC, b.name;
`);

console.log("=== branches with the most held-out-of-catalog lines (best demo) ===");
for (const x of r.rows) {
  console.log(
    `  ${x.code.padEnd(8)} ${x.name.padEnd(26)} ${x.marked} marked line(s)   branch id: ${x.id}`,
  );
}

const items = await pool.query(`
  SELECT ing.code, ing.name,
         (SELECT sum(i.quantity) FROM inventory i WHERE i.ingredient_id = ing.id) AS total_qty
  FROM ingredients ing
  WHERE NOT ing.is_branch_visible AND ing.countable AND ing.status <> 'Deleted'
    AND EXISTS (SELECT 1 FROM inventory i JOIN branches b ON b.id = i.branch_id WHERE i.ingredient_id = ing.id AND b.type = 'Outlet')
  ORDER BY ing.name;
`);
console.log("\n=== the four ingredients, and where they are held ===");
for (const i of items.rows) {
  const where = await pool.query(
    `SELECT b.name, i.quantity FROM inventory i JOIN branches b ON b.id = i.branch_id
     WHERE i.ingredient_id = (SELECT id FROM ingredients WHERE code = $1) AND b.type = 'Outlet'`,
    [i.code],
  );
  console.log(
    `  ${i.code.padEnd(12)} ${String(i.name).padEnd(30)} ${where.rows.map((w) => `${w.name} (${w.quantity})`).join(", ")}`,
  );
}

await pool.end();
