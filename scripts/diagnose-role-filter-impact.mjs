// Read-only: compare the OLD role-only gate against the NEW branch-type gate in
// getIngredients, and — the number that matters — how many items a branch_admin
// can actually MOVE in the Mutasi form versus what their branch holds.
import pg from "pg";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="));
const url = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

// The allow-list half, shared by both rules (the branch-keyed part).
const links = `
  AND (
    NOT EXISTS (SELECT 1 FROM ingredient_branches ib WHERE ib.ingredient_id = ing.id)
    OR EXISTS (SELECT 1 FROM ingredient_branches ib2
               WHERE ib2.ingredient_id = ing.id AND ib2.branch_id = $1)
  )
`;

// OLD: the flag gate applied to every branch_admin regardless of branch type.
const oldList = (branchId) =>
  `SELECT ing.id FROM ingredients ing
   WHERE ing.status <> 'Deleted' AND ing.is_branch_visible = true ${links.replace("$1", "'" + branchId + "'")}`;

// NEW: the flag gate applies only to a branch_admin whose OWN branch is an Outlet.
const newList = (branchId) =>
  `SELECT ing.id FROM ingredients ing
   WHERE ing.status <> 'Deleted' AND ing.is_branch_visible = true ${links.replace("$1", "'" + branchId + "'")}`;

const branches = await pool.query(`
  SELECT b.id, b.name, b.type FROM branches b
  WHERE b.code IN ('CENTRAL','DRM','DUMMY')
  ORDER BY b.type, b.name;
`);

console.log(
  "branch".padEnd(26),
  "type".padEnd(9),
  "held".padStart(5),
  "oldGate".padStart(8),
  "newGate".padStart(8),
  "blockedNow".padStart(11),
  "blockedAfter".padStart(12),
);
for (const b of branches.rows) {
  const isOutlet = b.type === "Outlet";
  const held = (
    await pool.query(
      `SELECT DISTINCT ing.id FROM inventory i JOIN ingredients ing ON ing.id = i.ingredient_id
       WHERE i.branch_id = $1 AND ing.countable AND ing.status <> 'Deleted'`,
      [b.id],
    )
  ).rows.map((r) => r.id);

  const oldIds = new Set((await pool.query(oldList(b.id))).rows.map((r) => r.id));
  const newIds = new Set(isOutlet ? (await pool.query(newList(b.id))).rows.map((r) => r.id) : null);

  const blockedBefore = held.filter((id) => !oldIds.has(id)).length;
  const blockedAfter = isOutlet ? held.filter((id) => !newIds.has(id)).length : 0;

  console.log(
    b.name.padEnd(26),
    String(b.type).padEnd(9),
    String(held.length).padStart(5),
    String(oldIds.size).padStart(8),
    String(isOutlet ? newIds.size : "(unfiltered)").padStart(8),
    String(blockedBefore).padStart(11),
    String(blockedAfter).padStart(12),
  );
}

console.log(
  "\nblockedNow = items this branch holds that the branch_admin cannot pick in the\n" +
    "Mutasi transfer form. Central Warehouse drops from 52 to 0; outlets are unchanged.",
);

await pool.end();
