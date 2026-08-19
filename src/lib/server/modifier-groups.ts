import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  modifierGroups,
  modifiers,
  modifierIngredients,
  recipes,
  recipeModifierGroups,
} from "#/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { fuzzySearch, fuzzyRank } from "./fuzzy";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { z } from "zod";

const modifierInput = z.object({
  name: z.string().min(1).max(100),
  price: z.number().int().min(0).default(0),
  isExclusion: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
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
  .validator((data: { search?: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const groups = await db
      .select()
      .from(modifierGroups)
      .where(data.search ? fuzzySearch(modifierGroups.name, data.search) : undefined)
      .orderBy(data.search ? fuzzyRank(modifierGroups.name, data.search) : modifierGroups.name);

    const groupIds = groups.map((g) => g.id);

    const [allModifiers, recipeCounts] = await Promise.all([
      groupIds.length > 0
        ? db
            .select()
            .from(modifiers)
            .where(inArray(modifiers.modifierGroupId, groupIds))
            .orderBy(modifiers.sortOrder)
        : Promise.resolve<(typeof modifiers.$inferSelect)[]>([]),
      groupIds.length > 0
        ? db
            .select({
              modifierGroupId: recipeModifierGroups.modifierGroupId,
              count: sql<number>`count(*)`,
            })
            .from(recipeModifierGroups)
            .where(inArray(recipeModifierGroups.modifierGroupId, groupIds))
            .groupBy(recipeModifierGroups.modifierGroupId)
        : Promise.resolve<{ modifierGroupId: string; count: number }[]>([]),
    ]);

    const countMap = Object.fromEntries(
      recipeCounts.map((r) => [r.modifierGroupId, Number(r.count)]),
    );

    return groups.map((g) => ({
      ...g,
      modifiers: allModifiers.filter((m) => m.modifierGroupId === g.id),
      recipeCount: countMap[g.id] ?? 0,
    }));
  });

export const getModifierGroup = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();
    const [group] = await db
      .select()
      .from(modifierGroups)
      .where(eq(modifierGroups.id, data.id))
      .limit(1);
    if (!group) return null;

    const mods = await db
      .select()
      .from(modifiers)
      .where(eq(modifiers.modifierGroupId, data.id))
      .orderBy(modifiers.sortOrder);
    const modIds = mods.map((m) => m.id);
    const [modIngs, linkedRecipes] = await Promise.all([
      modIds.length > 0
        ? db
            .select()
            .from(modifierIngredients)
            .where(inArray(modifierIngredients.modifierId, modIds))
        : Promise.resolve<(typeof modifierIngredients.$inferSelect)[]>([]),
      db
        .select({
          id: recipes.id,
          code: recipes.code,
          name: recipes.name,
          category: recipes.category,
        })
        .from(recipeModifierGroups)
        .innerJoin(recipes, eq(recipeModifierGroups.recipeId, recipes.id))
        .where(eq(recipeModifierGroups.modifierGroupId, data.id)),
    ]);

    return {
      ...group,
      modifiers: mods.map((m) => ({
        ...m,
        ingredients: modIngs.filter((mi) => mi.modifierId === m.id),
      })),
      recipes: linkedRecipes,
    };
  });

export const createModifierGroup = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof modifierGroupInput>) => modifierGroupInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [group] = await db
      .insert(modifierGroups)
      .values({
        code: data.code,
        name: data.name,
        minSelection: data.minSelection,
        maxSelection: data.maxSelection,
      })
      .returning();

    for (const [idx, mod] of data.modifiers.entries()) {
      const [createdMod] = await db
        .insert(modifiers)
        .values({
          modifierGroupId: group.id,
          code: `${data.code}-${mod.name.toLowerCase().replace(/\s+/g, "-")}`,
          name: mod.name,
          price: mod.price,
          isExclusion: mod.isExclusion,
          sortOrder: mod.sortOrder ?? idx,
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

    await logSystemAction(
      user,
      "Create Modifier Group",
      `Modifier group "${group.name}" dibuat oleh ${user.name}`,
    );
    await logAudit(user, "modifierGroups", group.id, "CREATE", undefined, group);

    return group;
  });

const updateModifierGroupInput = modifierGroupInput.partial().extend({ id: z.string().uuid() });

export const updateModifierGroup = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof updateModifierGroupInput>) =>
    updateModifierGroupInput.parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const { id, modifiers: mods, ...groupUpdates } = data;

    const [old] = await db.select().from(modifierGroups).where(eq(modifierGroups.id, id)).limit(1);

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
      for (const [idx, mod] of mods.entries()) {
        const [createdMod] = await db
          .insert(modifiers)
          .values({
            modifierGroupId: id,
            code: `${groupUpdates.code ?? ""}-${mod.name.toLowerCase().replace(/\s+/g, "-")}`,
            name: mod.name,
            price: mod.price,
            isExclusion: mod.isExclusion,
            sortOrder: idx,
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

    const [updated] = await db
      .select()
      .from(modifierGroups)
      .where(eq(modifierGroups.id, id))
      .limit(1);

    await logSystemAction(
      user,
      "Update Modifier Group",
      `Modifier group "${updated?.name}" diperbarui oleh ${user.name}`,
    );
    await logAudit(user, "modifierGroups", id, "UPDATE", old, updated);

    return { success: true };
  });

const linkRecipesToModifierGroupInput = z.object({
  modifierGroupId: z.string().uuid(),
  recipeIds: z.array(z.string().uuid()),
});

export const linkRecipesToModifierGroup = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof linkRecipesToModifierGroupInput>) =>
    linkRecipesToModifierGroupInput.parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    // Replace all recipe links for this modifier group
    await db
      .delete(recipeModifierGroups)
      .where(eq(recipeModifierGroups.modifierGroupId, data.modifierGroupId));

    if (data.recipeIds.length > 0) {
      await db.insert(recipeModifierGroups).values(
        data.recipeIds.map((recipeId) => ({
          recipeId,
          modifierGroupId: data.modifierGroupId,
        })),
      );
    }

    await logSystemAction(
      user,
      "Link Recipes to Modifier Group",
      `Modifier group ${data.modifierGroupId} dihubungkan ke ${data.recipeIds.length} menu oleh ${user.name}`,
    );

    return { success: true };
  });

