/**
 * One-off repair: recompute the frozen HPP for a closed date range.
 *
 * Why this exists: COGS is frozen per order line at sale time (ADR 0020/0031),
 * which is what keeps a later price change from rewriting history. The same
 * property makes a *wrong* price permanent. On 25 Sep 2026 water was entered at
 * Rp 369/ml instead of Rp 1/ml and corrected on 26 Sep at 21:59 — so every sale
 * on the 26th carries ~Rp 66.000 of water per bowl of soup, Rp 4.9M of HPP that
 * was never spent. Correcting the ingredient price afterwards cannot reach back.
 *
 * What it does, per order line in the range:
 *   1. Re-resolves the line from the current BOM, its persisted add-on modifiers
 *      and exclusions, and the BOGO rule — the same fallback the app already uses
 *      for pre-ADR-0020 restores (`resolveLiveFallback`), so no BOM logic is
 *      reimplemented here.
 *   2. Rewrites `order_items.cogs_at_transaction` to that per-unit cost and
 *      `orders.total_cogs` to Σ(per-unit × quantity).
 *
 * What it does NOT touch: inventory and the stock ledger (already correct — the
 * sale deducted, any void restored), omzet / payouts / discounts, `recipes`, and
 * every date outside the range.
 *
 * Basis: today's ingredient costs. The result is "what these lines would cost at
 * today's prices", not a reconstruction of 26 Sep's other price movements — the
 * goal is to remove the Rp 369/ml water, and the day's other prices differ from
 * today's by ~10%, not by 369×.
 *
 * Idempotent: the new value comes from the live BOM, never from the old frozen
 * value, so a second run computes the same numbers and writes nothing.
 *
 * Usage:
 *   node_modules/.bin/tsx scripts/repair-hpp-date-range.ts                    # dry-run
 *   node_modules/.bin/tsx scripts/repair-hpp-date-range.ts --apply            # write
 *   ... --from=2026-09-25 --to=2026-09-26 --json=/tmp/hpp-repair.json
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

const FROM = argValue("from") ?? "2026-09-25";
const TO = argValue("to") ?? "2026-09-26";
const JSON_PATH = argValue("json");
/** Optional: name an ingredient to report the share of the error it caused. */
const EXPLAIN = argValue("explain");
/** The wrong price that ingredient carried during the range (from audit_logs). */
const EXPLAIN_BAD_COST = Number(argValue("explain-bad-cost") ?? "0");

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
const muteWarnings = (): void => {
  console.warn = () => {
    fallbackLines++;
  };
};

const posDay = sql<string>`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')`;

interface LineChange {
  orderId: string;
  orderItemId: string;
  quantity: number;
  /** Per-unit COGS before / after. */
  beforeUnit: number;
  afterUnit: number;
}

interface DayTotal {
  day: string;
  orders: number;
  before: number;
  after: number;
}

interface Scan {
  orders: {
    id: string;
    branchId: string;
    day: string;
    before: number;
    after: number;
    lines: number;
  }[];
  lineChanges: LineChange[];
  menus: Map<string, { name: string; quantity: number; before: number; after: number }>;
  perBranch: Map<string, { name: string; before: number; after: number }>;
  itemlessOrders: number;
  skippedLines: number;
  /** Units of `--explain` sold per day, straight from the resolved lines. */
  explainByDay: Map<string, number>;
}

