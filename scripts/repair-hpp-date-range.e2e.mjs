// E2E validation for scripts/repair-hpp-date-range.ts (run against the TEST DB).
//
// Seeds the production shape of the 26 Sep 2026 incident:
//   - Air priced at Rp 369/ml from 25 Sep 10:44 WIB, corrected to Rp 1/ml on
//     26 Sep 21:59 WIB (both recorded in audit_logs, which is where the script
//     reads the sale-time price from).
//   - One order sold during the wrong-price window, one sold after the fix, and
//     one whose menu does not contain Air at all.
//
// Then runs the script with --apply and asserts:
//   - only Air's share is removed: the water menu drops by qty x (369 - 1),
//   - the menu without Air is untouched, and so is the sale made after the fix,
//   - each order total moves by exactly the sum of its line corrections,
//   - a second run finds nothing to do (idempotent).
import { execFileSync } from "node:child_process";
import pg from "pg";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test";
if (!connectionString.includes("test")) throw new Error("refusing: not a test database");

// Declared up here so the cleanup block can reach them when a seed step throws.
const branchId = crypto.randomUUID();
const waterId = crypto.randomUUID();
const riceId = crypto.randomUUID();
let categoryId;
let menuWater;
let menuRice;

const client = new pg.Client({ connectionString });
await client.connect();
const q = (text, params) => client.query(text, params);
const uuid = () => crypto.randomUUID();
const run = `RH-${crypto.randomUUID().slice(0, 8)}`;

/**
 * Jakarta wall-clock -> the literal UTC timestamp stored in `created_at`.
 * Passed as a string on purpose: node-postgres serialises a Date in the client's
 * timezone, which would shift which Jakarta day a sale belongs to.
 */
const wib = (iso) => new Date(`${iso}+07:00`).toISOString().slice(0, 19).replace("T", " ");

