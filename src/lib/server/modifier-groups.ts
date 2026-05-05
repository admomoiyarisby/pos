import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import { modifierGroups, modifiers, modifierIngredients } from "#/db/schema";
import { eq, ilike } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { z } from "zod";

const modifierInput = z.object({
  name: z.string().min(1).max(100),
  price: z.number().int().min(0).default(0),
  isExclusion: z.boolean().default(false),
  ingredientId: z.string().uuid().optional(),
  ingredientQty: z.number().int().min(1).optional(),
});

const modifierGroupInput = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  minSelection: z.number().int().min(0).default(0),
  maxSelection: z.number().int().min(1).default(1),
  modifiers: z.array(modifierInput),
});

export const getModifierGroups = createServerFn({ method: "GET" })
  .inputValidator((data: { search?: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const groups = await db
      .select()
      .from(modifierGroups)
      .where(data.search ? ilike(modifierGroups.name, `%${data.search}%`) : undefined)
      .orderBy(modifierGroups.name);

    const groupIds = groups.map((g) => g.id);
    const allModifiers =
      groupIds.length > 0
        ? await db.select().from(modifiers).where(eq(modifiers.modifierGroupId, groupIds[0]))
        : [];

    return groups.map((g) => ({
      ...g,
      modifiers: allModifiers.filter((m) => m.modifierGroupId === g.id),
    }));
  });

export const getModifierGroup = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();
    const [group] = await db
      .select()
      .from(modifierGroups)
      .where(eq(modifierGroups.id, data.id))
      .limit(1);
    if (!group) return null;

    const mods = await db.select().from(modifiers).where(eq(modifiers.modifierGroupId, data.id));
    const modIds = mods.map((m) => m.id);
    const modIngs =
      modIds.length > 0
        ? await db
            .select()
            .from(modifierIngredients)
            .where(eq(modifierIngredients.modifierId, modIds[0]))
        : [];

    return {
      ...group,
      modifiers: mods.map((m) => ({
        ...m,
        ingredients: modIngs.filter((mi) => mi.modifierId === m.id),
      })),
    };
  });

export const createModifierGroup = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => modifierGroupInput.parse(data))
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

    const [group] = await db
      .insert(modifierGroups)
      .values({
        code: data.code,
        name: data.name,
        minSelection: data.minSelection,
        maxSelection: data.maxSelection,
      })
      .returning();

    for (const mod of data.modifiers) {
      const [createdMod] = await db
        .insert(modifiers)
        .values({
          modifierGroupId: group.id,
          code: `${data.code}-${mod.name.toLowerCase().replace(/\s+/g, "-")}`,
          name: mod.name,
          price: mod.price,
          isExclusion: mod.isExclusion,
        })
        .returning();

      if (mod.ingredientId && mod.ingredientQty) {
        await db.insert(modifierIngredients).values({
          modifierId: createdMod.id,
          ingredientId: mod.ingredientId,
          quantity: mod.ingredientQty,
        });
      }
    }

    return group;
  });

export const updateModifierGroup = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    modifierGroupInput.partial().extend({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

    const { id, modifiers: mods, ...groupUpdates } = data;

    if (Object.keys(groupUpdates).length > 0) {
      await db.update(modifierGroups).set(groupUpdates).where(eq(modifierGroups.id, id));
    }

    if (mods !== undefined) {
      // Delete existing modifiers
      const existing = await db.select().from(modifiers).where(eq(modifiers.modifierGroupId, id));
      for (const e of existing) {
        await db.delete(modifierIngredients).where(eq(modifierIngredients.modifierId, e.id));
      }
      await db.delete(modifiers).where(eq(modifiers.modifierGroupId, id));

      // Re-create
      for (const mod of mods) {
        const [createdMod] = await db
          .insert(modifiers)
          .values({
            modifierGroupId: id,
            code: `${groupUpdates.code ?? ""}-${mod.name.toLowerCase().replace(/\s+/g, "-")}`,
            name: mod.name,
            price: mod.price,
            isExclusion: mod.isExclusion,
          })
          .returning();

        if (mod.ingredientId && mod.ingredientQty) {
          await db.insert(modifierIngredients).values({
            modifierId: createdMod.id,
            ingredientId: mod.ingredientId,
            quantity: mod.ingredientQty,
          });
        }
      }
    }

    return { success: true };
  });
