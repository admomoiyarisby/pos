import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { brands } from "#/db/schema";
import { eq } from "drizzle-orm";
import { fuzzySearch, fuzzyRank } from "./fuzzy";
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
      .where(data.search ? fuzzySearch(brands.name, data.search) : undefined)
      .orderBy(data.search ? fuzzyRank(brands.name, data.search) : brands.name);

    return result;
  });

export const createBrand = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof brandInput>) => brandInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [result] = await db.insert(brands).values(data).returning();

    await logSystemAction(user, "Create Brand", `Brand "${result.name}" dibuat oleh ${user.name}`);
    await logAudit(user, "brands", result.id, "CREATE", undefined, result);

    return result;
  });

const updateBrandInput = brandInput.partial().extend({ id: z.string().uuid() });

export const updateBrand = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof updateBrandInput>) => updateBrandInput.parse(data))
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
    await logAudit(user, "brands", id, "UPDATE", old, result);

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
    await logAudit(user, "brands", data.id, "DELETE", old, result);

    return { success: true };
  });
