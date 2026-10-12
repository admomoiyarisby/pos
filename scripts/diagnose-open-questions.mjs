// Read-only: the two open questions, with real data.
//  1. How many ingredients does the `false` default hide from every outlet?
//  2. Does a real user sit in the role-vs-branch-type mismatch?
import pg from "pg";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="));
const url = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const counts = await pool.query(`
  SELECT count(*) FILTER (WHERE is_branch_visible) AS visible,
         count(*) FILTER (WHERE NOT is_branch_visible) AS central_only,
         count(*) AS total
  FROM ingredients WHERE status <> 'Deleted' AND countable;
`);
console.log("=== active, countable ingredients ===");
console.log(`  in the branch catalog (flag TRUE): ${counts.rows[0].visible}`);
console.log(`  central only (flag FALSE):        ${counts.rows[0].central_only}`);
console.log(`  total:                            ${counts.rows[0].total}`);

console.log("\n=== users whose role sees the flag filter, by their branch type ===");
console.log("  (getIngredients filters ONLY role=branch_admin; the opname filters by branch TYPE)");
const users = await pool.query(`
  SELECT u.role, b.type AS branch_type, count(*) AS users, string_agg(DISTINCT b.name, ', ') AS branches
  FROM users u JOIN branches b ON b.id = u.branch_id
  WHERE u.deleted_at IS NULL
  GROUP BY u.role, b.type
  ORDER BY u.role, b.type;
`);
for (const r of users.rows) {
  console.log(
    `  ${String(r.role).padEnd(18)} branch ${String(r.branch_type).padEnd(9)} users: ${String(r.users).padStart(2)}   ${r.branches}`,
  );
}

const mismatch = await pool.query(`
  SELECT u.name, u.email, b.name AS branch, b.type
  FROM users u JOIN branches b ON b.id = u.branch_id
  WHERE u.deleted_at IS NULL AND u.role = 'branch_admin' AND b.type = 'Central';
`);
console.log(`\n=== branch_admin accounts on a CENTRAL-type branch: ${mismatch.rows.length} ===`);
for (const r of mismatch.rows) {
  console.log(`  ${r.name} (${r.email}) at ${r.branch} [${r.type}]`);
}

await pool.end();
