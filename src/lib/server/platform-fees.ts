import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import { platformFees } from "#/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
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
    await requireRole("super_admin");

    const [result] = await db
      .update(platformFees)
      .set({
        feePercentage: data.feePercentage,
        fixedFee: data.fixedFee,
      })
      .where(eq(platformFees.id, data.id))
      .returning();

    return result;
  });
