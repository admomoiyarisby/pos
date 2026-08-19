// Runs the full seed-data.ts pipeline against the live DB.
// Equivalent to POSTing /api/seed-data, but as a standalone tsx script
// so it doesn't need the dev server running.
//
// Run:  vp run seed-full
/**
 * Run when SSR=false (e.g. tsx script): we patch import.meta.env to expose
 * SSR=true so the lazy DB init in lib/server/db.ts can run outside Vite.
 * MUST happen before importing anything that transitively pulls in db.ts.
 */
if (!("env" in import.meta)) {
  // SAFETY: in plain-tsx execution import.meta has no `env`; this injects the
  // SSR flag before any Vite-dependent module is imported, matching what the
  // Vite build provides at compile time.
  (import.meta as any).env = { SSR: true };
} else if (
  // SAFETY: in plain-tsx execution import.meta has no `env`; the branch above
  // injected the flag, so this read is safe and only sets it once.
  !(import.meta as any).env.SSR
) {
  // SAFETY: same boundary — tsx gives a bare import.meta; we set the flag once.
  (import.meta as any).env.SSR = true;
}

import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

console.log("[seed-full] running seedDatabase()...");
// Dynamic import so the env-patch above runs first.
const { seedDatabase } = await import("../src/routes/api/seed-data.js");
const result = await seedDatabase();
console.log("[seed-full] result:", JSON.stringify(result, null, 2));

// After the demo seed creates users, load the historical Mulyorejo channel
// revenue from the Pembukuan TENANT Excel. channel_revenues.submitted_by is
// NOT NULL → users.id, so this must run AFTER users exist (which seedDatabase
// guarantees). Safe to run standalone too — it resolves a user or skips.
console.log("[seed-full] loading Mulyorejo channel accounting from Excel...");
const { migrateChannelAccounting } = await import("./migrate-csv/channel-accounting.js");
await migrateChannelAccounting();
console.log("[seed-full] done.");
