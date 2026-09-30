// Repair script for issue #93 (stranded rejected stock).
//
// Before the 2026-09-29 fix, `finish-receive` wrote a waste_entries row for
// rejected quantities but never returned the stock: fully- and partially-
// rejected lines vanished from every stock position and fully-rejected lines
// left uncleared pending_review_inventory rows behind.
//
// What this script does, per affected line (rejectedQuantity > 0):
//   1. Credits the rejected quantity back to Central's inventory (Pengadaan)
//      or the sender branch's inventory (Mutasi), writing a `Pengadaan Reject
//      … (backfill)` / `Mutasi Reject … (backfill)` IN stock-ledger entry.
//   2. Clears any leftover uncleared pending_review_inventory rows for the
//      document.
//
// Idempotent: a line is skipped when a `… Reject` IN ledger entry already
// exists for (reference, ingredient) — i.e. it was finished after the fix or
// already repaired.
//
// Usage:
//   node scripts/repair-rejected-stock.mjs            # dry-run (default)
//   node scripts/repair-rejected-stock.mjs --apply    # actually write
import "dotenv/config";
import { readFileSync } from "node:fs";
import pg from "pg";

const APPLY = process.argv.includes("--apply");

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

/** Same resolution rule as getCentralWarehouse(): the Central branch with the
 *  most inventory rows, tiebroken by earliest creation, else earliest created. */
async function getCentralWarehouseId() {
  const { rows } = await client.query(`
    SELECT b.id, b.code, b.name,
           (SELECT count(*) FROM inventory WHERE branch_id = b.id) AS inv_rows
    FROM branches b WHERE b.type = 'Central'
  `);
  if (rows.length === 0) return undefined;
  const ranked = [...rows].sort(
    (a, b) => Number(b.inv_rows) - Number(a.inv_rows) || String(a.id).localeCompare(String(b.id)),
  );
  if (Number(ranked[0].inv_rows) > 0) return ranked[0].id;
  const { rows: earliest } = await client.query(
    `SELECT id FROM branches WHERE type = 'Central' ORDER BY created_at, id LIMIT 1`,
  );
  return earliest[0]?.id;
}

// Stranded Pengadaan lines: finished (invoice generated) with rejected > 0 and
// no compensating "Pengadaan Reject" IN ledger entry for that (doc, ingredient).
const strandedPengadaan = await client.query(
  `SELECT p.id, p.code, p.status, i.id AS item_id, i.ingredient_id,
          i.rejected_quantity, g.name AS ingredient_name
   FROM scm_procurements p
   JOIN scm_procurement_items i ON i.scm_procurement_id = p.id
   JOIN ingredients g ON g.id = i.ingredient_id
   WHERE p.status IN ('WaitingForPayment', 'Finished')
     AND COALESCE(i.rejected_quantity, 0) > 0
     AND NOT EXISTS (
       SELECT 1 FROM stock_ledger sl
       WHERE sl.reference = p.id::text AND sl.type = 'IN'
         AND sl.ingredient_id = i.ingredient_id
         AND sl.notes LIKE 'Pengadaan Reject%'
     )`,
);

// Same for Mutasi transfers (rejected stock returns to the sender branch).
const strandedMutasi = await client.query(
  `SELECT t.id, t.code, t.status, t.from_branch_id, i.id AS item_id,
          i.ingredient_id, i.rejected_quantity, g.name AS ingredient_name
   FROM scm_transfers t
   JOIN scm_transfer_items i ON i.scm_transfer_id = t.id
   JOIN ingredients g ON g.id = i.ingredient_id
   WHERE t.status IN ('WaitingForPayment', 'Finished')
     AND COALESCE(i.rejected_quantity, 0) > 0
     AND NOT EXISTS (
       SELECT 1 FROM stock_ledger sl
       WHERE sl.reference = t.id::text AND sl.type = 'IN'
         AND sl.ingredient_id = i.ingredient_id
         AND sl.notes LIKE 'Mutasi Reject%'
     )`,
);

