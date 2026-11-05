/**
 * One-off repair: remove one mispriced ingredient from the frozen HPP of a
 * closed date range.
 *
 * COGS is frozen per order line at sale time (ADR 0020/0031), which is what keeps
 * a later price change from rewriting history. The same property makes a *wrong*
 * price permanent: water was entered at Rp 369/ml on 25 Sep 2026 and corrected to
 * Rp 1/ml on 26 Sep at 21:59, so every sale in between still carries ~Rp 66.000
 * of water per bowl of soup.
 *
 * This script corrects **only that ingredient's share** of each affected line:
 *
 *     lineAfter = lineBefore − quantity × (priceAtSaleTime − correctPrice)
 *
 * Everything else in the line stays exactly as it was frozen — other
 * ingredients, modifiers, exclusions, BOGO — so a menu without the ingredient is
 * never touched, and a menu with it keeps every other historical price.
 *
 * `priceAtSaleTime` comes from `audit_logs` for that ingredient, so the window is
 * exact: a sale made before the wrong price was entered (or after it was
 * corrected) needs no change and gets none.
 *
 * What it does NOT touch: inventory and the stock ledger, omzet / payouts /
 * discounts, `recipes`, other ingredients, and dates outside the range.
 *
 * Idempotent: the correction is computed from the audit-derived price, never from
 * the current frozen value, so a second run finds nothing left to subtract.
 *
 * Usage:
 *   node_modules/.bin/tsx scripts/repair-hpp-date-range.ts --ingredient=Air
 *   ... --ingredient=Air --apply
 *   ... --ingredient=Air --from=2026-09-25 --to=2026-09-26 --json=/tmp/report.json
 *
 * Options:
 *   --ingredient=<name>   Ingredient whose price was wrong (default: Air)
 *   --ingredient-id=<uuid> Use when the name is ambiguous
 *   --correct-cost=<n>    Price it should have had (default: its price now)
 *   --from/--to           Jakarta dates, inclusive (default 2026-09-25..26)
 *   --apply               Write. Without it, nothing is written.
 *   --json=<path>         Per-line detail for review
 */
import { readFileSync, writeFileSync } from "node:fs";

