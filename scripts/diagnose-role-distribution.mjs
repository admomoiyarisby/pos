// Read-only: role distribution and whether any account has no branch at all
// (management roles see every ingredient, so they are unaffected by the
// role-based flag filter in getIngredients).
import pg from "pg";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="));
const url = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const roles = await pool.query(`
  SELECT u.role,
         count(*) AS users,
         count(*) FILTER (WHERE b.id IS NULL) AS no_branch,
         string_agg(DISTINCT coalesce(b.name, '(none)'), ', ') AS branches
  FROM users u
  LEFT JOIN branches b ON b.id = u.branch_id
  WHERE u.deleted_at IS NULL
  GROUP BY u.role
  ORDER BY users DESC;
`);
console.log("role".padEnd(20), "users".padStart(6), "noBranch".padStart(9));
for (const r of roles.rows) {
  console.log(
    String(r.role).padEnd(20),
    String(r.users).padStart(6),
    String(r.no_branch).padStart(9),
    r.users <= 2 ? `  ${r.branches}` : "",
  );
}

// Which roles can reach the Mutasi form (the one that blocks Eva)?
console.log(
  "\nMutasi form RoleGuard: [super_admin, branch_admin] -> only those two roles use\ngetIngredients for picking stock to move.",
);

await pool.end();
