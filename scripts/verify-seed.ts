import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

// @ts-expect-error — same env-patch as seed-full.ts
if (typeof import.meta.env === "undefined") (import.meta as any).env = { SSR: true };
else if (!(import.meta as any).env.SSR) (import.meta as any).env.SSR = true;

const { db } = await import("../src/lib/server/db.js");
const { stockLedger, recipeIngredients, periodLogs, orders, inventory } = await import(
  "../src/db/schema.js"
);
const { sql } = await import("drizzle-orm");

// 1. WASTE entries — should all be OUT
const waste = await db
  .select()
  .from(stockLedger)
  .where(sql`reference LIKE 'WASTE%'`)
  .limit(5);
console.log("WASTE ledger entries (should be OUT):");
waste.forEach((e) => console.log(`  ${e.reference} → ${e.type}`));

// 2. Recipe ingredients count
const [riCount] = await db.select({ c: sql<number>`count(*)` }).from(recipeIngredients);
console.log(`Recipe ingredient rows: ${riCount.c}`);

// 3. Periods
const periods = await db.select().from(periodLogs).orderBy(periodLogs.openedAt);
console.log("Periods:", periods.map((p) => `${p.periodName}(${p.status})`));

// 4. Orders — check if any are from "today"
const [ordCount] = await db.select({ c: sql<number>`count(*)` }).from(orders);
console.log(`Order rows: ${ordCount.c}`);
const todayStr = new Date().toISOString().slice(0, 10);
const todayOrders = await db
  .select({ c: sql<number>`count(*)` })
  .from(orders)
  .where(sql`DATE(${orders.createdAt}) = ${todayStr}`);
console.log(`Orders from today (${todayStr}): ${todayOrders[0].c}`);

// 5. Inventory count
const [invCount] = await db.select({ c: sql<number>`count(*)` }).from(inventory);
console.log(`Inventory rows: ${invCount.c}`);

process.exit(0);
