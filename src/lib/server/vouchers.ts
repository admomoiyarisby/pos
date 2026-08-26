import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { vouchers } from "#/db/schema";
import { and, eq, gte, ne } from "drizzle-orm";
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
  // Kept as the form/API input shape; persistence maps this to the lifecycle
  // status so Active, Inactive, and Deleted remain distinct in the database.
  isActive: z.boolean().default(true),
});

export const getVouchers = createServerFn({ method: "GET" })
  .validator((data: { search?: string; activeOnly?: boolean }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const conditions = [ne(vouchers.status, "Deleted")];
    if (data.search) {
      conditions.push(fuzzySearch(vouchers.code, data.search));
    }
    if (data.activeOnly) {
      conditions.push(eq(vouchers.status, "Active"));
      conditions.push(gte(vouchers.validUntil, new Date()));
    }

    const result = await db
      .select()
      .from(vouchers)
      .where(and(...conditions))
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
        code: normalizedCode,
        description: data.description,
        discountType: data.discountType,
        discountValue: data.discountValue,
        minOrder: data.minOrder,
        validUntil: new Date(data.validUntil),
        status: data.isActive ? "Active" : "Inactive",
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
// `.partial()` payload. Strip the defaults so absent keys stay absent, and
// re-add them as plain optionals.
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

    const { id, validUntil, code, isActive, ...rest } = data;

    const [old] = await db.select().from(vouchers).where(eq(vouchers.id, id)).limit(1);
    if (!old) throw new Error("Voucher not found");
    if (old.status === "Deleted") throw new Error("Voucher sudah dihapus");

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

    // Only set fields that were actually provided. The form's legacy boolean
    // input is translated to the persisted lifecycle status.
    const updates: UnknownRecord = {};
    if (code) updates.code = code.trim().toUpperCase();
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) updates[key] = value;
    }
    if (isActive !== undefined) updates.status = isActive ? "Active" : "Inactive";
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

export const deactivateVoucher = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");

    const [old] = await db.select().from(vouchers).where(eq(vouchers.id, data.id)).limit(1);
    if (!old) throw new Error("Voucher not found");
    if (old.status !== "Active") throw new Error("Voucher sudah nonaktif atau dihapus");

    const [result] = await db
      .update(vouchers)
      .set({ status: "Inactive" })
      .where(and(eq(vouchers.id, data.id), eq(vouchers.status, "Active")))
      .returning();

    await logSystemAction(
      user,
      "Deactivate Voucher",
      `Voucher "${result.code}" dinonaktifkan oleh ${user.name}`,
    );
    await logAudit(user, "vouchers", data.id, "STATUS_CHANGE", old, result);

    return { success: true };
  });

// Soft delete: Inactive → Deleted. Deleted rows remain in the database for
// history/audit but are excluded from all voucher lists and POS usage.
export const deleteVoucher = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");

    const [old] = await db.select().from(vouchers).where(eq(vouchers.id, data.id)).limit(1);
    if (!old) throw new Error("Voucher not found");
    if (old.status === "Active") {
      throw new Error("Nonaktifkan voucher terlebih dahulu sebelum menghapusnya");
    }
    if (old.status === "Deleted") throw new Error("Voucher sudah dihapus");

    const [result] = await db
      .update(vouchers)
      .set({ status: "Deleted" })
      .where(and(eq(vouchers.id, data.id), eq(vouchers.status, "Inactive")))
      .returning();

    await logSystemAction(
      user,
      "Delete Voucher",
      `Voucher "${result.code}" dihapus secara permanen oleh ${user.name}`,
    );
    await logAudit(user, "vouchers", data.id, "DELETE", old, result);

    return { success: true };
  });
