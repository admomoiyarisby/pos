import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { brands } from "#/db/schema";
import { eq, ilike } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { z } from "zod";

const brandInput = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  logo: z.string().optional(),
});

export const getBrands = createServerFn({ method: "GET" })
  .validator((data: { search?: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const result = await db
      .select()
      .from(brands)
      .where(data.search ? ilike(brands.name, `%${data.search}%`) : undefined)
      .orderBy(brands.name);

    return result;
  });

export const createBrand = createServerFn({ method: "POST" })
  .validator((data: unknown) => brandInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [result] = await db.insert(brands).values(data).returning();

    await logSystemAction(user, "Create Brand", `Brand "${result.name}" dibuat oleh ${user.name}`);
    await logAudit(
      user,
      "brands",
      result.id,
      "CREATE",
      undefined,
      result as Record<string, unknown>,
    );

    return result;
  });

export const updateBrand = createServerFn({ method: "POST" })
  .validator((data: unknown) => brandInput.partial().extend({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const { id, ...updates } = data;

    const [old] = await db.select().from(brands).where(eq(brands.id, id)).limit(1);

    const [result] = await db.update(brands).set(updates).where(eq(brands.id, id)).returning();

    await logSystemAction(
      user,
      "Update Brand",
      `Brand "${result.name}" diperbarui oleh ${user.name}`,
    );
    await logAudit(
      user,
      "brands",
      id,
      "UPDATE",
      old as Record<string, unknown>,
      result as Record<string, unknown>,
    );

    return result;
  });

export const deleteBrand = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [old] = await db.select().from(brands).where(eq(brands.id, data.id)).limit(1);
    if (!old) throw new Error("Brand not found");

    const [result] = await db
      .update(brands)
      .set({ status: "Inactive" })
      .where(eq(brands.id, data.id))
      .returning();

    await logSystemAction(
      user,
      "Delete Brand",
      `Brand "${result.name}" dinonaktifkan oleh ${user.name}`,
    );
    await logAudit(
      user,
      "brands",
      data.id,
      "DELETE",
      old as Record<string, unknown>,
      result as Record<string, unknown>,
    );

    return { success: true };
  });
