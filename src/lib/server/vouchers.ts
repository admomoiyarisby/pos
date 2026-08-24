import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { vouchers } from "#/db/schema";
import { eq, gte } from "drizzle-orm";
import { fuzzySearch, fuzzyRank } from "./fuzzy";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import type { UnknownRecord } from "#/lib/unknown-record";
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
  .validator((data: z.input<typeof voucherInput>) => voucherInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");

    const normalizedCode = data.code.trim().toUpperCase();
    const existing = await db
      .select({ id: vouchers.id })
      .from(vouchers)
      .where(eq(vouchers.code, normalizedCode))
      .limit(1);
    if (existing.length > 0) {
      throw new Error(`Kode voucher "${normalizedCode}" sudah digunakan`);
    }

    const [result] = await db
      .insert(vouchers)
      .values({
        ...data,
        code: normalizedCode,
        validUntil: new Date(data.validUntil),
        createdBy: user.id,
      })
      .returning();

    await logSystemAction(
      user,
      "Create Voucher",
      `Voucher "${result.code}" dibuat oleh ${user.name}`,
    );
    await logAudit(user, "vouchers", result.id, "CREATE", undefined, result);

    return result;
  });

// Partial-update schema. `voucherInput` declares `minOrder`/`isActive` with
// `.default(...)`, and zod re-applies those defaults for keys absent from a
// `.partial()` payload — a partial update would silently reset min_order to 0
// and reactivate a deactivated voucher. Strip the defaults so absent keys stay
// absent, and re-add them as plain optionals (the admin form sends the full
// set, but no partial caller should be able to clobber them).
const updateVoucherInput = voucherInput
  .omit({ minOrder: true, isActive: true })
  .partial()
  .extend({
    id: z.string().uuid(),
    minOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  });

export const updateVoucher = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof updateVoucherInput>) => updateVoucherInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");

    const { id, validUntil, code, ...rest } = data;

    const [old] = await db.select().from(vouchers).where(eq(vouchers.id, id)).limit(1);
    if (!old) throw new Error("Voucher not found");

    if (code) {
      const normalized = code.trim().toUpperCase();
      const dup = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(eq(vouchers.code, normalized))
        .limit(1);
      if (dup.length > 0 && dup[0].id !== id) {
        throw new Error(`Kode voucher "${normalized}" sudah digunakan`);
      }
    }

    // Only set fields that were actually provided — absent optionals parse to
    // `undefined` now (no default injection), and drizzle skips undefined keys
    // in `.set()` but throws on a fully-empty set.
    const updates: UnknownRecord = {};
    if (code) updates.code = code.trim().toUpperCase();
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) updates[key] = value;
    }
    if (validUntil) updates.validUntil = new Date(validUntil);

    if (Object.keys(updates).length === 0) {
      throw new Error("Tidak ada perubahan");
    }

    const [result] = await db.update(vouchers).set(updates).where(eq(vouchers.id, id)).returning();

    await logSystemAction(
      user,
      "Update Voucher",
      `Voucher "${result.code}" diperbarui oleh ${user.name}`,
    );
    await logAudit(user, "vouchers", id, "UPDATE", old, result);

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
    await logAudit(user, "vouchers", data.id, "DELETE", old, result);

    return { success: true };
  });
