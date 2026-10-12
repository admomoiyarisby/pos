import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";
import type { TestDb } from "./integration-test-harness";
import { setupFlowHarness } from "./integration-test-harness";
import type { AppUser, UserRole } from "./auth";

/* oxlint-disable anti-slop/no-console -- the drift report is the point of a failing run */
/**
 * Branch catalog parity.
 *
 * "The branch catalog" was recomputed in four different places — the ingredient
 * master (gated by the caller's ROLE), the stock opname trigger (gated by the
 * branch TYPE), and the inventory list (gated by branch type, with an
 * `includeNonCatalog` bypass) — and only two of them applied the
 * `ingredient_branches` allow-list. Each definition drifted on its own, so a
 * line could be on a branch's count sheet and absent from its ingredient list,
 * or hidden from both while the branch held the stock.
 *
 * These tests pin ONE rule and force every read to agree with it:
 *
 *   SO lines = branch catalog ∩ { countable = true, status <> 'Deleted' }
 *
 * where the branch catalog is
 *
 *   ( branch.type <> 'Outlet' OR ingredients.is_branch_visible )
 *   AND the ingredient_branches allow-list for this branch
 *
 * The `countable` / `Deleted` halves are not drift: ADR 0001 decision 6 makes
 * them opname-only rules, and ADR 0009 makes `Deleted` a tombstone. The flag
 * gate and the link clause ARE catalog scope, so they must match everywhere.
 *
 * Run: TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/ingredient-catalog-parity.integration.test.ts
 */

const testDatabaseUrl = getTestDatabaseUrl();
const hasTestDatabaseUrl = Boolean(testDatabaseUrl);

const dbHolder = vi.hoisted(() => ({
  // SAFETY: setupFlowHarness(dbHolder) assigns dbHolder.db in beforeAll before any test reads it.
  db: undefined as TestDb | undefined,
}));

vi.mock("#/lib/server/db", () => ({
  get db() {
    if (!dbHolder.db) throw new Error("db holder not initialized — beforeAll must run first");
    return dbHolder.db;
  },
}));

// The cores receive an explicit user, so requireAuth must never be called.
vi.mock("#/lib/server/auth", () => ({
  requireAuth: async () => {
    throw new Error("requireAuth should not be called — cores receive an explicit user");
  },
  requireRole: async () => {
    throw new Error("requireRole should not be called — cores receive an explicit user");
  },
  getCurrentUserRaw: async () => {
    throw new Error("getCurrentUserRaw should not be called — cores receive an explicit user");
  },
}));

setupFlowHarness(dbHolder);

let db: TestDb;
let inv: typeof import("./inventory");
let ing: typeof import("./ingredients");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

async function seedBranch(code: string, type: "Central" | "Outlet" = "Central"): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.branches).values({ id, code, name: `CP ${code}`, location: "Test", type });
  return id;
}

type IngredientOpts = {
  isBranchVisible?: boolean;
  countable?: boolean;
  status?: "Active" | "Inactive" | "Deleted";
};

async function seedIngredient(code: string, opts: IngredientOpts = {}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.ingredients).values({
    id,
    code,
    name: `Ingredient ${code}`,
    category: "Fresh",
    skuType: "RM",
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 1000,
    isBranchVisible: opts.isBranchVisible ?? false,
    countable: opts.countable ?? true,
    status: opts.status ?? "Active",
  });
  return id;
}

/** Restrict an ingredient to specific branches (the `ingredient_branches` allow-list). */
async function seedBranchLinks(ingredientId: string, branchIds: string[]) {
  if (branchIds.length === 0) return;
  await db
    .insert(schema.ingredientBranches)
    .values(branchIds.map((branchId) => ({ ingredientId, branchId })));
}

async function seedUser(role: UserRole, branchId?: string): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db
    .insert(schema.users)
    .values({ id, name: `CP ${role}`, email: `cp-${id}@pos.test`, role, branchId });
  return {
    id,
    email: `cp-${id}@pos.test`,
    name: `CP ${role}`,
    role,
    branchId,
    status: "Active",
  };
}

/** The SO line for one ingredient, when a test seeded several of them. */
async function firstItem(soId: string, ingredientId: string) {
  const [row] = await db
    .select()
    .from(schema.stockOpnameItems)
    .where(
      and(
        eq(schema.stockOpnameItems.stockOpnameId, soId),
        eq(schema.stockOpnameItems.ingredientId, ingredientId),
      ),
    )
    .limit(1);
  if (!row) throw new Error(`no SO line for ingredient ${ingredientId} in ${soId}`);
  return row;
}

