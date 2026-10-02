// One-off read-only diagnostic: why does a triggered SO only carry ~35 items?
//
// Reproduces the exact WHERE clause of triggerStockOpnameCore (inventory.ts)
// per branch and shows how many ingredients each filter drops, so the "35
// items" can be attributed to a specific cause:
//   A. no inventory row at the branch (never stocked there)
//   B. countable = false
//   C. status = 'Deleted'
//   D. isBranchVisible = false (outlet catalog) — outlet branches only
//
// READ-ONLY: only SELECT queries run against DATABASE_URL from .env.local.
import pg from "pg";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL=") && !l.trim().startsWith("#"));
if (!line) throw new Error("No active DATABASE_URL in .env.local");
const url = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
console.log(
  `Connecting to ${new URL(url).host}/${new URL(url).pathname.replace(/^\//, "")} (read-only)\n`,
);

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

// 1. Branch overview: SO-relevant item counts per branch.
const overview = await pool.query(`
  SELECT
    b.id,
    b.code,
    b.name,
    b.type,
    count(i.id) FILTER (WHERE i.id IS NOT NULL) AS inventory_rows,
    count(i.id) FILTER (WHERE i.id IS NOT NULL AND ing.countable AND ing.status <> 'Deleted') AS after_countable_and_not_deleted,
    count(i.id) FILTER (WHERE i.id IS NOT NULL AND ing.countable AND ing.status <> 'Deleted'
                        AND (b.type <> 'Outlet' OR ing.is_branch_visible)) AS so_item_total
  FROM branches b
  LEFT JOIN inventory i ON i.branch_id = b.id
  LEFT JOIN ingredients ing ON ing.id = i.ingredient_id
  GROUP BY b.id, b.code, b.name, b.type
  ORDER BY b.type, b.name;
`);

console.log("=== SO item counts per branch (the trigger's exact filters) ===");
console.log(
  "branch".padEnd(30),
  "type".padEnd(9),
  "invRows".padEnd(9),
  "-noncount/del".padEnd(15),
  "= SO items",
);
for (const r of overview.rows) {
  console.log(
    `${r.name} (${r.code})`.padEnd(30),
    r.type.padEnd(9),
    String(r.inventory_rows).padEnd(9),
    String(r.after_countable_and_not_deleted).padEnd(15),
    String(r.so_item_total),
  );
}

// 2. For outlet branches: which filter eats the items?
const outlets = overview.rows.filter((r) => r.type === "Outlet");
for (const o of outlets) {
  console.log(`\n=== Outlet ${o.name} (${o.code}) — filter breakdown ===`);
  const detail = await pool.query(
    `
    SELECT
      count(*) FILTER (WHERE i.id IS NULL) AS no_inventory_row,
      count(*) FILTER (WHERE i.id IS NOT NULL AND NOT ing.countable) AS non_countable,
      count(*) FILTER (WHERE i.id IS NOT NULL AND ing.status = 'Deleted') AS deleted,
      count(*) FILTER (WHERE i.id IS NOT NULL AND ing.countable AND ing.status <> 'Deleted'
                       AND NOT ing.is_branch_visible) AS not_branch_visible
    FROM ingredients ing
    LEFT JOIN inventory i ON i.branch_id = $1 AND i.ingredient_id = ing.id
    WHERE ing.status <> 'Deleted' OR i.id IS NOT NULL
  `,
    [o.id],
  );
  const d = detail.rows[0];
  console.log(`  dropped: no inventory row here: ${d.no_inventory_row}`);
  console.log(`  dropped: countable=false:      ${d.non_countable}`);
  console.log(`  dropped: status=Deleted:       ${d.deleted}`);
  console.log(
    `  dropped: isBranchVisible=false:${d.not_branch_visible}  <-- outlet catalog filter`,
  );
}

// 3. The catalog gap in master data: stocked at an outlet but not flagged
//    isBranchVisible — the items a triggered SO at that outlet will never count.
const catalogGaps = await pool.query(`
  SELECT b.name AS branch, ing.code, ing.name, i.quantity
  FROM inventory i
  JOIN branches b ON b.id = i.branch_id
  JOIN ingredients ing ON ing.id = i.ingredient_id
  WHERE b.type = 'Outlet'
    AND ing.countable
    AND ing.status <> 'Deleted'
    AND NOT ing.is_branch_visible
  ORDER BY b.name, ing.name
  LIMIT 60;
`);
if (catalogGaps.rows.length > 0) {
  console.log(
    `\n=== Stocked at outlets but NOT in the outlet catalog (invisible to SO trigger) — showing ${catalogGaps.rows.length} ===`,
  );
  for (const r of catalogGaps.rows) {
    console.log(`  ${r.branch.padEnd(24)} ${r.name} (qty ${r.quantity})`);
  }
} else {
  console.log("\nNo catalog gaps: every stocked ingredient at outlets is isBranchVisible.");
}

// 4. What did the most recent SO actually capture, per branch?
const recent = await pool.query(`
  SELECT DISTINCT ON (so.branch_id)
    so.id, b.name AS branch, so.date, so.status, so.created_at,
    (SELECT count(*) FROM stock_opname_items si WHERE si.stock_opname_id = so.id) AS item_count
  FROM stock_opnames so
  JOIN branches b ON b.id = so.branch_id
  WHERE so.deleted_at IS NULL
  ORDER BY so.branch_id, so.created_at DESC;
`);
if (recent.rows.length > 0) {
  console.log("\n=== Most recent SO per branch (actual captured item counts) ===");
  for (const r of recent.rows) {
    console.log(
      `  ${r.branch.padEnd(24)} ${String(r.date).slice(0, 10)} ${r.status.padEnd(20)} items: ${r.item_count}`,
    );
  }
}

await pool.end();
