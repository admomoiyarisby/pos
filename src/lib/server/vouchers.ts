import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { vouchers } from "#/db/schema";
import { eq, gte } from "drizzle-orm";
import { fuzzySearch, fuzzyRank } from "./fuzzy";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";
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
  .validator((data: { search?: string; activeOnly?: boolean }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const conditions = [];
    if (data.search) {
      conditions.push(fuzzySearch(vouchers.code, data.search));
    }
    if (data.activeOnly) {
      conditions.push(eq(vouchers.isActive, true));
      conditions.push(gte(vouchers.validUntil, new Date()));
    }

    const result = await db
      .select()
      .from(vouchers)
      .where(conditions.length > 0 ? conditions[0] : undefined)
      .orderBy(data.search ? fuzzyRank(vouchers.code, data.search) : vouchers.code);

    return result;
  });

export const createVoucher = createServerFn({ method: "POST" })
  .validator((data: unknown) => voucherInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");

    const [result] = await db
      .insert(vouchers)
      .values({
        ...data,
        validUntil: new Date(data.validUntil),
        createdBy: user.id,
      })
      .returning();

    await logSystemAction(
      user,
      "Create Voucher",
      `Voucher "${result.code}" dibuat oleh ${user.name}`,
    );
    await logAudit(
      user,
      "vouchers",
      result.id,
      "CREATE",
      undefined,
      result as Record<string, unknown>,
    );

    return result;
  });

export const updateVoucher = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    voucherInput.partial().extend({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");

    const { id, validUntil, ...rest } = data;

    const [old] = await db.select().from(vouchers).where(eq(vouchers.id, id)).limit(1);

    const [result] = await db
      .update(vouchers)
      .set({
        ...rest,
        ...(validUntil ? { validUntil: new Date(validUntil) } : {}),
      })
      .where(eq(vouchers.id, id))
      .returning();

    await logSystemAction(
      user,
      "Update Voucher",
      `Voucher "${result.code}" diperbarui oleh ${user.name}`,
    );
    await logAudit(
      user,
      "vouchers",
      id,
      "UPDATE",
      old as Record<string, unknown>,
      result as Record<string, unknown>,
    );

    return result;
  });

export const deleteVoucher = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");

    const [old] = await db.select().from(vouchers).where(eq(vouchers.id, data.id)).limit(1);
    if (!old) throw new Error("Voucher not found");

    const [result] = await db
      .update(vouchers)
      .set({ isActive: false })
      .where(eq(vouchers.id, data.id))
      .returning();

    await logSystemAction(
      user,
      "Delete Voucher",
      `Voucher "${result.code}" dinonaktifkan oleh ${user.name}`,
    );
    await logAudit(
      user,
      "vouchers",
      data.id,
      "DELETE",
      old as Record<string, unknown>,
      result as Record<string, unknown>,
    );

    return { success: true };
  });
