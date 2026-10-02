// Read-only diagnostic: why does Data Penjualan show totals but an empty
// table, and why do create/update transactions fail?
// Checks (1) does orders.verified exist in prod, (2) does the exact list
// query run, (3) pending vs applied migrations, (4) orders table columns
// referenced by the code.
import "dotenv/config";
import { readFileSync } from "node:fs";
import pg from "pg";

function loadEnvLocal() {
  try {
    const env = readFileSync(".env.local", "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnvLocal();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// 1. orders columns in prod
const { rows: cols } = await client.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' ORDER BY ordinal_position`,
);
const colNames = cols.map((c) => c.column_name);
console.log("=== orders columns ===");
console.log(colNames.join(", "));

const expected = [
  "verified",
  "verified_at",
  "verified_by_id",
  "void_reason",
  "net_sales",
  "mdr_fee",
  "merchant_discount",
  "platform_discount",
  "total_cogs",
];
console.log("\n=== columns referenced by getSalesData — present? ===");
for (const c of expected) {
  console.log(`  ${c}: ${colNames.includes(c) ? "OK" : "MISSING ❌"}`);
}

// 2. order_items + order_item_modifiers columns
for (const t of ["order_items", "order_item_modifiers"]) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    [t],
  );
  console.log(`\n=== ${t} columns ===`);
  console.log(rows.map((r) => r.column_name).join(", "));
}

// 3. Applied vs local migrations
const { rows: applied } = await client
  .query(`SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 5`)
  .catch(() => ({ rows: [] }));
console.log("\n=== last applied migrations (prod DB) ===");
for (const m of applied ?? []) console.log(`  ${m.hash} @ ${m.created_at?.toISOString?.()}`);

// 4. Try the exact list query getSalesData runs (7-day window, page 0)
try {
  const { rows } = await client.query(
    `SELECT o.id, o.channel, o.order_code, o.verified, count(oi.id) AS item_count
     FROM orders o
     LEFT JOIN order_items oi ON o.id = oi.order_id
     WHERE DATE((o.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= $1
     GROUP BY o.id
     ORDER BY o.created_at DESC
     LIMIT 5`,
    [new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)],
  );
  console.log(`\n=== list query smoke test: OK, ${rows.length} rows ===`);
  for (const r of rows)
    console.log(`  ${r.order_code} ${r.channel} verified=${r.verified} items=${r.item_count}`);
} catch (err) {
  console.error(`\n=== list query smoke test FAILED ===\n${err.message}`);
}

// 5. Recent orders count overall (is data actually there?)
const { rows: cnt } = await client.query(
  `SELECT count(*)::int AS n, max(created_at) AS latest FROM orders`,
);
console.log(`\n=== orders total=${cnt[0].n}, latest=${cnt[0].latest?.toISOString?.()} ===`);

await client.end();
