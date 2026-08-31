/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Users (account management) full-flow integration test.
 *
 * Drives the real user-parameterized cores from `users.ts` (`createUserCore`,
 * `updateUserCore`) against the local dockerized test Postgres. Each core is
 * the exact business logic the `createServerFn` transport endpoint runs — the
 * only thing bypassed is `requireRole()` (HTTP session), replaced by an
 * explicit `user` argument per call, so the super_admin-only guard and the
 * role/branch validation rules are fully exercised. All cores throw on failure.
 *
 * Lifecycle: create (super_admin-only; branch admins must have a branch, area
 * managers at least one assigned branch; writes the user row + better-auth
 * credential account + AM branch links) → update (name/status/assignedBranches
 * replaced atomically).
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked to return a drizzle instance over a connection to the
 * local test database, and shared tables are TRUNCATE-d between tests.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/users-flow.integration.test.ts
 */

import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
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
let usersApi: typeof import("./users");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

async function seedBranch(code: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.branches).values({
    id,
    code,
    name: `ITS ${code}`,
    location: "Test",
    type: "Outlet",
  });
  return id;
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

async function amAssignedBranches(userId: string): Promise<string[]> {
  const rows = await db
    .select({ branchId: schema.areaManagerBranches.branchId })
    .from(schema.areaManagerBranches)
    .where(eq(schema.areaManagerBranches.userId, userId));
  return rows.map((r) => r.branchId);
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  usersApi = await import("./users");
});

describe("Users — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create branch admin (user + credential account) and area manager (assigned branches), then update",
    async () => {
      const branchA = await seedBranch(uniq("US-A"));
      const branchB = await seedBranch(uniq("US-B"));
      const superAdmin = await seedUser("super_admin");

      // 1. Create a branch admin — user row + credential account row
      const ba = await usersApi.createUserCore(superAdmin, {
        email: `ba-${uniq("")}@pos.test`,
        password: "password123",
        name: "Branch Admin Satu",
        role: "branch_admin",
        branchId: branchA,
        pin: "1111",
      });
      expect(ba.success).toBe(true);

      const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, ba.userId));
      expect(userRow.role).toBe("branch_admin");
      expect(userRow.branchId).toBe(branchA);
      expect(userRow.pin).toBe("1111");

      // The credential account (better-auth password store) is created too
      const [account] = await db
        .select()
        .from(schema.account)
        .where(
          and(eq(schema.account.userId, ba.userId), eq(schema.account.providerId, "credential")),
        );
      expect(account).toBeTruthy();
      expect(account.issuer).toBe("local:credential");
      expect(account.password).toBeTruthy();

      // 2. Update the branch admin — name + status
      const updated = await usersApi.updateUserCore(superAdmin, {
        id: ba.userId,
        name: "Branch Admin Satu (Updated)",
        status: "Inactive",
      });
      expect(updated.success).toBe(true);
      const [afterUpdate] = await db
        .select({ name: schema.users.name, status: schema.users.status })
        .from(schema.users)
        .where(eq(schema.users.id, ba.userId));
      expect(afterUpdate.name).toBe("Branch Admin Satu (Updated)");
      expect(afterUpdate.status).toBe("Inactive");

      // 3. Create an area manager with assigned branches
      const am = await usersApi.createUserCore(superAdmin, {
        email: `am-${uniq("")}@pos.test`,
        password: "password123",
        name: "Area Manager Satu",
        role: "area_manager",
        assignedBranches: [branchA],
      });
      expect(am.success).toBe(true);
      expect(await amAssignedBranches(am.userId)).toEqual([branchA]);

      // 4. Update the AM's assigned branches — replaced atomically
      await usersApi.updateUserCore(superAdmin, {
        id: am.userId,
        assignedBranches: [branchB],
      });
      expect(await amAssignedBranches(am.userId)).toEqual([branchB]);

      // 5. Demoting the AM drops their branch assignments
      await usersApi.updateUserCore(superAdmin, {
        id: am.userId,
        role: "branch_admin",
        branchId: branchB,
      });
      expect(await amAssignedBranches(am.userId)).toEqual([]);
    },
  );
});

describe("Users — role-scoping and validation negatives", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create/update are super_admin-only; role/branch/PIN rules are enforced",
    async () => {
      const branchA = await seedBranch(uniq("US-NA"));
      const branchB = await seedBranch(uniq("US-NB"));
      const superAdmin = await seedUser("super_admin");
      const adminPusat = await seedUser("admin_pusat");
      const branchAdmin = await seedUser("branch_admin");

      const createInput = {
        email: `x-${uniq("")}@pos.test`,
        password: "password123",
        name: "X",
        role: "branch_admin" as const,
        branchId: branchA,
        pin: "1111",
      };

      // Only super_admin may manage users
      await expect(usersApi.createUserCore(adminPusat, createInput)).rejects.toThrow(
        "Forbidden: insufficient role",
      );
      await expect(usersApi.createUserCore(branchAdmin, createInput)).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      // Area manager needs at least one assigned branch
      await expect(
        usersApi.createUserCore(superAdmin, {
          ...createInput,
          email: `am-${uniq("")}@pos.test`,
          role: "area_manager",
        }),
      ).rejects.toThrow("Area Manager harus memiliki minimal 1 cabang yang dikelola");

      // Branch admin needs a branch
      await expect(
        usersApi.createUserCore(superAdmin, {
          ...createInput,
          email: `ba-${uniq("")}@pos.test`,
          branchId: undefined,
        }),
      ).rejects.toThrow("Branch Admin harus memiliki cabang");

      // Nonexistent branch is refused
      await expect(
        usersApi.createUserCore(superAdmin, {
          ...createInput,
          email: `ba-${uniq("")}@pos.test`,
          branchId: crypto.randomUUID(),
        }),
      ).rejects.toThrow("Cabang yang dipilih tidak ditemukan");

      // A real create, then a duplicate PIN in the same branch is refused
      const first = await usersApi.createUserCore(superAdmin, createInput);
      await expect(
        usersApi.createUserCore(superAdmin, {
          ...createInput,
          email: `ba-${uniq("")}@pos.test`,
          pin: "1111",
        }),
      ).rejects.toThrow("PIN sudah digunakan oleh cabang/staf lain");

      // Update: not found, and non-super-admin is refused
      await expect(
        usersApi.updateUserCore(adminPusat, { id: first.userId, name: "x" }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(
        usersApi.updateUserCore(superAdmin, { id: crypto.randomUUID(), name: "x" }),
      ).rejects.toThrow("User not found");

      // Update to an AM with no branches is refused
      await expect(
        usersApi.updateUserCore(superAdmin, {
          id: first.userId,
          role: "area_manager",
          assignedBranches: [],
        }),
      ).rejects.toThrow("Area Manager harus memiliki minimal 1 cabang yang dikelola");
      void branchB;
    },
  );
});
