import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { auth } from "#/lib/auth";
import { db } from "#/lib/server/db";
import { areaManagerBranches, periodLogs } from "#/db/schema";
import { eq, desc } from "drizzle-orm";

export type UserRole =
  | "super_admin"
  | "admin_pusat"
  | "area_manager"
  | "branch_admin"
  | "central_kitchen";

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  branchId?: string;
  assignedBranches?: string[];
  pin?: string;
  status: "Active" | "Inactive";
}

const validRoles: UserRole[] = [
  "super_admin",
  "admin_pusat",
  "area_manager",
  "branch_admin",
  "central_kitchen",
];

function parseUser(baUser: {
  id: string;
  email: string;
  name: string;
  role: string | undefined;
  branchId?: string;
  pin?: string;
  status: string;
}): AppUser {
  if (!baUser.role || !validRoles.includes(baUser.role as UserRole)) {
    // Fail loudly instead of silently downgrading to branch_admin.
    // A missing role means the session is corrupt or the user row is broken.
    console.error(
      `[auth] User ${baUser.id} (${baUser.email}) has invalid role: "${baUser.role}". ` +
        `Session may be stale or the user row is missing the role column.`,
    );
    throw new Error(
      `Auth integrity error: user ${baUser.id} has no valid role (got "${baUser.role ?? "<missing>"}"). ` +
        `Please re-login. If this persists, check that the users table has a role column.`,
    );
  }
  return {
    id: baUser.id,
    email: baUser.email,
    name: baUser.name,
    role: baUser.role as UserRole,
    branchId: baUser.branchId,
    pin: baUser.pin,
    status: baUser.status === "Inactive" ? "Inactive" : "Active",
  };
}

export const getCurrentUserRaw = createServerOnlyFn(async (): Promise<AppUser | null> => {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();

  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) return null;

  // session.user already contains all columns from the `users` table
  // (because `users` IS the better-auth user table after the merge).
  // Custom fields like role, branchId, pin, status are available directly.
  const baUser = session.user as unknown as {
    id: string;
    email: string | null;
    name: string | null;
    role: string | undefined;
    branchId?: string;
    pin?: string;
    status: string;
  };

  const appUser = parseUser({
    id: baUser.id,
    email: baUser.email ?? "",
    name: baUser.name ?? "",
    role: baUser.role,
    branchId: baUser.branchId ?? undefined,
    pin: baUser.pin ?? undefined,
    status: baUser.status ?? "Active",
  });

  if (appUser.role === "area_manager") {
    const amBranches = await db
      .select({ branchId: areaManagerBranches.branchId })
      .from(areaManagerBranches)
      .where(eq(areaManagerBranches.userId, session.user.id));

    appUser.assignedBranches = amBranches.map((b) => b.branchId);
  }

  return appUser;
});

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  return getCurrentUserRaw();
});

export const requireAuth = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getCurrentUserRaw();
  if (!user) throw new Error("Unauthorized");
  return user;
});

export const requireRole = createServerOnlyFn(
  async (...allowedRoles: UserRole[]): Promise<AppUser> => {
    const user = await getCurrentUserRaw();
    if (!user) throw new Error("Unauthorized");
    if (!allowedRoles.includes(user.role)) {
      throw new Error(
        `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: ${allowedRoles.join(" | ")})`,
      );
    }
    return user;
  },
);

export async function requireOpenPeriod(user: AppUser): Promise<void> {
  if (user.role === "super_admin") return;

  const [latestPeriod] = await db
    .select()
    .from(periodLogs)
    .orderBy(desc(periodLogs.openedAt))
    .limit(1);

  if (!latestPeriod || latestPeriod.status !== "Open") {
    throw new Error("Periode sedang ditutup. Hanya Super Admin yang dapat mengedit.");
  }
}
