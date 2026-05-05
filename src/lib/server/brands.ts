import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import { brands } from "#/db/schema";
import { eq, ilike } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { z } from "zod";

const brandInput = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  logo: z.string().optional(),
});

export const getBrands = createServerFn({ method: "GET" })
  .inputValidator((data: { search?: string }) => data)
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
  .inputValidator((data: unknown) => brandInput.parse(data))
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

    const [result] = await db.insert(brands).values(data).returning();

    return result;
  });

export const updateBrand = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    brandInput.partial().extend({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

    const { id, ...updates } = data;
    const [result] = await db.update(brands).set(updates).where(eq(brands.id, id)).returning();

    return result;
  });
