import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
if (typeof import.meta.env === "undefined") (import.meta as any).env = { SSR: true };
else if (!(import.meta as any).env.SSR) (import.meta as any).env.SSR = true;

const { db } = await import("../src/lib/server/db.js");
const { orders, periodLogs, stockLedger } = await import("../src/db/schema.js");
const { sql, desc } = await import("drizzle-orm");

// 1. WASTE entries
const waste = await db.select().from(stockLedger).where(sql`reference LIKE 'WASTE%'`).limit(5);
console.log("WASTE ledger (should be OUT):");
waste.forEach((e) => console.log(`  ${e.reference} → ${e.type}`));

// 2. Periods
const periods = await db.select().from(periodLogs).orderBy(periodLogs.openedAt);
console.log("Periods:", periods.map((p) => `${p.periodName}(${p.status})`));

// 3. Recent orders
const recent = await db
  .select({ createdAt: orders.createdAt, status: orders.status })
  .from(orders)
  .orderBy(desc(orders.createdAt))
  .limit(5);
console.log("Most recent orders:");
recent.forEach((o) => console.log(`  ${o.createdAt} ${o.status}`));

process.exit(0);
