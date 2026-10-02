// One-off diagnostic for the Jambangan transfer report (2026-09-30):
// "items that should have been transferred to Jambangan were sent back to the
// warehouse." Dump recent JBG Mutasi transfers, their items, the stock_ledger
// rows they wrote (ship OUT, receive IN, reject IN), and pending_review state.
//
// Usage: node scripts/diagnose-jambangan.mjs            (dry-run, read-only)
// Reads DATABASE_URL from .env.local like repair-rejected-stock.mjs.
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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("No DATABASE_URL");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

const { rows: branches } = await client.query(
  `SELECT id, code, name FROM branches WHERE code IN ('JBG','JMB') OR name ILIKE '%jambangan%'`,
);
console.log("=== Branches ===");
for (const b of branches) console.log(`  ${b.code ?? "?"} ${b.name} (${b.id})`);
const jbg = branches[0];
if (!jbg) {
  console.error("Jambangan branch not found");
  await client.end();
  process.exit(1);
}

const { rows: transfers } = await client.query(
  `SELECT t.id, t.code, t.status, t.from_branch_id, fb.name AS from_name,
          t.created_at, t.updated_at
   FROM scm_transfers t
   JOIN branches fb ON fb.id = t.from_branch_id
   WHERE t.to_branch_id = $1
   ORDER BY t.created_at DESC
   LIMIT 15`,
  [jbg.id],
);

console.log(`\n=== Recent inbound transfers to ${jbg.name}: ${transfers.length} ===`);
for (const t of transfers) {
  console.log(
    `\n--- ${t.code} [${t.status}] from ${t.from_name} created ${t.created_at?.toISOString?.() ?? t.created_at}`,
  );
  const { rows: items } = await client.query(
    `SELECT i.id, i.ingredient_id, g.name AS ingredient_name, i.quantity,
            i.received_quantity, i.rejected_quantity, i.rejection_disposition, i.reason
     FROM scm_transfer_items i
     JOIN ingredients g ON g.id = i.ingredient_id
     WHERE i.scm_transfer_id = $1`,
    [t.id],
  );
  for (const i of items) {
    console.log(
      `  item ${i.ingredient_name}: qty=${i.quantity} recv=${i.received_quantity} rej=${i.rejected_quantity} disp=${i.rejection_disposition ?? "-"} reason=${i.reason ?? "-"}`,
    );
  }
  const { rows: ledger } = await client.query(
    `SELECT branch_id, ingredient_id, type, quantity, balance, notes, created_at
     FROM stock_ledger
     WHERE reference = $1
     ORDER BY created_at`,
    [t.id],
  );
  for (const l of ledger) {
    const { rows: br } = await client.query(`SELECT name FROM branches WHERE id = $1`, [
      l.branch_id,
    ]);
    const { rows: ing } = await client.query(`SELECT name FROM ingredients WHERE id = $1`, [
      l.ingredient_id,
    ]);
    console.log(
      `  ledger [${br[0]?.name ?? l.branch_id}] ${l.type} ${l.quantity} ${ing[0]?.name ?? l.ingredient_id} (balance=${l.balance}) — ${l.notes}`,
    );
  }
  const { rows: pending } = await client.query(
    `SELECT ingredient_id, quantity, cleared_at
     FROM pending_review_inventory
     WHERE scm_transfer_id = $1`,
    [t.id],
  );
  for (const p of pending) {
    console.log(
      `  pending_review: qty=${p.quantity} cleared=${p.cleared_at ? p.cleared_at.toISOString() : "UNCLEARED"}`,
    );
  }
}

await client.end();
