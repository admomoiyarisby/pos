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
  role: string;
  branchId?: string;
  pin?: string;
  status: string;
}): AppUser {
  const role = validRoles.includes(baUser.role as UserRole)
    ? (baUser.role as UserRole)
    : "branch_admin";
  return {
    id: baUser.id,
    email: baUser.email,
    name: baUser.name,
    role,
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
    role: string;
    branchId?: string;
    pin?: string;
    status: string;
  };

  const appUser = parseUser({
    id: baUser.id,
    email: baUser.email ?? "",
    name: baUser.name ?? "",
    role: baUser.role ?? "branch_admin",
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
      throw new Error("Forbidden: insufficient role");
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
