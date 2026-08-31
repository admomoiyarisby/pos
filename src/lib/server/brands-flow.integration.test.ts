/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Brands full-flow integration test.
 *
 * Drives the real user-parameterized cores from `brands.ts`
 * (`createBrandCore`, `updateBrandCore`, `deleteBrandCore`) against the local
 * dockerized test Postgres. Each core re-mirrors the wrapper's `requireRole`
 * guard, so wrong-role rejection and the not-found path are fully exercised.
 *
 * Lifecycle: create (Active) → update → delete (soft: status = Inactive).
 * `updateBrand` is a partial update; `deleteBrand` soft-tombstones.
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked and shared tables are TRUNCATE-d between tests.
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/brands-flow.integration.test.ts
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
let brandsApi: typeof import("./brands");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

async function seedUser(role: UserRole): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@pos.test`,
    role,
  });
  return { id, email: `its-${id}@pos.test`, name: `ITS ${role}`, role, status: "Active" };
}

async function brandStatus(id: string): Promise<string | null> {
  const [row] = await db
    .select({ status: schema.brands.status })
    .from(schema.brands)
    .where(eq(schema.brands.id, id))
    .limit(1);
  return row?.status ?? null;
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  brandsApi = await import("./brands");
});

describe("Brands — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)("create → update → soft-delete", async () => {
    const superAdmin = await seedUser("super_admin");

    // 1. Create — new brand is Active
    const brand = await brandsApi.createBrandCore(superAdmin, {
      code: uniq("BR-CODE"),
      name: "Partner Brand",
      logo: "https://img/logo.png",
    });
    expect(brand.name).toBe("Partner Brand");
    expect(brand.status).toBe("Active");

    // 2. Update — name only (partial update leaves code unchanged)
    const updated = await brandsApi.updateBrandCore(superAdmin, {
      id: brand.id,
      name: "Partner Brand Renamed",
    });
    expect(updated.name).toBe("Partner Brand Renamed");
    expect(updated.code).toBe(brand.code);

    // 3. Delete — soft: brand.status flips to Inactive, row preserved
    const deleted = await brandsApi.deleteBrandCore(superAdmin, { id: brand.id });
    expect(deleted.success).toBe(true);
    expect(await brandStatus(brand.id)).toBe("Inactive");
  });
});

describe("Brands — wrong-role and not-found negatives", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create/update/delete reject non-central roles; missing brands are refused",
    async () => {
      const superAdmin = await seedUser("super_admin");
      const branchAdmin = await seedUser("branch_admin");
      const areaManager = await seedUser("area_manager");
      const kitchen = await seedUser("central_kitchen");

      const createInput = { code: uniq("BR-N"), name: "Outlet Brand" };

      for (const wrong of [branchAdmin, areaManager, kitchen]) {
        await expect(brandsApi.createBrandCore(wrong, createInput)).rejects.toThrow(
          "Forbidden: insufficient role",
        );
      }

      const brand = await brandsApi.createBrandCore(superAdmin, createInput);

      await expect(
        brandsApi.updateBrandCore(branchAdmin, { id: brand.id, name: "x" }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(brandsApi.deleteBrandCore(areaManager, { id: brand.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      // No side effects
      expect(await brandStatus(brand.id)).toBe("Active");

      // Not found
      const missing = crypto.randomUUID();
      await expect(
        brandsApi.updateBrandCore(superAdmin, { id: missing, name: "x" }),
      ).rejects.toThrow("Brand not found");
      await expect(brandsApi.deleteBrandCore(superAdmin, { id: missing })).rejects.toThrow(
        "Brand not found",
      );
    },
  );
});
