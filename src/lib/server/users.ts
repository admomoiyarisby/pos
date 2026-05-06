import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import { users as usersTable, areaManagerBranches, branches } from "#/db/schema";
import { eq, ilike, and, ne } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { z } from "zod";
import { auth } from "#/lib/auth";

const userRoleEnum = z.enum([
  "super_admin",
  "admin_pusat",
  "area_manager",
  "branch_admin",
  "central_kitchen",
]);

export const getUsers = createServerFn({ method: "GET" })
  .inputValidator((data: { search?: string; role?: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const conditions = [];
    if (data.search) {
      conditions.push(
        ilike(usersTable.name, `%${data.search}%`),
        ilike(usersTable.email, `%${data.search}%`),
      );
    }
    if (data.role) {
      conditions.push(eq(usersTable.role, data.role as typeof usersTable.$inferSelect.role));
    }

    const result = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        status: usersTable.status,
        branchId: usersTable.branchId,
        pin: usersTable.pin,
        branchName: branches.name,
      })
      .from(usersTable)
      .leftJoin(branches, eq(usersTable.branchId, branches.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(usersTable.name);

    // Fetch assigned branches for area managers
    const userIds = result.map((u) => u.id);
    const amBranches =
      userIds.length > 0
        ? await db
            .select({
              userId: areaManagerBranches.userId,
              branchId: areaManagerBranches.branchId,
              branchName: branches.name,
            })
            .from(areaManagerBranches)
            .leftJoin(branches, eq(areaManagerBranches.branchId, branches.id))
            .where(eq(areaManagerBranches.userId, userIds[0])) // Drizzle doesn't have in-array for multiple, simplify
        : [];

    return result.map((u) => ({
      ...u,
      assignedBranches:
        u.role === "area_manager"
          ? amBranches.filter((ab) => ab.userId === u.id).map((ab) => ab.branchId)
          : undefined,
    }));
  });

export const createUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        name: z.string().min(1),
        role: userRoleEnum,
        branchId: z.string().uuid().optional(),
        pin: z.string().length(4).optional(),
        status: z.enum(["Active", "Inactive"]).optional(),
        assignedBranches: z.array(z.string().uuid()).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireRole("super_admin");

    // Validate PIN uniqueness per branch
    if (data.pin && data.branchId) {
      const [existing] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.pin, data.pin), eq(usersTable.branchId, data.branchId)))
        .limit(1);
      if (existing) {
        throw new Error("PIN sudah digunakan oleh user lain di cabang ini");
      }
    }

    // Create via better-auth
    const baResult = await auth.api.signUpEmail({
      body: {
        email: data.email,
        password: data.password,
        name: data.name,
        role: data.role,
        branchId: data.branchId,
        pin: data.pin,
        status: data.status ?? "Active",
      },
    });

    if (!baResult?.user?.id) {
      throw new Error("Failed to create user in auth system");
    }

    const userId = baResult.user.id;

    // Insert into our users table
    await db
      .insert(usersTable)
      .values({
        id: userId,
        email: data.email,
        name: data.name,
        role: data.role as typeof usersTable.$inferSelect.role,
        branchId: data.branchId,
        pin: data.pin,
        status: (data.status ?? "Active") as typeof usersTable.$inferSelect.status,
      })
      .onConflictDoUpdate({
        target: usersTable.id,
        set: {
          name: data.name,
          role: data.role as typeof usersTable.$inferSelect.role,
          branchId: data.branchId,
          pin: data.pin,
          status: (data.status ?? "Active") as typeof usersTable.$inferSelect.status,
        },
      });

    // Handle area manager branches
    if (data.role === "area_manager" && data.assignedBranches?.length) {
      for (const branchId of data.assignedBranches) {
        await db
          .insert(areaManagerBranches)
          .values({
            userId,
            branchId,
          })
          .onConflictDoNothing();
      }
    }

    return { success: true, userId };
  });

export const updateUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        role: userRoleEnum.optional(),
        branchId: z.string().uuid().optional(),
        pin: z.string().length(4).optional(),
        status: z.enum(["Active", "Inactive"]).optional(),
        assignedBranches: z.array(z.string().uuid()).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireRole("super_admin");

    const { id, assignedBranches, ...updates } = data;

    // Validate PIN uniqueness per branch
    if (data.pin) {
      // Determine the branchId to check: use new branchId if provided, otherwise current
      let branchIdToCheck = data.branchId;
      if (!branchIdToCheck) {
        const [currentUser] = await db
          .select({ branchId: usersTable.branchId })
          .from(usersTable)
          .where(eq(usersTable.id, id))
          .limit(1);
        branchIdToCheck = currentUser?.branchId ?? undefined;
      }
      if (branchIdToCheck) {
        const [existing] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(
            and(
              eq(usersTable.pin, data.pin),
              eq(usersTable.branchId, branchIdToCheck),
              ne(usersTable.id, id),
            ),
          )
          .limit(1);
        if (existing) {
          throw new Error("PIN sudah digunakan oleh user lain di cabang ini");
        }
      }
    }

    const setData: Record<string, unknown> = { ...updates };
    if (updates.branchId === undefined && "branchId" in data) {
      // If branchId was explicitly passed as undefined, keep it
    }

    await db.update(usersTable).set(setData).where(eq(usersTable.id, id));

    // Update area manager branches
    if (assignedBranches !== undefined) {
      await db.delete(areaManagerBranches).where(eq(areaManagerBranches.userId, id));
      for (const branchId of assignedBranches) {
        await db.insert(areaManagerBranches).values({ userId: id, branchId });
      }
    }

    return { success: true };
  });
