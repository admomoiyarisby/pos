/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Vouchers full-flow integration test.
 *
 * Drives the real user-parameterized cores from `vouchers.ts`
 * (`createVoucherCore`, `updateVoucherCore`, `deactivateVoucherCore`,
 * `deleteVoucherCore`) against the local dockerized test Postgres. Each core
 * re-mirrors the wrapper's single-role (`super_admin`) guard, so wrong-role
 * rejection is exercised.
 *
 * Lifecycle: create (Active) → update → deactivate (Inactive) → delete
 * (Deleted). Also covers duplicate-code and wrong-state guards.
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, mocked
 * to a connection over the local test database, tables TRUNCATE-d between tests.
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/vouchers-flow.integration.test.ts
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
let vouchersApi: typeof import("./vouchers");
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

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function voucherStatus(id: string): Promise<string | null> {
  const [row] = await db
    .select({ status: schema.vouchers.status })
    .from(schema.vouchers)
    .where(eq(schema.vouchers.id, id))
    .limit(1);
  return row?.status ?? null;
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  vouchersApi = await import("./vouchers");
});

describe("Vouchers — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create → update → deactivate → delete, with duplicate-code + state guards",
    async () => {
      const superAdmin = await seedUser("super_admin");

      // 1. Create — code normalized to uppercase, status Active
      const code = uniq("SAVE").toUpperCase();
      const voucher = await vouchersApi.createVoucherCore(superAdmin, {
        code,
        description: "Diskon 10rb",
        discountType: "fixed",
        discountValue: 10000,
        validUntil: futureDate(30),
        // zod defaults (minOrder 0, isActive true) applied by the wrapper;
        // the core sees the resolved values.
        minOrder: 0,
        isActive: true,
      });
      expect(voucher.code).toBe(code.toUpperCase());
      expect(voucher.status).toBe("Active");

      // Duplicate code refused
      await expect(
        vouchersApi.createVoucherCore(superAdmin, {
          code: code.toLowerCase(), // normalized to same uppercase
          description: "dup",
          discountType: "fixed",
          discountValue: 1000,
          validUntil: futureDate(30),
          minOrder: 0,
          isActive: true,
        }),
      ).rejects.toThrow(`Kode voucher "${code}" sudah digunakan`);

      // 2. Update — change description + discountValue
      const updated = await vouchersApi.updateVoucherCore(superAdmin, {
        id: voucher.id,
        description: "Diskon 20rb",
        discountValue: 20000,
      });
      expect(updated.description).toBe("Diskon 20rb");
      expect(updated.discountValue).toBe(20000);
      expect(updated.status).toBe("Active");

      // 3. Deactivate → Inactive
      const deact = await vouchersApi.deactivateVoucherCore(superAdmin, { id: voucher.id });
      expect(deact.success).toBe(true);
      expect(await voucherStatus(voucher.id)).toBe("Inactive");

      // Deactivating an already-inactive voucher is refused
      await expect(
        vouchersApi.deactivateVoucherCore(superAdmin, { id: voucher.id }),
      ).rejects.toThrow("Voucher sudah nonaktif atau dihapus");

      // 4. Delete → Deleted (only from Inactive)
      const del = await vouchersApi.deleteVoucherCore(superAdmin, { id: voucher.id });
      expect(del.success).toBe(true);
      expect(await voucherStatus(voucher.id)).toBe("Deleted");

      // Deleting again refused
      await expect(vouchersApi.deleteVoucherCore(superAdmin, { id: voucher.id })).rejects.toThrow(
        "Voucher sudah dihapus",
      );
    },
  );
});

describe("Vouchers — wrong-role and not-found negatives", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "all voucher writes require super_admin; missing vouchers are refused",
    async () => {
      const superAdmin = await seedUser("super_admin");
      const adminPusat = await seedUser("admin_pusat");
      const branchAdmin = await seedUser("branch_admin");

      const valid = {
        code: uniq("NOPE").toUpperCase(),
        description: "x",
        discountType: "fixed" as const,
        discountValue: 1,
        validUntil: futureDate(30),
        minOrder: 0,
        isActive: true,
      };

      for (const wrong of [adminPusat, branchAdmin]) {
        await expect(vouchersApi.createVoucherCore(wrong, valid)).rejects.toThrow(
          "Forbidden: insufficient role",
        );
      }

      const voucher = await vouchersApi.createVoucherCore(superAdmin, valid);

      await expect(
        vouchersApi.updateVoucherCore(adminPusat, { id: voucher.id, description: "y" }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(
        vouchersApi.deactivateVoucherCore(branchAdmin, { id: voucher.id }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(vouchersApi.deleteVoucherCore(adminPusat, { id: voucher.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      // No side effects
      expect(await voucherStatus(voucher.id)).toBe("Active");

      // Not found + deleted-voucher guards
      const missing = crypto.randomUUID();
      await expect(
        vouchersApi.updateVoucherCore(superAdmin, { id: missing, description: "x" }),
      ).rejects.toThrow("Voucher not found");
      await expect(vouchersApi.deactivateVoucherCore(superAdmin, { id: missing })).rejects.toThrow(
        "Voucher not found",
      );
      await expect(vouchersApi.deleteVoucherCore(superAdmin, { id: missing })).rejects.toThrow(
        "Voucher not found",
      );

      // Delete refuses an Active voucher (must deactivate first)
      await expect(vouchersApi.deleteVoucherCore(superAdmin, { id: voucher.id })).rejects.toThrow(
        "Nonaktifkan voucher terlebih dahulu sebelum menghapusnya",
      );
    },
  );
});
