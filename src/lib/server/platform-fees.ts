import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import { platformFees } from "#/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { z } from "zod";

const feeInput = z.object({
  id: z.string().uuid(),
  feePercentage: z.number().int().min(0).max(100),
  fixedFee: z.number().int().min(0).default(0),
});

export const getPlatformFees = createServerFn({ method: "GET" }).handler(async () => {
  await requireAuth();

  const result = await db.select().from(platformFees).orderBy(platformFees.channel);
  return result;
});

export const updatePlatformFee = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => feeInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");

    const [old] = await db.select().from(platformFees).where(eq(platformFees.id, data.id)).limit(1);

    const [result] = await db
      .update(platformFees)
      .set({
        feePercentage: data.feePercentage,
        fixedFee: data.fixedFee,
      })
      .where(eq(platformFees.id, data.id))
      .returning();

    await logSystemAction(
      user,
      "Update Platform Fee",
      `Platform fee "${result.channel}" diperbarui oleh ${user.name}`,
    );
    await logAudit(
      user,
      "platformFees",
      data.id,
      "UPDATE",
      old as Record<string, unknown>,
      result as Record<string, unknown>,
    );

    return result;
  });
