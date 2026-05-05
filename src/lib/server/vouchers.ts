import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import { vouchers } from "#/db/schema";
import { eq, ilike, gte } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { z } from "zod";

const voucherInput = z.object({
  code: z.string().min(1).max(50).toUpperCase(),
  description: z.string().min(1).max(200),
  discountType: z.enum(["percentage", "fixed"]),
  discountValue: z.number().int().min(0),
  minOrder: z.number().int().min(0).default(0),
  validUntil: z.string().datetime(),
  isActive: z.boolean().default(true),
});

export const getVouchers = createServerFn({ method: "GET" })
  .inputValidator((data: { search?: string; activeOnly?: boolean }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const conditions = [];
    if (data.search) {
      conditions.push(ilike(vouchers.code, `%${data.search}%`));
    }
    if (data.activeOnly) {
      conditions.push(eq(vouchers.isActive, true));
      conditions.push(gte(vouchers.validUntil, new Date()));
    }

    const result = await db
      .select()
      .from(vouchers)
      .where(conditions.length > 0 ? conditions[0] : undefined)
      .orderBy(vouchers.code);

    return result;
  });

export const createVoucher = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => voucherInput.parse(data))
  .handler(async ({ data }) => {
    await requireRole("super_admin");

    const [result] = await db
      .insert(vouchers)
      .values({
        ...data,
        validUntil: new Date(data.validUntil),
        createdBy: (await requireAuth()).id,
      })
      .returning();

    return result;
  });

export const updateVoucher = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    voucherInput.partial().extend({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    await requireRole("super_admin");

    const { id, validUntil, ...rest } = data;
    const [result] = await db
      .update(vouchers)
      .set({
        ...rest,
        ...(validUntil ? { validUntil: new Date(validUntil) } : {}),
      })
      .where(eq(vouchers.id, id))
      .returning();

    return result;
  });