/** The ingredient ids a triggered SO put on the branch's count sheet. */
async function soLineIds(soId: string): Promise<string[]> {
  const rows = await db
    .select({ ingredientId: schema.stockOpnameItems.ingredientId })
    .from(schema.stockOpnameItems)
    .where(eq(schema.stockOpnameItems.stockOpnameId, soId));
  return rows.map((r) => r.ingredientId).sort();
}

/** The ingredient ids the branch's own ingredient list shows. */
async function masterCatalogIds(user: AppUser): Promise<string[]> {
  const rows = await ing.getIngredientsCore(user, {});
  return rows.map((r) => r.id).sort();
}

/** A stock record, so the old inventory-driven scope has a row to find. */
async function seedInventory(branchId: string, ingredientId: string, quantity: number) {
  await db.insert(schema.inventory).values({ branchId, ingredientId, quantity });
}

afterEach(() => {
  vi.useRealTimers();
});

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  inv = await import("./inventory");
  ing = await import("./ingredients");
});

describe("branch catalog parity — every branch-scoped read must agree", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "an outlet's stock opname counts its catalog AND everything it physically holds",
    async () => {
      const outlet = await seedBranch(uniq("CP-OUT"), "Outlet");
      const otherOutlet = await seedBranch(uniq("CP-OTHR"), "Outlet");

      // Catalog member, held here and unrestricted.
      const inCatalog = await seedIngredient(uniq("CP-IN"), { isBranchVisible: true });
      // Catalog member, never received at this branch: a real count line at 0.
      const neverStocked = await seedIngredient(uniq("CP-NOSTK"), { isBranchVisible: true });
      // Flagged out of the catalog, never stocked here: NOT counted.
      const flaggedOutNotHeld = await seedIngredient(uniq("CP-FALSN"), {
        isBranchVisible: false,
      });
      // Flagged out of the catalog, but the branch HOLDS it: counted + marked.
      const flaggedOutHeld = await seedIngredient(uniq("CP-FALSE"), { isBranchVisible: false });
      await seedInventory(outlet, flaggedOutHeld, 12);
      // Catalog member, unrestricted by links.
      const unrestricted = await seedIngredient(uniq("CP-UNR"), { isBranchVisible: true });
      // Catalog member whose allow-list names a DIFFERENT branch. It IS held
      // here so it is still counted, but its flag is TRUE: counted WITHOUT a
      // marker. Documented edge: the marker reports the flag, not the link.
      const linkedAway = await seedIngredient(uniq("CP-AWAY"), { isBranchVisible: true });
      await seedBranchLinks(linkedAway, [otherOutlet]);
      await seedInventory(outlet, linkedAway, 3);
      // Catalog member whose allow-list names THIS branch.
      const linkedHere = await seedIngredient(uniq("CP-HERE"), { isBranchVisible: true });
      await seedBranchLinks(linkedHere, [outlet]);
      // Excluded by the opname-only rules, not by catalog scope.
      const deleted = await seedIngredient(uniq("CP-DEL"), {
        isBranchVisible: true,
        status: "Deleted",
      });
      const nonCountable = await seedIngredient(uniq("CP-NCT"), {
        isBranchVisible: true,
        countable: false,
      });
      // Flagged out, held here, but caught by an opname-only rule.
      const nonCountableHeld = await seedIngredient(uniq("CP-NCTH"), {
        isBranchVisible: false,
        countable: false,
      });
      await seedInventory(outlet, nonCountableHeld, 9);
      const deletedHeld = await seedIngredient(uniq("CP-DELH"), {
        isBranchVisible: false,
        status: "Deleted",
      });
      await seedInventory(outlet, deletedHeld, 4);

      // Only the held items need a stock record — the catalog half of the scope
      // must not depend on one.
      for (const ingredientId of [inCatalog, unrestricted, linkedHere]) {
        await seedInventory(outlet, ingredientId, 7);
      }

      const ba = await seedUser("branch_admin", outlet);
      const so = await inv.triggerStockOpnameCore(ba, { branchId: outlet, date: "2026-08-25" });

      // SO lines = the branch catalog UNION everything the branch holds, minus
      // the opname-only exclusions (countable, not Deleted).
      const expected = [
        inCatalog,
        neverStocked,
        unrestricted,
        linkedHere,
        linkedAway,
        flaggedOutHeld,
      ];
      const lines = await soLineIds(so.id);
      expect(lines).toEqual(expected.sort());

      // The marker names exactly one of them: flagged out of the catalog, but
      // physically held.
      const detail = await inv.getStockOpnameDetailCore(ba, { id: so.id });
      const marked =
        detail?.items.filter((i) => i.outsideBranchCatalog).map((i) => i.ingredientId) ?? [];
      expect(marked).toEqual([flaggedOutHeld]);
      expect(detail?.outsideCatalogCount).toBe(1);

      // Not counted, in any guise.
      for (const id of [flaggedOutNotHeld, nonCountableHeld, deletedHeld, nonCountable, deleted]) {
        expect(lines).not.toContain(id);
      }

      // The held-but-uncatalogued line is a real count line at its real stock.
      const held = await firstItem(so.id, flaggedOutHeld);
      expect(held.systemStock).toBe(12);
      expect(held.countedAt).toBeNull();
      // The catalog member with no record at all is still a line, at 0.
      expect((await firstItem(so.id, neverStocked)).systemStock).toBe(0);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "a central stock opname lists every countable active ingredient, flag and links aside",
    async () => {
      const central = await seedBranch(uniq("CP-CEN"));
      const outlet = await seedBranch(uniq("CP-CENOUT"), "Outlet");

      const plain = await seedIngredient(uniq("CP-C-PLAIN"));
      const branchVisible = await seedIngredient(uniq("CP-C-VIS"), { isBranchVisible: true });
      const neverStocked = await seedIngredient(uniq("CP-C-NOSTK"));
      const linkedAway = await seedIngredient(uniq("CP-C-AWAY"));
      await seedBranchLinks(linkedAway, [outlet]);
      const deleted = await seedIngredient(uniq("CP-C-DEL"), { status: "Deleted" });
      const nonCountable = await seedIngredient(uniq("CP-C-NCT"), { countable: false });

      // Only some of them have stock records — the scope must not depend on it.
      await seedInventory(central, plain, 10);
      await seedInventory(central, linkedAway, 20);

      const superAdmin = await seedUser("super_admin");
      const so = await inv.triggerStockOpnameCore(superAdmin, {
        branchId: central,
        date: "2026-08-25",
      });

      // Central scope is everything countable and not tombstoned: the outlet
      // flag does not gate a central branch, and the link table only narrows an
      // ingredient to the branches it names — a link naming an Outlet does not
      // remove it from the central warehouse's sheet.
      expect(await soLineIds(so.id)).toEqual(
        [plain, branchVisible, neverStocked, linkedAway].sort(),
      );
      // Parity with a central user's own list (no countable filter there).
      const catalogIds = (await masterCatalogIds(superAdmin)).filter((id) => id !== nonCountable);
      expect(await soLineIds(so.id)).toEqual(catalogIds);
      void deleted;
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "the catalog-gap report lists exactly the items an outlet holds but the catalog hides",
    async () => {
      const outletCode = uniq("CP-G-OUT");
      const otherOutletCode = uniq("CP-G-OTHR");
      const outlet = await seedBranch(outletCode, "Outlet");
      const otherOutlet = await seedBranch(otherOutletCode, "Outlet");
      const central = await seedBranch(uniq("CP-G-CEN"));
      const outletName = `CP ${outletCode}`;
      const otherOutletName = `CP ${otherOutletCode}`;

      // Flag FALSE + countable + stocked at outlets → a gap.
      const hidden = await seedIngredient(uniq("CP-G-HIDE"), { isBranchVisible: false });
      await seedInventory(outlet, hidden, 7);
      await seedInventory(otherOutlet, hidden, 13);
      // Flag FALSE, countable, but never stocked at an outlet → not a gap.
      const notStocked = await seedIngredient(uniq("CP-G-NOSTK"), { isBranchVisible: false });
      // Flag FALSE, but stock sits at a Central branch → not a gap.
      const centralStock = await seedIngredient(uniq("CP-G-CENT"), { isBranchVisible: false });
      await seedInventory(central, centralStock, 5);
      // Flag TRUE → in the catalog, so not a gap.
      const visible = await seedIngredient(uniq("CP-G-VIS"), { isBranchVisible: true });
      await seedInventory(outlet, visible, 4);
      // Flag FALSE but tombstoned → not a gap.
      const deleted = await seedIngredient(uniq("CP-G-DEL"), {
        isBranchVisible: false,
        status: "Deleted",
      });
      await seedInventory(outlet, deleted, 9);
      // Flag FALSE but not countable → excluded from opnames by design
      // (ADR 0001 §6), so not a gap either.
      const notCountable = await seedIngredient(uniq("CP-G-NCT"), {
        isBranchVisible: false,
        countable: false,
      });
      await seedInventory(outlet, notCountable, 3);

      const gaps = await ing.getBranchCatalogGapsCore();

      expect(gaps).toHaveLength(1);
      const only = gaps[0]!;
      expect(only.ingredientId).toBe(hidden);
      expect(only.outletCount).toBe(2);
      // Both outlet names are listed, so the operator knows where the stock is.
      expect(only.outlets).toContain(outletName);
      expect(only.outlets).toContain(otherOutletName);
      // 7 + 13, summed across the two outlets.
      expect(only.totalQuantity).toBeCloseTo(20, 5);
      // The other seeded ingredients must not appear under any guise.
      expect(gaps.map((g) => g.ingredientId)).not.toContain(notStocked);
      expect(gaps.map((g) => g.ingredientId)).not.toContain(centralStock);
      expect(gaps.map((g) => g.ingredientId)).not.toContain(visible);
      expect(gaps.map((g) => g.ingredientId)).not.toContain(deleted);
      expect(gaps.map((g) => g.ingredientId)).not.toContain(notCountable);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "a branch_admin at a CENTRAL branch sees everything — list and sheet agree",
    async () => {
      // A branch_admin is assigned to a Central-type branch: the Central
      // Warehouse has one in production (Eva). The warehouse is precisely the
      // branch that HOLDS the central-only items, so both surfaces must be
      // unfiltered there. Keying the ingredient list on the ROLE alone (the old
      // behaviour) hid them from the one person who needs to move them — 52 of
      // the 135 countable items her warehouse held were unselectable in the
      // Mutasi transfer form, while her count sheet listed all of them.
      const central = await seedBranch(uniq("CP-CK"), "Central");
      const centralOnly = await seedIngredient(uniq("CP-CK-ONLY"), { isBranchVisible: false });
      const branchVisible = await seedIngredient(uniq("CP-CK-VIS"), { isBranchVisible: true });
      await seedInventory(central, centralOnly, 5);
      await seedInventory(central, branchVisible, 6);

      const ckAdmin = await seedUser("branch_admin", central);

      // The ingredient list is unfiltered for a Central branch …
      expect(await masterCatalogIds(ckAdmin)).toEqual([centralOnly, branchVisible].sort());
      // … and the opname agrees with it, item for item. That agreement is the
      // point: the two surfaces answer from the same key.
      const so = await inv.triggerStockOpnameCore(ckAdmin, {
        branchId: central,
        date: "2026-08-25",
      });
      expect(await soLineIds(so.id)).toEqual(await masterCatalogIds(ckAdmin));
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "a branch_admin at an OUTLET still sees only that outlet's catalog",
    async () => {
      // The other side of the same gate: 33 of the 34 branch_admins in
      // production are at outlets, and for them role and branch type agreed
      // already. Their list must stay narrowed — an outlet neither holds nor
      // counts the central-only items.
      const outlet = await seedBranch(uniq("CP-RO"), "Outlet");
      const branchVisible = await seedIngredient(uniq("CP-RO-VIS"), { isBranchVisible: true });
      // Held at the outlet and flagged off: still absent from the admin's list.
      await seedIngredient(uniq("CP-RO-ONLY"), { isBranchVisible: false });
      await seedInventory(outlet, branchVisible, 5);

      const outletAdmin = await seedUser("branch_admin", outlet);
      expect(await masterCatalogIds(outletAdmin)).toEqual([branchVisible].sort());
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "a non-branch_admin is unfiltered whatever branch they sit at",
    async () => {
      // Deliberately NOT switched to pure branch-type gating: an area_manager
      // covering an outlet is a supervisor and must still see every ingredient
      // to approve, order, and troubleshoot. Only the branch_admin role, whose
      // single branch defines what it can actually stock, gets the gate.
      const outlet = await seedBranch(uniq("CP-AM"), "Outlet");
      const centralOnly = await seedIngredient(uniq("CP-AM-ONLY"), { isBranchVisible: false });
      const branchVisible = await seedIngredient(uniq("CP-AM-VIS"), { isBranchVisible: true });

      const areaManager = await seedUser("area_manager", outlet);
      expect(await masterCatalogIds(areaManager)).toEqual([centralOnly, branchVisible].sort());
    },
  );
});
