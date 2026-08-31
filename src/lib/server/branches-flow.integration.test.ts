/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Branches full-flow integration test.
 *
 * Drives the real user-parameterized cores from `branches.ts`
 * (`createBranchCore`, `updateBranchCore`, `deleteBranchCore`) against the
 * local dockerized test Postgres. Each core is the exact business logic the
 * `createServerFn` transport endpoint runs — the only thing bypassed is
 * `requireRole()` (HTTP session), replaced by an explicit `user` argument per
 * call, so role guards and the global PIN-uniqueness rule are fully exercised.
 * All cores throw on failure.
 *
 * Lifecycle: create (Central/Outlet) → update → delete (soft: active = false).
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked to return a drizzle instance over a connection to the
 * local test database, and shared tables are TRUNCATE-d between tests.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/branches-flow.integration.test.ts
 */

import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";
import type { TestDb } from "./integration-test-harness";
import { setupFlowHarness } from "./integration-test-harness";
import type { AppUser, UserRole } from "./auth";

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

vi.mock("#/lib/server/auth", () => ({
  requireAuth: async () => {
    throw new Error("requireAuth should not be called — cores receive an explicit user");
  },
  requireRole: async () => {
    throw new Error("requireRole should not be called — cores receive an explicit user");
  },
}));

setupFlowHarness(dbHolder);

let db: TestDb;
let branchesApi: typeof import("./branches");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

async function seedUser(role: UserRole, pin?: string): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@pos.test`,
    role,
    pin,
  });
  return { id, email: `its-${id}@pos.test`, name: `ITS ${role}`, role, status: "Active" };
}

async function branchActive(id: string): Promise<boolean | null> {
  const [row] = await db
    .select({ active: schema.branches.active })
    .from(schema.branches)
    .where(eq(schema.branches.id, id))
    .limit(1);
  return row?.active ?? null;
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  branchesApi = await import("./branches");
});

describe("Branches — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create → update → soft-delete, with PIN uniqueness enforced",
    async () => {
      const superAdmin = await seedUser("super_admin");

      // 1. Create — Central + Outlet with a PIN
      const central = await branchesApi.createBranchCore(superAdmin, {
        code: uniq("BR-C"),
        name: "Central Warehouse",
        location: "Jakarta",
        type: "Central",
      });
      expect(central.active).toBe(true);
      expect(central.pb1Rate).toBe(11); // default

      const outlet = await branchesApi.createBranchCore(superAdmin, {
        code: uniq("BR-O"),
        name: "Outlet 1",
        location: "Bandung",
        type: "Outlet",
        pin: "1234",
      });
      expect(outlet.pin).toBe("1234");

      // PIN is globally unique — a second branch with the same PIN is refused
      await expect(
        branchesApi.createBranchCore(superAdmin, {
          code: uniq("BR-X"),
          name: "Outlet 2",
          location: "Bandung",
          type: "Outlet",
          pin: "1234",
        }),
      ).rejects.toThrow("PIN sudah digunakan oleh cabang/staf lain");

      // A user with the same PIN also blocks the branch PIN
      await seedUser("branch_admin", "9999");
      await expect(
        branchesApi.createBranchCore(superAdmin, {
          code: uniq("BR-Y"),
          name: "Outlet 3",
          location: "Bogor",
          type: "Outlet",
          pin: "9999",
        }),
      ).rejects.toThrow("PIN sudah digunakan oleh cabang/staf lain");

      // 2. Update — name + pb1Rate; keeping own PIN is fine (self excluded)
      const updated = await branchesApi.updateBranchCore(superAdmin, {
        id: outlet.id,
        name: "Outlet 1 Renovated",
        pb1Rate: 5,
      });
      expect(updated.name).toBe("Outlet 1 Renovated");
      expect(updated.pb1Rate).toBe(5);

      await branchesApi.updateBranchCore(superAdmin, { id: outlet.id, pin: "1234" });

      // 3. Delete — soft: active flips to false, row preserved
      const deleted = await branchesApi.deleteBranchCore(superAdmin, { id: outlet.id });
      expect(deleted.success).toBe(true);
      expect(await branchActive(outlet.id)).toBe(false);
      expect(await branchActive(central.id)).toBe(true);
    },
  );
});

describe("Branches — wrong-role and not-found negatives", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create/update/delete reject non-central roles; missing branches are refused",
    async () => {
      const superAdmin = await seedUser("super_admin");
      const branchAdmin = await seedUser("branch_admin");
      const areaManager = await seedUser("area_manager");
      const kitchen = await seedUser("central_kitchen");

      const createInput = {
        code: uniq("BR-N"),
        name: "Outlet N",
        location: "Test",
        type: "Outlet" as const,
      };

      for (const wrong of [branchAdmin, areaManager, kitchen]) {
        await expect(branchesApi.createBranchCore(wrong, createInput)).rejects.toThrow(
          "Forbidden: insufficient role",
        );
      }

      const branch = await branchesApi.createBranchCore(superAdmin, createInput);

      await expect(
        branchesApi.updateBranchCore(branchAdmin, { id: branch.id, name: "x" }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(branchesApi.deleteBranchCore(areaManager, { id: branch.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      // No side effects
      expect(await branchActive(branch.id)).toBe(true);

      // Not found
      const missing = crypto.randomUUID();
      await expect(
        branchesApi.updateBranchCore(superAdmin, { id: missing, name: "x" }),
      ).rejects.toThrow("Branch not found");
      await expect(branchesApi.deleteBranchCore(superAdmin, { id: missing })).rejects.toThrow(
        "Branch not found",
      );
    },
  );
});