// ─── Environment ───────────────────────────────────────────────────────────
// Load .env.local without clobbering an explicit DATABASE_URL, then import the
// app's db module — it reads the variable at import time.
function loadEnvLocal(): void {
  try {
    const env = readFileSync(".env.local", "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] && !process.env[m[1]]) {
        process.env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env.local: rely on the caller's environment.
  }
}
loadEnvLocal();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const argValue = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const INGREDIENT_NAME = argValue("ingredient") ?? "Air";
const INGREDIENT_ID = argValue("ingredient-id");
const CORRECT_COST_ARG = argValue("correct-cost");
const FROM = argValue("from") ?? "2026-09-25";
const TO = argValue("to") ?? "2026-09-26";
const JSON_PATH = argValue("json");

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
for (const [label, value] of [
  ["--from", FROM],
  ["--to", TO],
] as const) {
  if (!DATE_ONLY.test(value)) {
    console.error(`${label} must be YYYY-MM-DD (got "${value}")`);
    process.exit(1);
  }
}
const dayCount = (Date.parse(`${TO}T00:00:00Z`) - Date.parse(`${FROM}T00:00:00Z`)) / 86_400_000 + 1;
if (dayCount < 1) {
  console.error("--to must not be before --from");
  process.exit(1);
}
if (dayCount > 31) {
  console.error(
    `Refusing a ${dayCount}-day range: this repairs a mistake, it does not rebuild history.`,
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("No DATABASE_URL (set it in the environment or .env.local)");
  process.exit(1);
}
const target = new URL(process.env.DATABASE_URL);
const targetLabel = `${target.hostname}:${target.port || "5432"}${target.pathname}`;

// Imported after DATABASE_URL is known — `db` resolves the variable at import.
const { db } = await import("#/lib/server/db");
const { orders, orderItems, recipes, branches, ingredients } = await import("#/db/schema");
const { resolvePersistedItemsIngredients } = await import("#/lib/server/ingredient-resolver");
const { and, eq, inArray, isNull, ne, sql } = await import("drizzle-orm");

// The resolver warns once per line with no ADR-0020 snapshot — which is every
// line in a pre-October range. Count them, drop the noise.
let fallbackLines = 0;
const realWarn = console.warn;

const posDay = sql<string>`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')`;
const rp = (n: number): string => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const signed = (n: number): string =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}Rp ${Math.round(Math.abs(n)).toLocaleString("id-ID")}`;
const pad = (s: string, n: number): string => s.padStart(n);

// ─── The ingredient and its price history ─────────────────────────────────
const candidates = await db
  .select({
    id: ingredients.id,
    name: ingredients.name,
    stockUnit: ingredients.stockUnit,
    averageCost: ingredients.averageCost,
  })
  .from(ingredients)
  .where(
    INGREDIENT_ID
      ? eq(ingredients.id, INGREDIENT_ID)
      : sql`lower(${ingredients.name}) = lower(${INGREDIENT_NAME})`,
  );

if (candidates.length === 0) {
  console.error(`No ingredient named "${INGREDIENT_NAME}". Pass --ingredient-id.`);
  process.exit(1);
}
if (candidates.length > 1) {
  console.error(
    `"${INGREDIENT_NAME}" is ambiguous (${candidates.length} rows): ${candidates
      .map((c) => c.id)
      .join(", ")} — pass --ingredient-id.`,
  );
  process.exit(1);
}
const subject = candidates[0]!;
const correctCost = CORRECT_COST_ARG === undefined ? subject.averageCost : Number(CORRECT_COST_ARG);

// Every recorded price for this ingredient, oldest first. A sale's price is the
// last entry at or before it, which is what makes the correction exact for a
// sale made before the typo or after the fix.
// Epoch seconds on both sides, on purpose: `timestamp without time zone` comes
// back through raw SQL parsed in the *client's* timezone while drizzle's column
// parser uses UTC, and mixing the two silently shifts the window by the offset
// (8 hours here) — which is how a "correct" run can skip most of the day.
const priceHistory = await db.execute<{ at: number; cost: string | null }>(sql`
  SELECT EXTRACT(EPOCH FROM created_at)::float8 AS at, new_values->>'averageCost' AS cost
  FROM audit_logs
  WHERE table_name = 'ingredients'
    AND record_id = ${subject.id}
    AND new_values ? 'averageCost'
  ORDER BY created_at
`);
const history = priceHistory.rows
  .map((r) => ({ at: Number(r.at), cost: Number(r.cost) }))
  .filter((r) => Number.isFinite(r.cost));

function priceAt(epochSeconds: number): number | null {
  let price: number | null = null;
  for (const entry of history) {
    if (entry.at > epochSeconds) break;
    price = entry.cost;
  }
  return price;
}

console.log(`\n=== Target: ${targetLabel} ===`);
console.log(`Range (Asia/Jakarta): ${FROM} .. ${TO} — non-void, non-deleted orders`);
console.log(
  `Ingredient: ${subject.name} (per ${subject.stockUnit}) · correct price ${rp(correctCost)}`,
);
console.log(`Recorded price changes (${history.length}):`);
for (const entry of history.slice(-6)) {
  console.log(
    `  ${new Date(entry.at * 1000).toISOString().slice(0, 16).replace("T", " ")}Z → ${rp(entry.cost)}`,
  );
}
if (history.length === 0) {
  console.log("  (none — cannot tell what a sale was charged; every line will be skipped)");
}

// ─── Scan ──────────────────────────────────────────────────────────────────
const orderRows = await db
  .select({
    id: orders.id,
    branchId: orders.branchId,
    day: posDay,
    createdAtEpoch: sql<number>`EXTRACT(EPOCH FROM ${orders.createdAt})::float8`,
    totalCogs: orders.totalCogs,
  })
  .from(orders)
  .where(
    and(
      ne(orders.status, "Void"),
      isNull(orders.deletedAt),
      sql`${posDay} >= ${FROM}`,
      sql`${posDay} <= ${TO}`,
    ),
  );

const itemRows = await db
  .select({
    orderId: orderItems.orderId,
    orderItemId: orderItems.id,
    recipeId: orderItems.recipeId,
    quantity: orderItems.quantity,
    cogsAtTransaction: orderItems.cogsAtTransaction,
  })
  .from(orderItems)
  .innerJoin(orders, eq(orderItems.orderId, orders.id))
  .where(
    and(
      ne(orders.status, "Void"),
      isNull(orders.deletedAt),
      sql`${posDay} >= ${FROM}`,
      sql`${posDay} <= ${TO}`,
    ),
  );

const orderById = new Map(orderRows.map((o) => [o.id, o]));

// Idempotency marker: every line this script has corrected carries an audit row.
// The correction is relative (subtract the wrong price's share), so re-running it
// would subtract again — the marker is what makes a second run a no-op, and it
// also leaves a trail in the app's own audit log.
const repairedItems = new Set(
  (
    await db.execute<{ record_id: string }>(sql`
      SELECT record_id FROM audit_logs
      WHERE table_name = 'orderItems' AND action = 'HPP_REPAIR'
    `)
  ).rows.map((r) => r.record_id),
);
const recipeNames = new Map(
  (
    await db
      .select({ id: recipes.id, name: recipes.name })
      .from(recipes)
      .where(inArray(recipes.id, [...new Set(itemRows.map((r) => r.recipeId))]))
  ).map((r) => [r.id, r.name]),
);
const branchNames = new Map(
  (await db.select({ id: branches.id, name: branches.name }).from(branches)).map((b) => [
    b.id,
    b.name,
  ]),
);

console.warn = () => {
  fallbackLines++;
};
process.stderr.write(`  resolving ${itemRows.length} order lines from the current BOM…\n`);
const resolved = await resolvePersistedItemsIngredients(
  itemRows.map((r) => r.orderItemId),
  { includeCost: false },
);
console.warn = realWarn;

interface LineFix {
  orderId: string;
  orderItemId: string;
  day: string;
  recipeId: string;
  quantity: number;
  /** Units of the ingredient on this line. */
  subjectQuantity: number;
  priceAtSale: number;
  beforeUnit: number;
  afterUnit: number;
  /** Rupiah removed from the line (positive = it was overcharged). */
  delta: number;
}

const fixes: LineFix[] = [];
const menus = new Map<string, { name: string; quantity: number; before: number; after: number }>();
const perBranch = new Map<string, { name: string; before: number; after: number }>();
const perDay = new Map<
  string,
  { orders: Set<string>; before: number; after: number; lines: number }
>();
const orderDelta = new Map<string, number>();
const unknownPriceLines: string[] = [];
const inconsistentLines: string[] = [];
const unaffected = new Set<string>();
let alreadyRepaired = 0;

for (const row of itemRows) {
  const order = orderById.get(row.orderId);
  if (!order) continue;
  const day = String(order.day);
  const bucket = perDay.get(day) ?? { orders: new Set<string>(), before: 0, after: 0, lines: 0 };
  bucket.orders.add(order.id);
  bucket.before += Number(order.totalCogs);
  perDay.set(day, bucket);

  const qty = (resolved.get(row.orderItemId)?.ingredients ?? [])
    .filter((ing) => ing.ingredientId === subject.id)
    .reduce((sum, ing) => sum + ing.quantity, 0);

  if (row.quantity <= 0 || qty === 0) {
    unaffected.add(order.id);
    continue;
  }

  const priceAtSale = priceAt(Number(order.createdAtEpoch));
  if (priceAtSale === null) {
    unknownPriceLines.push(`${row.orderItemId} (order ${order.id.slice(0, 8)}, ${day})`);
    continue;
  }

  const delta = qty * (priceAtSale - correctCost);
  if (delta === 0) {
    unaffected.add(order.id);
    continue;
  }

  if (repairedItems.has(row.orderItemId)) {
    alreadyRepaired++;
    continue;
  }

  const beforeUnit = row.cogsAtTransaction;
  const lineBefore = beforeUnit * row.quantity;
  const lineAfter = lineBefore - delta;
  // A correction larger than the line itself means this line's frozen cost never
  // held the ingredient's full share (it was excluded, or the line was already
  // corrected by something else). Skipping is the safe answer; clamping would
  // invent a number.
  if (lineAfter < 0) {
    inconsistentLines.push(`${row.orderItemId} (${day}, ${recipeNames.get(row.recipeId) ?? "?"})`);
    continue;
  }
  const afterUnit = Math.round(lineAfter / row.quantity);

  const applied = (beforeUnit - afterUnit) * row.quantity;
  fixes.push({
    orderId: row.orderId,
    orderItemId: row.orderItemId,
    day,
    recipeId: row.recipeId,
    quantity: row.quantity,
    subjectQuantity: qty,
    priceAtSale,
    beforeUnit,
    afterUnit,
    delta: applied,
  });
  orderDelta.set(row.orderId, (orderDelta.get(row.orderId) ?? 0) + applied);

  const menu = menus.get(row.recipeId) ?? {
    name: recipeNames.get(row.recipeId) ?? row.recipeId,
    quantity: 0,
    before: 0,
    after: 0,
  };
  menu.quantity += row.quantity;
  menu.before += beforeUnit * row.quantity;
  menu.after += afterUnit * row.quantity;
  menus.set(row.recipeId, menu);

  const branch = perBranch.get(order.branchId) ?? {
    name: branchNames.get(order.branchId) ?? order.branchId,
    before: 0,
    after: 0,
  };
  branch.before += beforeUnit * row.quantity;
  branch.after += afterUnit * row.quantity;
  perBranch.set(order.branchId, branch);
}

// ─── Report ────────────────────────────────────────────────────────────────
console.log("\nTanggal       Order   Baris   HPP baris (sebelum → sesudah)   Selisih");
for (const [day, bucket] of [...perDay.entries()].sort()) {
  const dayLines = fixes.filter((f) => f.day === day);
  const before = dayLines.reduce((s, f) => s + f.beforeUnit * f.quantity, 0);
  const after = dayLines.reduce((s, f) => s + f.afterUnit * f.quantity, 0);
  console.log(
    `${day.padEnd(12)} ${pad(String(bucket.orders.size), 6)}  ${pad(String(dayLines.length), 6)}   ${pad(
      rp(before),
      15,
    )} → ${pad(rp(after), 15)}   ${pad(signed(after - before), 15)}`,
  );
}

if (menus.size > 0) {
  console.log("\nMenu yang berubah (terbesar dulu):");
  for (const menu of [...menus.values()]
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
    .slice(0, 12)) {
    console.log(
      `  ${menu.name.slice(0, 44).padEnd(44)} ${pad(`${menu.quantity}x`, 4)}  ${pad(
        rp(menu.before),
        15,
      )} → ${pad(rp(menu.after), 15)}`,
    );
  }
}

if (perBranch.size > 0) {
  console.log("\nPer cabang:");
  for (const branch of [...perBranch.values()].sort((a, b) => a.after - b.after)) {
    console.log(
      `  ${branch.name.padEnd(28)} ${pad(rp(branch.before), 15)} → ${pad(rp(branch.after), 15)}  ${signed(
        branch.after - branch.before,
      )}`,
    );
  }
}

const totalDelta = fixes.reduce((s, f) => s + f.delta, 0);
const subjectUnits = fixes.reduce((s, f) => s + f.subjectQuantity, 0);

console.log(
  `\nRingkasan: ${fixes.length} baris di ${orderDelta.size} order · ${unaffected.size} order tidak terpengaruh`,
);
console.log(
  `${subject.name}: ${subjectUnits.toLocaleString("id-ID")} ${subject.stockUnit} · kelebihan ${signed(totalDelta)}`,
);
if (alreadyRepaired > 0) {
  console.log(
    `${alreadyRepaired} baris sudah pernah diperbaiki (ada jejak HPP_REPAIR) — dilewati.`,
  );
}
if (inconsistentLines.length > 0) {
  console.log(
    `PERINGATAN: ${inconsistentLines.length} baris dilewati — koreksi melebihi HPP barisnya:`,
  );
  for (const line of inconsistentLines.slice(0, 10)) console.log(`  ? ${line}`);
}
if (unknownPriceLines.length > 0) {
  console.log(
    `PERINGATAN: ${unknownPriceLines.length} baris dilewati — tidak ada catatan harga sebelum transaksi:`,
  );
  for (const line of unknownPriceLines.slice(0, 10)) console.log(`  ? ${line}`);
}
console.log(`(${fallbackLines} baris di-resolve dari BOM hidup — belum ada snapshot ADR-0020)`);

if (JSON_PATH) {
  writeFileSync(
    JSON_PATH,
    JSON.stringify(
      { target: targetLabel, from: FROM, to: TO, applied: APPLY, ingredient: subject, fixes },
      null,
      2,
    ),
  );
  console.log(`Detail per baris ditulis ke ${JSON_PATH}`);
}

if (fixes.length === 0) {
  console.log("\nTidak ada yang perlu diperbaiki.");
  process.exit(0);
}

if (!APPLY) {
  console.log(
    `\nDRY RUN — tidak ada yang ditulis. Jalankan ulang dengan --apply untuk mengoreksi ${fixes.length} baris.`,
  );
  process.exit(0);
}

// ─── Apply ─────────────────────────────────────────────────────────────────
// Line first, then the order total shifted by exactly the sum of its line
// deltas — so an order's own rounding remainder is preserved untouched.
await db.transaction(async (tx) => {
  for (const fix of fixes) {
    await tx
      .update(orderItems)
      .set({ cogsAtTransaction: fix.afterUnit })
      .where(eq(orderItems.id, fix.orderItemId));
  }
  for (const [orderId, delta] of orderDelta) {
    const before = Number(orderById.get(orderId)?.totalCogs ?? 0);
    await tx
      .update(orders)
      .set({ totalCogs: before - delta })
      .where(eq(orders.id, orderId));
  }

  // The marker, written with the change so a rollback cannot leave one without
  // the other.
  for (const fix of fixes) {
    await tx.execute(sql`
      INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values)
      VALUES (
        'orderItems',
        ${fix.orderItemId},
        'HPP_REPAIR',
        ${JSON.stringify({ cogsAtTransaction: fix.beforeUnit, orderId: fix.orderId })}::jsonb,
        ${JSON.stringify({
          cogsAtTransaction: fix.afterUnit,
          ingredient: subject.name,
          priceAtSale: fix.priceAtSale,
          correctCost,
          quantity: fix.subjectQuantity,
        })}::jsonb
      )
    `);
  }
});

console.log(`\nDiterapkan: ${fixes.length} baris, ${orderDelta.size} order.`);

// ─── Verify ────────────────────────────────────────────────────────────────
const reread = await db
  .select({ id: orders.id, totalCogs: orders.totalCogs })
  .from(orders)
  .where(
    and(
      ne(orders.status, "Void"),
      isNull(orders.deletedAt),
      sql`${posDay} >= ${FROM}`,
      sql`${posDay} <= ${TO}`,
    ),
  );

let mismatched = 0;
for (const order of reread) {
  const before = Number(orderById.get(order.id)?.totalCogs ?? 0);
  const expected = before - (orderDelta.get(order.id) ?? 0);
  if (Number(order.totalCogs) !== expected) mismatched++;
}

const rereadItems = await db
  .select({ id: orderItems.id, cogsAtTransaction: orderItems.cogsAtTransaction })
  .from(orderItems)
  .where(
    inArray(
      orderItems.id,
      fixes.map((f) => f.orderItemId),
    ),
  );
let lineMismatched = 0;
for (const item of rereadItems) {
  const fix = fixes.find((f) => f.orderItemId === item.id);
  if (fix && item.cogsAtTransaction !== fix.afterUnit) lineMismatched++;
}

console.log(
  mismatched === 0 && lineMismatched === 0
    ? "Verifikasi: setiap order bergeser tepat sebesar koreksi barisnya. OK."
    : `PERINGATAN: ${mismatched} order / ${lineMismatched} baris tidak sesuai harapan — periksa manual.`,
);
if (mismatched > 0 || lineMismatched > 0) process.exitCode = 1;
process.exit(process.exitCode ?? 0);