const reorderModifiersInput = z.object({
  modifierGroupId: z.string().uuid(),
  modifierIds: z.array(z.string().uuid()),
});

export const reorderModifiers = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof reorderModifiersInput>) => reorderModifiersInput.parse(data))
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

    // Update sort_order based on array position
    await db.transaction(async (tx) => {
      for (const [idx, modifierId] of data.modifierIds.entries()) {
        await tx.update(modifiers).set({ sortOrder: idx }).where(eq(modifiers.id, modifierId));
      }
    });

    return { success: true };
  });

export const deleteModifierGroup = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [old] = await db
      .select()
      .from(modifierGroups)
      .where(eq(modifierGroups.id, data.id))
      .limit(1);
    if (!old) throw new Error("Modifier group not found");

    // Delete cascade: modifiers → modifierIngredients
    const existingMods = await db
      .select()
      .from(modifiers)
      .where(eq(modifiers.modifierGroupId, data.id));
    for (const m of existingMods) {
      await db.delete(modifierIngredients).where(eq(modifierIngredients.modifierId, m.id));
    }
    await db.delete(modifiers).where(eq(modifiers.modifierGroupId, data.id));
    await db.delete(modifierGroups).where(eq(modifierGroups.id, data.id));

    await logSystemAction(
      user,
      "Delete Modifier Group",
      `Modifier group "${old.name}" dihapus oleh ${user.name}`,
    );
    await logAudit(user, "modifierGroups", data.id, "DELETE", old, undefined);

    return { success: true };
  });