try {
  // ── Seed ────────────────────────────────────────────────────────────────
  await q(
    `INSERT INTO branches (id, code, name, location, type) VALUES ($1,$2,'ITS repair branch','Test','Outlet')`,
    [branchId, `${run}-BR`],
  );

  await q(
    `INSERT INTO ingredients (id, code, name, category, sku_type, purchase_unit, stock_unit,
       conversion_factor, average_cost)
     VALUES ($1,$3,'Air','Dry','RM','ml','ml',1,1),
            ($2,$4,'Nasi Uji','Dry','RM','gr','gr',1,9)`,
    [waterId, riceId, `${run}-AIR`, `${run}-RICE`],
  );

  // Price history the script replays. Water was 0, then a bottle price typed as
  // a per-ml price, then corrected.
  await q(
    `INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, created_at) VALUES
       ('ingredients',$1,'CREATE', NULL, '{"name":"Air","averageCost":0}'::jsonb, $2),
       ('ingredients',$1,'UPDATE', '{"name":"Air","averageCost":0}'::jsonb,
                                  '{"name":"Air","averageCost":369}'::jsonb, $3),
       ('ingredients',$1,'UPDATE', '{"name":"Air","averageCost":369}'::jsonb,
                                  '{"name":"Air","averageCost":1}'::jsonb, $4)`,
    [waterId, wib("2026-09-01T00:00:00"), wib("2026-09-25T10:44:18"), wib("2026-09-26T21:59:34")],
  );

  categoryId = uuid();
  await q(`INSERT INTO categories (id, code, name) VALUES ($1,$2,'ITS cat')`, [
    categoryId,
    `${run}-CAT`,
  ]);

  // Menu A: 180 ml water + 100 gr rice. Menu B: rice only (no water).
  menuWater = uuid();
  menuRice = uuid();
  await q(
    `INSERT INTO recipes (id, category_id, code, name, base_price, status, total_cogs) VALUES
       ($1,$3,$4,'Menu Berair',15000,'Active',1080),
       ($2,$3,$5,'Menu Tanpa Air',12000,'Active',900)`,
    [menuWater, menuRice, categoryId, `${run}-R1`, `${run}-R2`],
  );
  await q(
    `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity) VALUES
       ($1,$3,180), ($1,$4,100), ($2,$4,100)`,
    [menuWater, menuRice, waterId, riceId],
  );

  /** Frozen COGS the app would have written at sale time. */
  const frozenUnit = (waterPrice, ricePrice = 9) => 180 * waterPrice + 100 * ricePrice;

  async function seedOrder(label, createdAt, menuId, quantity, cogsUnit) {
    const orderId = uuid();
    const total = cogsUnit * quantity;
    await q(
      `INSERT INTO orders (id, branch_id, channel, subtotal, merchant_discount, platform_discount,
         tax_amount, total_amount, total_cogs, mdr_fee, net_sales, status, created_at, verified)
       VALUES ($1,$2,'Dine-in',$3,0,0,0,$3,$4,0,$3,'Completed',$5,false)`,
      [orderId, branchId, 20000 * quantity, total, createdAt],
    );
    const itemId = uuid();
    await q(
      `INSERT INTO order_items (id, order_id, recipe_id, quantity, price, cogs_at_transaction, created_at)
       VALUES ($1,$2,$3,$4,20000,$5,$6)`,
      [itemId, orderId, menuId, quantity, cogsUnit, createdAt],
    );
    console.log(
      `  seeded ${label}: order ${orderId.slice(0, 8)}, ${quantity}x, cogs/unit ${cogsUnit}`,
    );
    return { orderId, itemId };
  }

  const during = await seedOrder(
    "during wrong price (26 Sep 12:00)",
    wib("2026-09-26T12:00:00"),
    menuWater,
    2,
    frozenUnit(369),
  );
  // Sold at 14:00 WIB, eight hours before the revert — a window shifted by the
  // client timezone would treat this as "after the fix" and skip it.
  const lateMorning = await seedOrder(
    "during wrong price (26 Sep 14:00)",
    wib("2026-09-26T14:00:00"),
    menuWater,
    1,
    frozenUnit(369),
  );
  const afterFix = await seedOrder(
    "after fix (26 Sep 22:30)",
    wib("2026-09-26T22:30:00"),
    menuWater,
    1,
    frozenUnit(1),
  );
  const noWater = await seedOrder(
    "no water (26 Sep 13:00)",
    wib("2026-09-26T13:00:00"),
    menuRice,
    1,
    frozenUnit(1),
  );

  // ── Run ─────────────────────────────────────────────────────────────────
  const script = "scripts/repair-hpp-date-range.ts";
  const runScript = (...extra) =>
    // --ingredient-id, not --ingredient: the test must not depend on no other
    // row being called "Air" (the script refuses an ambiguous name, on purpose).
    execFileSync(
      "node_modules/.bin/tsx",
      [script, `--ingredient-id=${waterId}`, "--from=2026-09-26", "--to=2026-09-26", ...extra],
      {
        env: { ...process.env, DATABASE_URL: connectionString },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

  console.log("\n--- dry run ---");
  const dry = runScript();
  if (!dry.includes("DRY RUN")) throw new Error(`expected a dry run, got:\n${dry}`);
  const untouched = await q(`SELECT cogs_at_transaction FROM order_items WHERE id = $1`, [
    during.itemId,
  ]);
  if (Number(untouched.rows[0].cogs_at_transaction) !== frozenUnit(369)) {
    throw new Error("dry run wrote to the database");
  }

  console.log("\n--- apply ---");
  const applied = runScript("--apply");
  console.log(
    applied
      .split("\n")
      .filter((l) => /Diterapkan|Verifikasi|Ringkasan|Air:/.test(l))
      .join("\n"),
  );
  if (applied.includes("PERINGATAN")) throw new Error(`script warned:\n${applied}`);

  // ── Assert ──────────────────────────────────────────────────────────────
  const item = async (id) =>
    Number(
      (await q(`SELECT cogs_at_transaction FROM order_items WHERE id = $1`, [id])).rows[0]
        .cogs_at_transaction,
    );
  const total = async (id) =>
    Number((await q(`SELECT total_cogs FROM orders WHERE id = $1`, [id])).rows[0].total_cogs);

  const expectedUnit = frozenUnit(1); // 180 x 1 + 100 x 9
  const duringUnit = await item(during.itemId);
  const duringTotal = await total(during.orderId);
  if (duringUnit !== expectedUnit) {
    throw new Error(`water line: expected ${expectedUnit}/unit, got ${duringUnit}`);
  }
  // 2 units x 180 ml x (369 - 1) = 132.480 removed from the order.
  const expectedTotal = frozenUnit(369) * 2 - 2 * 180 * 368;
  if (duringTotal !== expectedTotal) {
    throw new Error(`water order total: expected ${expectedTotal}, got ${duringTotal}`);
  }
  console.log(
    `  ✓ water line corrected: ${frozenUnit(369)} → ${duringUnit}/unit, order ${frozenUnit(369) * 2} → ${duringTotal}`,
  );

  // A sale made eight hours before the revert is inside the wrong-price window.
  // A timezone-shifted window would call it "after the fix" and skip it, which is
  // exactly the bug this case exists to catch.
  const lateUnit = await item(lateMorning.itemId);
  if (lateUnit !== expectedUnit) {
    throw new Error(`sale 8h before the fix: expected ${expectedUnit}/unit, got ${lateUnit}`);
  }
  console.log(`  ✓ sale before the revert corrected too: ${frozenUnit(369)} → ${lateUnit}/unit`);

  // A sale made after the price was fixed needs nothing, and a menu without
  // water is never touched — the whole point of correcting one ingredient.
  if ((await item(afterFix.itemId)) !== frozenUnit(1))
    throw new Error("post-fix sale was modified");
  if ((await total(afterFix.orderId)) !== frozenUnit(1))
    throw new Error("post-fix order total was modified");
  if ((await item(noWater.itemId)) !== frozenUnit(1))
    throw new Error("menu without water was modified");
  if ((await total(noWater.orderId)) !== frozenUnit(1))
    throw new Error("order without water was modified");
  console.log("  ✓ post-fix sale and the water-free menu untouched");

  // ── Idempotent ──────────────────────────────────────────────────────────
  const second = runScript("--apply");
  if (!second.includes("Tidak ada yang perlu diperbaiki")) {
    throw new Error(`second run should be a no-op, got:\n${second}`);
  }
  if ((await item(during.itemId)) !== expectedUnit)
    throw new Error("second run changed the line again");
  console.log("  ✓ second run is a no-op");

  console.log("\nE2E OK");
} finally {
  // Seeded rows must not leak into the next run of the script (it filters by date
  // range, and these orders sit inside the range it is pointed at).
  const ids = { branchId, waterId, riceId, categoryId, menuWater, menuRice };
  // Markers first: they reference order_items, which go with the orders.
  if (ids.branchId) {
    await q(
      `DELETE FROM audit_logs WHERE action = 'HPP_REPAIR'
         AND record_id IN (SELECT id::text FROM order_items WHERE order_id IN
           (SELECT id FROM orders WHERE branch_id = $1))`,
      [ids.branchId],
    );
  }
  if (ids.branchId) await q(`DELETE FROM orders WHERE branch_id = $1`, [ids.branchId]);
  if (ids.menuWater)
    await q(`DELETE FROM recipes WHERE id IN ($1, $2)`, [ids.menuWater, ids.menuRice]);
  if (ids.categoryId) await q(`DELETE FROM categories WHERE id = $1`, [ids.categoryId]);
  if (ids.waterId)
    await q(`DELETE FROM ingredients WHERE id IN ($1, $2)`, [ids.waterId, ids.riceId]);
  if (ids.branchId) await q(`DELETE FROM branches WHERE id = $1`, [ids.branchId]);
  if (ids.waterId) await q(`DELETE FROM audit_logs WHERE record_id = $1`, [ids.waterId]);
  await client.end();
}
