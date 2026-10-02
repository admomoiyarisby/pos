// Read-only diagnostic for the 2026-10-01 client report:
// "barang pengadaan yg dikirim ke tenan Jambangan malah masuk kembali ke
// warehouse (Central), dan ada yg masuk 2x di item yg sama."
//
// Dumps every recent Pengadaan for the Jambangan branch: items, FSM audit
// events, and ALL stock_ledger rows referencing the procurement (Central IN/OUT
// and Jambangan IN/OUT), flagging duplicate Central IN rows per ingredient.
//
// Usage: node scripts/diagnose-jambangan-procurements.mjs   (read-only)
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
  `SELECT id, code, name, type FROM branches WHERE name ILIKE '%jambangan%' OR code IN ('JBG','JMB')`,
);
console.log("=== Branches ===");
for (const b of branches) console.log(`  ${b.code} ${b.name} type=${b.type} (${b.id})`);
const jbg = branches[0];
if (!jbg) {
  console.error("Jambangan not found");
  process.exit(1);
}

const { rows: procs } = await client.query(
  `SELECT p.id, p.code, p.status, p.created_at, p.shipped_at, p.received_at,
          p.cancelled_at, p.cancellation_reason,
          u.name AS requested_by
   FROM scm_procurements p
   LEFT JOIN users u ON u.id = p.requested_by_id
   WHERE p.branch_id = $1
   ORDER BY p.created_at DESC
   LIMIT 10`,
  [jbg.id],
);

console.log(`\n=== Recent procurements for ${jbg.name}: ${procs.length} ===`);
for (const p of procs) {
  console.log(
    `\n--- ${p.code} [${p.status}] requested by ${p.requested_by ?? "?"} created ${p.created_at?.toISOString?.() ?? p.created_at}`,
  );
  console.log(
    `    shipped=${p.shipped_at?.toISOString?.() ?? "-"} received=${p.received_at?.toISOString?.() ?? "-"} cancelled=${p.cancelled_at?.toISOString?.() ?? "-"} reason=${p.cancellation_reason ?? "-"}`,
  );

  const { rows: items } = await client.query(
    `SELECT i.id, g.name AS ingredient_name, i.quantity, i.picked_quantity,
            i.ready_quantity, i.received_quantity, i.rejected_quantity,
            i.reason, i.ca_decision, i.ba_decision
     FROM scm_procurement_items i
     JOIN ingredients g ON g.id = i.ingredient_id
     WHERE i.scm_procurement_id = $1
     ORDER BY i.sort_order`,
    [p.id],
  );
  for (const i of items) {
    console.log(
      `  item ${i.ingredient_name}: qty=${i.quantity} ready=${i.ready_quantity ?? "-"} picked=${i.picked_quantity ?? "-"} recv=${i.received_quantity ?? "-"} rej=${i.rejected_quantity ?? "-"} ca=${i.ca_decision} ba=${i.ba_decision} reason=${i.reason ?? "-"}`,
    );
  }

  // Audit trail (who did what)
  const { rows: audit } = await client.query(
    `SELECT a.event, a.from_state, a.to_state, a.actor_role, a.timestamp, a.note
     FROM scm_procurement_audit_log a
     WHERE a.scm_procurement_id = $1
     ORDER BY a.timestamp`,
    [p.id],
  );
  for (const a of audit) {
    console.log(
      `    audit: ${a.event} ${a.from_state}→${a.to_state} by ${a.actor_role} at ${a.timestamp?.toISOString?.() ?? a.timestamp}${a.note ? ` — ${a.note}` : ""}`,
    );
  }

  // Every ledger row referencing this procurement, grouped by branch
  const { rows: ledger } = await client.query(
    `SELECT l.branch_id, b.name AS branch_name, b.type AS branch_type,
            l.type, l.quantity, l.balance, l.notes, l.created_at,
            g.name AS ingredient_name
     FROM stock_ledger l
     JOIN branches b ON b.id = l.branch_id
     JOIN ingredients g ON g.id = l.ingredient_id
     WHERE l.reference = $1
     ORDER BY l.created_at`,
    [p.id],
  );
  // Flag duplicate Central INs for the same ingredient
  const centralInByIng = new Map();
  for (const l of ledger) {
    if (l.branch_type === "Central" && l.type === "IN") {
      const key = l.ingredient_name;
      centralInByIng.set(key, (centralInByIng.get(key) ?? 0) + 1);
    }
  }
  for (const l of ledger) {
    const dup =
      l.branch_type === "Central" && l.type === "IN" && centralInByIng.get(l.ingredient_name) > 1
        ? "  ⚠️ DUPLICATE CENTRAL IN"
        : "";
    console.log(
      `    ledger [${l.branch_name}] ${l.type} ${l.quantity} ${l.ingredient_name} (balance=${l.balance}) ${l.created_at?.toISOString?.() ?? l.created_at} — ${l.notes}${dup}`,
    );
  }

  // Pending review rows
  const { rows: pending } = await client.query(
    `SELECT g.name AS ingredient_name, pr.quantity, pr.cleared_at
     FROM pending_review_inventory pr
     JOIN ingredients g ON g.id = pr.ingredient_id
     WHERE pr.scm_procurement_id = $1`,
    [p.id],
  );
  for (const pr of pending) {
    console.log(
      `    pending_review: ${pr.ingredient_name} qty=${pr.quantity} cleared=${pr.cleared_at ? pr.cleared_at.toISOString() : "UNCLEARED"}`,
    );
  }
}

await client.end();
