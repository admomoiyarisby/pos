import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import { branches } from "#/db/schema";
import { eq, ilike, or, and } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { z } from "zod";

const branchInput = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  location: z.string().min(1).max(200),
  type: z.enum(["Central", "Outlet"]),
  active: z.boolean().optional(),
  isOnline: z.boolean().optional(),
});

export const getBranches = createServerFn({ method: "GET" })
  .inputValidator((data: { search?: string; type?: "Central" | "Outlet" | null }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const conditions = [];
    if (data.search) {
      conditions.push(
        or(
          ilike(branches.code, `%${data.search}%`),
          ilike(branches.name, `%${data.search}%`),
          ilike(branches.location, `%${data.search}%`),
        ),
      );
    }
    if (data.type) {
      conditions.push(eq(branches.type, data.type));
    }

    const result = await db
      .select()
      .from(branches)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(branches.code);

    return result;
  });

export const getBranch = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();
    const [result] = await db.select().from(branches).where(eq(branches.id, data.id)).limit(1);
    return result ?? null;
  });

export const createBranch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => branchInput.parse(data))
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

    const [result] = await db
      .insert(branches)
      .values({
        code: data.code,
        name: data.name,
        location: data.location,
        type: data.type,
        active: data.active ?? true,
        isOnline: data.isOnline ?? true,
      })
      .returning();

    return result;
  });

export const updateBranch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    branchInput.partial().extend({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

    const { id, ...updates } = data;
    const [result] = await db
      .update(branches)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(branches.id, id))
      .returning();

    return result;
  });
