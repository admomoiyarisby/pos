// Read-only: reproduce getIngredientsCore's exact WHERE for a branch_admin at
// the Central Warehouse, and for branch_admins at outlets, so the numbers are
// exact rather than approximate.
import pg from "pg";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="));
const url = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

// getIngredientsCore, for a caller with role=branch_admin and the given branch:
//   status <> 'Deleted'
//   AND is_branch_visible = true                                  <- ROLE gate
//   AND ( NOT EXISTS(links) OR EXISTS(link for this branch) )      <- BRANCH gate
const masterList = (branchId) => `
  SELECT count(*)::int AS n
  FROM ingredients ing
  WHERE ing.status <> 'Deleted'
    AND ing.is_branch_visible = true
    AND (
      NOT EXISTS (SELECT 1 FROM ingredient_branches ib WHERE ib.ingredient_id = ing.id)
      OR EXISTS (SELECT 1 FROM ingredient_branches ib2
                 WHERE ib2.ingredient_id = ing.id AND ib2.branch_id = '${branchId}')
    )
`;

// The opname scope, for a branch of the given type (Outlet or Central).
const opnameList = (branchId, type) => `
  SELECT count(*)::int AS n
  FROM ingredients ing
  WHERE ing.countable
    AND ing.status <> 'Deleted'
    ${
      type === "Outlet"
        ? `AND ( ing.is_branch_visible = true
                 AND (NOT EXISTS (SELECT 1 FROM ingredient_branches ib WHERE ib.ingredient_id = ing.id)
                      OR EXISTS (SELECT 1 FROM ingredient_branches ib2 WHERE ib2.ingredient_id = ing.id AND ib2.branch_id = '${branchId}'))
                 OR EXISTS (SELECT 1 FROM inventory i WHERE i.ingredient_id = ing.id AND i.branch_id = '${branchId}') )`
        : ""
    }
`;

const people = await pool.query(`
  SELECT u.name, u.role, b.id AS branch_id, b.name AS branch, b.type
  FROM users u JOIN branches b ON b.id = u.branch_id
  WHERE u.deleted_at IS NULL
    AND u.role IN ('branch_admin')
  ORDER BY b.type, b.name
  LIMIT 6;
`);

console.log(
  "user".padEnd(20),
  "branch".padEnd(26),
  "type".padEnd(9),
  "master".padStart(7),
  "opname".padStart(7),
);
for (const p of people.rows) {
  const master = (await pool.query(masterList(p.branch_id))).rows[0].n;
  const opname = (await pool.query(opnameList(p.branch_id, p.type))).rows[0].n;
  console.log(
    p.name.padEnd(20),
    p.branch.padEnd(26),
    String(p.type).padEnd(9),
    String(master).padStart(7),
    String(opname).padStart(7),
  );
}

const totals = await pool.query(`
  SELECT count(*) FILTER (WHERE is_branch_visible AND countable AND status <> 'Deleted')::int AS flag_true,
         count(*) FILTER (WHERE countable AND status <> 'Deleted')::int AS all_countable
  FROM ingredients;
`);
console.log(
  `\nwhole master, ignoring the allow-list entirely:\n  flag TRUE:  ${totals.rows[0].flag_true}\n  all countable: ${totals.rows[0].all_countable}`,
);

await pool.end();
