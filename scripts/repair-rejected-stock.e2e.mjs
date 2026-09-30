// E2E validation for scripts/repair-rejected-stock.mjs (run against TEST DB only).
// Seeds one stranded Pengadaan + one stranded Mutasi document (pre-fix state),
// runs the script with --apply, and asserts stock was credited back.
import pg from "pg";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test";
if (!connectionString.includes("test")) throw new Error("refusing: not a test database");

const client = new pg.Client({ connectionString });
await client.connect();
const q = (text, params) => client.query(text, params);
const uuid = () => crypto.randomUUID();
// Unique-per-run codes: a prior failed run may have left rows behind.
const run = `RT-${crypto.randomUUID().slice(0, 8)}`;

try {
  // -- Seed -----------------------------------------------------------------
  const central = uuid();
  const sender = uuid();
  const receiver = uuid();
  await q(
    `INSERT INTO branches (id, code, name, location, type) VALUES
       ($1,$4,'ITS warehouse','Test','Central'),
       ($2,$5,'ITS sender','Test','Outlet'),
       ($3,$6,'ITS receiver','Test','Outlet')`,
    [central, sender, receiver, `${run}-WHS`, `${run}-SND`, `${run}-RCV`],
  );
  const ing = uuid();
  await q(
    `INSERT INTO ingredients (id, code, name, category, sku_type, purchase_unit, stock_unit,
       conversion_factor, average_cost)
     VALUES ($1,$2,'Repair test ing','Fresh','RM','pcs','pcs',1,1000)`,
    [ing, `${run}-ING`],
    [ing],
  );
  const [wa, sa, ra, su] = [uuid(), uuid(), uuid(), uuid()];
  await q(
    `INSERT INTO users (id, name, email, role) VALUES
       ($1,'ITS a',$5,'admin_pusat'), ($2,'ITS b',$6,'branch_admin'),
       ($3,'ITS c',$7,'branch_admin'), ($4,'ITS d',$8,'branch_admin')`,
    [
      wa,
      sa,
      ra,
      su,
      `a-${run}@rt.test`,
      `b-${run}@rt.test`,
      `c-${run}@rt.test`,
      `d-${run}@rt.test`,
    ],
  );
  // Central owns 10; sender owns 8.
  await q(
    `INSERT INTO inventory (branch_id, ingredient_id, quantity) VALUES ($1,$2,10), ($3,$2,8)`,
    [central, ing, sender],
  );

  // Stranded Pengadaan: WaitingForPayment, rejected 4, no reject ledger.
  const proc = uuid();
  const procItem = uuid();
  await q(
    `INSERT INTO scm_procurements (id, code, branch_id, status, requested_by_id)
     VALUES ($1,$4,$2,'WaitingForPayment',$3)`,
    [proc, receiver, ra, `${run}/PROC/001`],
    [proc, receiver, ra],
  );
  await q(
    `INSERT INTO scm_procurement_items (id, scm_procurement_id, ingredient_id, quantity,
       ready_quantity, picked_quantity, received_quantity, rejected_quantity, reason,
       ca_decision, unit_price, ba_decision)
     VALUES ($1,$2,$3,10,10,10,6,4,'rusak','approved',1000,'accepted')`,
    [procItem, proc, ing],
  );
  await q(
    `INSERT INTO pending_review_inventory (scm_procurement_id, branch_id, ingredient_id,
       quantity, created_by_id) VALUES ($1,$2,$3,4,$4)`,
    [proc, receiver, ing, wa],
  );

  // Stranded Mutasi: WaitingForPayment, rejected 3, no reject ledger.
  const tr = uuid();
  const trItem = uuid();
  await q(
    `INSERT INTO scm_transfers (id, code, from_branch_id, to_branch_id, status, requested_by_id)
     VALUES ($1,$4,$2,$3,'WaitingForPayment',$5)`,
    [tr, sender, receiver, `${run}-MUT-001`, su],
  );
  await q(
    `INSERT INTO scm_transfer_items (id, scm_transfer_id, ingredient_id, quantity, unit_price,
       received_quantity, rejected_quantity, reason)
     VALUES ($1,$2,$3,8,500,5,3,'pecah')`,
    [trItem, tr, ing],
  );
  await q(
    `INSERT INTO pending_review_inventory (scm_transfer_id, branch_id, ingredient_id,
       quantity, created_by_id) VALUES ($1,$2,$3,3,$4)`,
    [tr, receiver, ing, wa],
  );

  // -- Run the repair script with --apply ------------------------------------
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("node", ["scripts/repair-rejected-stock.mjs", "--apply"], {
    env: { ...process.env, DATABASE_URL: connectionString },
    encoding: "utf8",
  });
  console.log("--- script output ---\n" + out);

  // -- Assert ----------------------------------------------------------------
  const { rows: centralInv } = await q(
    `SELECT quantity FROM inventory WHERE branch_id=$1 AND ingredient_id=$2`,
    [central, ing],
  );
  const { rows: senderInv } = await q(
    `SELECT quantity FROM inventory WHERE branch_id=$1 AND ingredient_id=$2`,
    [sender, ing],
  );
  if (Number(centralInv[0].quantity) !== 14) {
    throw new Error(`Central stock expected 14, got ${centralInv[0].quantity}`);
  }
  if (Number(senderInv[0].quantity) !== 11) {
    throw new Error(`Sender stock expected 11, got ${senderInv[0].quantity}`);
  }
  const { rows: ledger } = await q(
    `SELECT notes FROM stock_ledger WHERE reference IN ($1,$2) AND type='IN'
       AND notes LIKE '%Reject%backfill%'`,
    [proc, tr],
  );
  if (ledger.length !== 2) throw new Error(`expected 2 backfill ledger rows, got ${ledger.length}`);
  const { rows: pending } = await q(
    `SELECT cleared_at FROM pending_review_inventory
       WHERE scm_procurement_id=$1 OR scm_transfer_id=$2`,
    [proc, tr],
  );
  if (pending.some((r) => r.cleared_at === null)) {
    throw new Error("pending_review rows still uncleared");
  }

  // -- Idempotency: second run must be a no-op -------------------------------
  const out2 = execFileSync("node", ["scripts/repair-rejected-stock.mjs", "--apply"], {
    env: { ...process.env, DATABASE_URL: connectionString },
    encoding: "utf8",
  });
  if (!/Nothing to repair/.test(out2)) {
    throw new Error("second run was not a no-op:\n" + out2);
  }
  const { rows: central2 } = await q(
    `SELECT quantity FROM inventory WHERE branch_id=$1 AND ingredient_id=$2`,
    [central, ing],
  );
  if (Number(central2[0].quantity) !== 14) throw new Error("second run double-credited!");

  console.log(
    "\nE2E VALIDATION PASSED (Central 10→14, sender 8→11, ledger + pending OK, idempotent)",
  );
} finally {
  await client.end();
}
