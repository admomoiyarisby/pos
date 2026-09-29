import { eq, sql } from "drizzle-orm";
import type { db as DbType } from "./db";
import { branches } from "#/db/schema";

/** Any drizzle handle that can run SELECTs: the module-level `db` or a
 *  transaction handle (FsmTx et al.) passed into an effect. */
export type DbLike = typeof DbType | Parameters<Parameters<typeof DbType.transaction>[0]>[0];

export interface CentralWarehouse {
  id: string;
  code: string;
  name: string;
}

/**
 * Resolve the canonical Central Warehouse — the branch that owns central
 * inventory, ships Surat Jalan, and holds admin_pusat's SO scope.
 *
 * There can be MORE than one branch of type 'Central' (e.g. the Central
 * Warehouse "CENTRAL" plus a food-prep kitchen "CK-FPW" created 2026-09-16
 * with no inventory). The historical `WHERE type = 'Central' LIMIT 1` with no
 * ORDER BY is nondeterministic in that case: Postgres may return the kitchen,
 * which has zero stock, and every downstream "stok pusat" then reads 0 (habis)
 * while the real warehouse holds thousands of units.
 *
 * Resolution: among Central-type branches, prefer the one that actually owns
 * inventory (most inventory rows, then earliest created as a deterministic
 * tiebreak). Falls back to the earliest-created Central when none has stock —
 * a brand-new deployment where the warehouse is legitimately empty.
 *
 * The inventory-row count is safe on transactions too: it is a correlated
 * scalar subquery, so it runs inside the caller's transaction (important for
 * FSM effects whose ship-time stock check must see the same warehouse the
 * display showed).
 */
export async function getCentralWarehouse(dbh: DbLike): Promise<CentralWarehouse | undefined> {
  const rows = await dbh
    .select({
      id: branches.id,
      code: branches.code,
      name: branches.name,
      inventoryRows: sql<number>`(
        select cast(count(*) as integer)
        from inventory
        where inventory.branch_id = ${branches.id}
      )`,
    })
    .from(branches)
    .where(eq(branches.type, "Central"));

  if (rows.length === 0) return undefined;

  // Most inventory rows wins; tiebreak on id so the choice is stable even if
  // created_at ever collides (ids are unique so ordering is always total).
  const ranked = [...rows].sort((a, b) => {
    const diff = Number(b.inventoryRows ?? 0) - Number(a.inventoryRows ?? 0);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
  const best = ranked[0];
  if (Number(best.inventoryRows ?? 0) > 0) return best;

  // No Central branch owns any inventory: use the earliest-created Central
  // (the original warehouse) rather than a recently added satellite.
  const withTime = await dbh
    .select({ id: branches.id, code: branches.code, name: branches.name })
    .from(branches)
    .where(eq(branches.type, "Central"))
    .orderBy(branches.createdAt, branches.id)
    .limit(1);
  return withTime[0];
}

/** `getCentralWarehouse` but throws when no Central branch exists — for the
 *  write paths (ship, yield production, SJ creation) that cannot proceed
 *  without one. */
export async function requireCentralWarehouse(dbh: DbLike): Promise<CentralWarehouse> {
  const central = await getCentralWarehouse(dbh);
  if (!central) throw new Error("No Central branch configured");
  return central;
}
