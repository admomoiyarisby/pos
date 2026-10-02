// Read-only follow-up: for Omoiyari Wiyung's 35-item SO (2026-09-28), test the
// hypothesis that only 35 ingredients had inventory rows at trigger time and
// the remaining 22 received stock afterwards (SCM receive / POS first sale).
import pg from "pg";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL=") && !l.trim().startsWith("#"));
const url = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

// The most recent Wiyung SO
const so = await pool.query(`
  SELECT DISTINCT ON (so.id) so.id, so.date, so.status, so.created_at, b.name
  FROM stock_opnames so JOIN branches b ON b.id = so.branch_id
  WHERE b.code = 'WYG' AND so.deleted_at IS NULL
  ORDER BY so.id, so.created_at DESC
  LIMIT 1;
`);
const s = so.rows[0];
console.log(
  `SO ${s.id.slice(0, 8)} @ ${s.name} — date ${String(s.date).slice(0, 10)}, created ${s.created_at.toISOString()}`,
);

// When did each currently-stocked ingredient first get a ledger entry at this branch?
const rows = await pool.query(
  `
  SELECT ing.name,
         i.quantity AS current_qty,
         (SELECT MIN(sl.created_at) FROM stock_ledger sl
           WHERE sl.branch_id = i.branch_id AND sl.ingredient_id = i.ingredient_id) AS first_movement,
         (SELECT MAX(sl.created_at) FROM stock_ledger sl
           WHERE sl.branch_id = i.branch_id AND sl.ingredient_id = i.ingredient_id) AS last_movement
  FROM inventory i
  JOIN ingredients ing ON ing.id = i.ingredient_id
  WHERE i.branch_id = (SELECT id FROM branches WHERE code = 'WYG')
    AND ing.countable AND ing.status <> 'Deleted'
  ORDER BY first_movement NULLS LAST;
`,
);

const atTrigger = rows.rows.filter((r) => r.first_movement && r.first_movement <= s.created_at);
const afterTrigger = rows.rows.filter((r) => !r.first_movement || r.first_movement > s.created_at);
const neverMoved = afterTrigger.filter((r) => !r.first_movement);

console.log(`\nCurrently stocked (countable, not deleted): ${rows.rows.length}`);
console.log(
  `First stock movement BEFORE the SO trigger: ${atTrigger.length}  <- what the SO captured (±35)`,
);
console.log(
  `First stock movement AFTER the trigger:     ${afterTrigger.length - neverMoved.length}`,
);
console.log(`No ledger movement at all (no ledger row):  ${neverMoved.length}`);

console.log("\nIngredients stocked only AFTER the SO trigger:");
for (const r of afterTrigger.slice(0, 40)) {
  console.log(
    `  ${r.name.padEnd(32)} qty ${String(r.current_qty).padEnd(8)} first movement: ${r.first_movement ? r.first_movement.toISOString() : "(none)"}`,
  );
}

await pool.end();