async function scan(): Promise<Scan> {
  muteWarnings();

  const orderRows = await db
    .select({
      id: orders.id,
      branchId: orders.branchId,
      day: posDay,
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

  process.stderr.write(`  resolving ${itemRows.length} order lines from the current BOM…\n`);
  const resolved = await resolvePersistedItemsIngredients(
    itemRows.map((r) => r.orderItemId),
    { includeCost: true },
  );
  console.warn = realWarn;

  const lineChanges: LineChange[] = [];
  const perOrder = new Map<string, { before: number; after: number; lines: number }>();
  const menus = new Map<
    string,
    { name: string; quantity: number; before: number; after: number }
  >();
  const perBranch = new Map<string, { name: string; before: number; after: number }>();
  const ordersWithItems = new Set<string>();
  const explainByDay = new Map<string, number>();
  let skippedLines = 0;

  const explainId = EXPLAIN
    ? (
        await db
          .select({ id: ingredients.id })
          .from(ingredients)
          .where(eq(ingredients.name, EXPLAIN))
          .limit(1)
      )[0]?.id
    : undefined;
  const dayOfOrder = new Map(orderRows.map((o) => [o.id, String(o.day)]));

  for (const row of itemRows) {
    ordersWithItems.add(row.orderId);
    if (row.quantity <= 0) continue;

    const resolvedItem = resolved.get(row.orderItemId);
    const resolvedCost =
      resolvedItem?.ingredients.reduce((sum, ing) => sum + (ing.currentCost ?? 0), 0) ?? 0;

    if (explainId) {
      const qty = (resolvedItem?.ingredients ?? [])
        .filter((ing) => ing.ingredientId === explainId)
        .reduce((sum, ing) => sum + ing.quantity, 0);
      if (qty > 0) {
        const day = dayOfOrder.get(row.orderId) ?? "";
        explainByDay.set(day, (explainByDay.get(day) ?? 0) + qty);
      }
    }
    const afterUnit = Math.max(0, Math.round(resolvedCost / row.quantity));

    // A line that resolves to nothing (recipe emptied or deleted since) must not
    // be zeroed — leave its history alone and report it.
    if (afterUnit === 0 && row.cogsAtTransaction > 0) {
      skippedLines++;
      continue;
    }

    const beforeUnit = row.cogsAtTransaction;
    if (beforeUnit === afterUnit) continue;

    const before = beforeUnit * row.quantity;
    const after = afterUnit * row.quantity;
    lineChanges.push({
      orderId: row.orderId,
      orderItemId: row.orderItemId,
      quantity: row.quantity,
      beforeUnit,
      afterUnit,
    });

    const agg = perOrder.get(row.orderId) ?? { before: 0, after: 0, lines: 0 };
    agg.before += before;
    agg.after += after;
    agg.lines += 1;
    perOrder.set(row.orderId, agg);

    const menu = menus.get(row.recipeId) ?? {
      name: recipeNames.get(row.recipeId) ?? row.recipeId,
      quantity: 0,
      before: 0,
      after: 0,
    };
    menu.quantity += row.quantity;
    menu.before += before;
    menu.after += after;
    menus.set(row.recipeId, menu);
  }

  const scannedOrders = orderRows.map((order) => {
    const agg = perOrder.get(order.id);
    const before = Number(order.totalCogs);
    const after = agg ? agg.after : before;
    const branch = perBranch.get(order.branchId) ?? {
      name: branchNames.get(order.branchId) ?? order.branchId,
      before: 0,
      after: 0,
    };
    branch.before += before;
    branch.after += after;
    perBranch.set(order.branchId, branch);
    return {
      id: order.id,
      branchId: order.branchId,
      day: String(order.day),
      before,
      after,
      lines: agg?.lines ?? 0,
    };
  });

  return {
    orders: scannedOrders,
    lineChanges,
    menus,
    perBranch,
    itemlessOrders: orderRows.length - ordersWithItems.size,
    skippedLines,
    explainByDay,
  };
}

// ─── Report helpers ────────────────────────────────────────────────────────
const rp = (n: number): string => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const signed = (n: number): string =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}Rp ${Math.round(Math.abs(n)).toLocaleString("id-ID")}`;
const pad = (s: string, n: number): string => s.padStart(n);

console.log(`\n=== Target: ${targetLabel} ===`);
console.log(`Range (Asia/Jakarta): ${FROM} .. ${TO} — non-void, non-deleted orders\n`);

const before = await scan();

const dayTotals = new Map<string, DayTotal>();
for (const order of before.orders) {
  const day = dayTotals.get(order.day) ?? { day: order.day, orders: 0, before: 0, after: 0 };
  day.orders += 1;
  day.before += order.before;
  day.after += order.after;
  dayTotals.set(order.day, day);
}

console.log("Tanggal       Order   HPP sekarang        HPP setelah         Selisih");
for (const day of [...dayTotals.values()].sort((a, b) => a.day.localeCompare(b.day))) {
  console.log(
    `${day.day.padEnd(12)} ${pad(String(day.orders), 6)}   ${pad(rp(day.before), 17)}   ${pad(
      rp(day.after),
      17,
    )}   ${pad(signed(day.after - day.before), 16)}`,
  );
}

const topMenus = [...before.menus.values()]
  .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
  .slice(0, 10);
if (topMenus.length > 0) {
  console.log("\nMenu yang berubah (terbesar dulu):");
  for (const menu of topMenus) {
    console.log(
      `  ${menu.name.slice(0, 44).padEnd(44)} ${pad(`${menu.quantity}x`, 4)}  ${pad(
        rp(menu.before),
        15,
      )} → ${pad(rp(menu.after), 15)}`,
    );
  }
}

console.log("\nPer cabang:");
for (const branch of [...before.perBranch.values()].sort((a, b) => a.after - b.after)) {
  console.log(
    `  ${branch.name.padEnd(28)} ${pad(rp(branch.before), 15)} → ${pad(rp(branch.after), 15)}  ${signed(
      branch.after - branch.before,
    )}`,
  );
}

const totalBefore = before.orders.reduce((s, o) => s + o.before, 0);
const totalAfter = before.orders.reduce((s, o) => s + o.after, 0);
const touchedOrders = new Set(before.lineChanges.map((c) => c.orderId)).size;

if (EXPLAIN && before.explainByDay.size > 0) {
  console.log(`\nPorsi ${EXPLAIN}:`);
  let qtyTotal = 0;
  let badTotal = 0;
  for (const [day, qty] of [...before.explainByDay.entries()].sort()) {
    const bad = EXPLAIN_BAD_COST > 0 ? qty * EXPLAIN_BAD_COST : 0;
    qtyTotal += qty;
    badTotal += bad;
    console.log(
      `  ${day}  ${qty.toLocaleString("id-ID")} unit  ·  sekarang ${rp(qty)}${
        EXPLAIN_BAD_COST > 0 ? `  ·  pada Rp ${EXPLAIN_BAD_COST}/unit ${rp(bad)}` : ""
      }`,
    );
  }
  if (EXPLAIN_BAD_COST > 0) {
    console.log(
      `  Total  ${qtyTotal.toLocaleString("id-ID")} unit  ·  kelebihan ${signed(badTotal - qtyTotal)}`,
    );
  }
}

console.log(
  `\nRingkasan: ${before.lineChanges.length} baris di ${touchedOrders} order · ${before.itemlessOrders} order tanpa rincian item (dibiarkan) · ${before.skippedLines} baris dilewati (komposisi kosong)`,
);
console.log(`Total: ${rp(totalBefore)} → ${rp(totalAfter)}  (${signed(totalAfter - totalBefore)})`);
console.log(`(${fallbackLines} baris di-resolve dari BOM hidup — belum ada snapshot ADR-0020)`);

if (JSON_PATH) {
  writeFileSync(
    JSON_PATH,
    JSON.stringify(
      {
        target: targetLabel,
        from: FROM,
        to: TO,
        applied: APPLY,
        days: [...dayTotals.values()],
        lines: before.lineChanges,
      },
      null,
      2,
    ),
  );
  console.log(`Detail per baris ditulis ke ${JSON_PATH}`);
}

if (before.lineChanges.length === 0) {
  console.log("\nTidak ada yang perlu diperbaiki.");
  process.exit(0);
}

if (!APPLY) {
  console.log(
    `\nDRY RUN — tidak ada yang ditulis. Jalankan ulang dengan --apply untuk menulis ${before.lineChanges.length} baris.`,
  );
  process.exit(0);
}

// ─── Apply ─────────────────────────────────────────────────────────────────
const perOrderAfter = new Map<string, number>();
for (const change of before.lineChanges) {
  perOrderAfter.set(
    change.orderId,
    (perOrderAfter.get(change.orderId) ?? 0) + change.afterUnit * change.quantity,
  );
}

await db.transaction(async (tx) => {
  for (const change of before.lineChanges) {
    await tx
      .update(orderItems)
      .set({ cogsAtTransaction: change.afterUnit })
      .where(eq(orderItems.id, change.orderItemId));
  }
  for (const [orderId, total] of perOrderAfter) {
    await tx.update(orders).set({ totalCogs: total }).where(eq(orders.id, orderId));
  }
});

console.log(`\nDiterapkan: ${before.lineChanges.length} baris, ${perOrderAfter.size} order.`);

// ─── Verify ────────────────────────────────────────────────────────────────
// (a) the day totals read back as predicted, (b) every touched order equals
// Σ(item × qty) — the invariant the ledger and the drill-down rely on.
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
const rereadTotal = reread.reduce((s, o) => s + Number(o.totalCogs), 0);

const mismatched = await db
  .select({ id: orders.id })
  .from(orders)
  .where(
    and(
      ne(orders.status, "Void"),
      isNull(orders.deletedAt),
      sql`${posDay} >= ${FROM}`,
      sql`${posDay} <= ${TO}`,
      sql`${orders.totalCogs} <> (SELECT COALESCE(SUM(oi.cogs_at_transaction * oi.quantity), 0) FROM order_items oi WHERE oi.order_id = ${orders.id})`,
    ),
  );

console.log(`Verifikasi: HPP terbaca ${rp(rereadTotal)} (diharapkan ${rp(totalAfter)})`);
console.log(
  mismatched.length === 0
    ? "Verifikasi: setiap order = Σ(baris × qty). OK."
    : `PERINGATAN: ${mismatched.length} order tidak cocok dengan Σ barisnya — periksa manual.`,
);

if (rereadTotal !== totalAfter || mismatched.length > 0) process.exitCode = 1;
process.exit(process.exitCode ?? 0);