console.log(`\n=== Stranded Pengadaan lines: ${strandedPengadaan.rows.length} ===`);
for (const r of strandedPengadaan.rows) {
  console.log(`  ${r.code} [${r.status}]  ${r.ingredient_name}: ${r.rejected_quantity} → Central`);
}
console.log(`\n=== Stranded Mutasi lines: ${strandedMutasi.rows.length} ===`);
for (const r of strandedMutasi.rows) {
  console.log(`  ${r.code} [${r.status}]  ${r.ingredient_name}: ${r.rejected_quantity} → sender`);
}

if (strandedPengadaan.rows.length === 0 && strandedMutasi.rows.length === 0) {
  console.log("\nNothing to repair.");
  await client.end();
  process.exit(0);
}

if (!APPLY) {
  console.log(
    `\nDRY RUN — nothing written. Re-run with --apply to credit ` +
      `${strandedPengadaan.rows.length} Pengadaan + ${strandedMutasi.rows.length} Mutasi lines.`,
  );
  await client.end();
  process.exit(0);
}

const centralId = await getCentralWarehouseId();
if (!centralId) {
  console.error("No Central branch configured — cannot repair Pengadaan lines.");
  await client.end();
  process.exit(1);
}

async function creditInventory(branchId, ingredientId, quantity, reference, notes) {
  const { rows } = await client.query(
    `UPDATE inventory SET quantity = quantity + $3, last_updated = now()
     WHERE branch_id = $1 AND ingredient_id = $2 RETURNING quantity`,
    [branchId, ingredientId, quantity],
  );
  let balance;
  if (rows.length > 0) {
    balance = Number(rows[0].quantity);
  } else {
    await client.query(
      `INSERT INTO inventory (branch_id, ingredient_id, quantity) VALUES ($1, $2, $3)`,
      [branchId, ingredientId, quantity],
    );
    balance = quantity;
  }
  await client.query(
    `INSERT INTO stock_ledger (branch_id, ingredient_id, type, quantity, balance, reference, notes)
     VALUES ($1, $2, 'IN', $3, $4, $5, $6)`,
    [branchId, ingredientId, quantity, balance, reference, notes],
  );
}

const repairedDocs = new Set();

await client.query("BEGIN");
try {
  for (const r of strandedPengadaan.rows) {
    await creditInventory(
      centralId,
      r.ingredient_id,
      r.rejected_quantity,
      r.id,
      `Pengadaan Reject ${r.code} (backfill)`,
    );
    repairedDocs.add(`P:${r.id}`);
    console.log(`  ✓ Pengadaan ${r.code}: +${r.rejected_quantity} ${r.ingredient_name} → Central`);
  }

  for (const r of strandedMutasi.rows) {
    await creditInventory(
      r.from_branch_id,
      r.ingredient_id,
      r.rejected_quantity,
      r.id,
      `Mutasi Reject ${r.code} (backfill)`,
    );
    repairedDocs.add(`T:${r.id}`);
    console.log(`  ✓ Mutasi ${r.code}: +${r.rejected_quantity} ${r.ingredient_name} → sender`);
  }

  // Clear leftover pending_review rows on every repaired document.
  for (const key of repairedDocs) {
    const [flow, id] = [key.slice(0, 1), key.slice(2)];
    const col = flow === "P" ? "scm_procurement_id" : "scm_transfer_id";
    const { rowCount } = await client.query(
      `UPDATE pending_review_inventory SET cleared_at = now()
       WHERE ${col} = $1 AND cleared_at IS NULL`,
      [id],
    );
    if (rowCount > 0) console.log(`  ✓ cleared ${rowCount} pending_review row(s) for ${key}`);
  }

  await client.query("COMMIT");
  console.log(`\nApplied. Repaired ${repairedDocs.size} document(s).`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("FAILED, rolled back:", err);
  process.exitCode = 1;
}

await client.end();
