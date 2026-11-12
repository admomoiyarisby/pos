// Period-lock guard for writes that change closed-period stock/finance history.
//
// Kept in its own module (not `auth.ts`) so integration tests can mock the
// auth module without losing the guard, and so the guard's only dependency is
// the database.

import { desc } from "drizzle-orm";
import { periodLogs } from "#/db/schema";
import { db } from "#/lib/server/db";

/**
 * - Super Admin may always write (FRD §4.1).
 * - Before the first period has ever been opened there is nothing to lock, so
 *   a fresh install is usable.
 * - Once a period exists, the latest one must be Open. Closing a period without
 *   opening its successor locks non-super-admin edits until it is re-opened.
 *
 * Reads, live POS sales, shifts, printing, notifications and master-data edits
 * are intentionally not gated: the lock protects the accounting period, not
 * day-to-day operation.
 */
export async function requireOpenPeriod(user: { role: string }): Promise<void> {
  if (user.role === "super_admin") return;

  const [latestPeriod] = await db
    .select()
    .from(periodLogs)
    .orderBy(desc(periodLogs.openedAt))
    .limit(1);

  // No period has been opened yet — bootstrap, not a closed period.
  if (!latestPeriod) return;

  if (latestPeriod.status !== "Open") {
    throw new Error("Periode sedang ditutup. Hanya Super Admin yang dapat mengedit.");
  }
}
