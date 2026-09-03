import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  modifierGroups,
  modifiers,
  modifierIngredients,
  modifierRecipes,
  recipes,
  recipeModifierGroups,
  recipeBranches,
  categories,
  orderItemModifiers,
} from "#/db/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { fuzzySearch, fuzzyRank } from "./fuzzy";
import { requireAuth, requireRole, getCurrentUserRaw } from "./auth";
import type { AppUser } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { branchVisibleClause } from "#/lib/server/branch-visibility";
import type { UnknownRecord } from "#/lib/unknown-record";
import { z } from "zod";

// ADR-0014 kind discriminator. `text` default keeps callers that don't set a
// kind producing a valid no-link option.
export const MODIFIER_KINDS = ["text", "ingredient", "recipe"] as const;

export const modifierInput = z.object({
  name: z.string().min(1).max(100),
  alias: z.string().max(100).optional().nullable(),
  price: z.number().int().min(0).default(0),
  kind: z.enum(MODIFIER_KINDS).default("text"),
  isExclusion: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
  ingredientId: z.string().uuid().optional(),
  ingredientQty: z.number().int().min(1).optional(),
  recipeId: z.string().uuid().optional(),
  recipeQty: z.number().positive().optional(),
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
    const user = await getCurrentUserRaw();

    // Branch visibility: only count recipes visible to the caller's branch (a
    // recipe with zero recipe_branches rows is visible everywhere). Central
    // users (no branchId) see the full count.
    const branchClause = branchVisibleClause({
      linkTable: recipeBranches,
      linkRowId: recipeBranches.recipeId,
      rowId: recipes.id,
      linkBranchId: recipeBranches.branchId,
      currentBranchId: user?.branchId,
    });

    const groups = await db
      .select()
      .from(modifierGroups)
      .where(data.search ? fuzzySearch(modifierGroups.name, data.search) : undefined)
      // Browse (no search) honors the manual group order so the drag-and-drop
      // reorder on /modifier-groups is reflected; searching keeps relevance
      // ranking (fuzzyRank) so results aren't buried by sort order.
      .orderBy(
        ...(data.search
          ? [fuzzyRank(modifierGroups.name, data.search)]
          : [modifierGroups.sortOrder, modifierGroups.name]),
      );

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
            .innerJoin(recipes, eq(recipeModifierGroups.recipeId, recipes.id))
            // ADR-0009 mirror: tombstoned (Deleted) recipes never appear in the
            // UI, so they must not inflate the recipe count either.
            .where(
              and(
                inArray(recipeModifierGroups.modifierGroupId, groupIds),
                ne(recipes.status, "Deleted"),
                branchClause,
              ),
            )
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
    const user = await getCurrentUserRaw();

    // Branch visibility: a branch-scoped caller must not see recipes in a
    // modifier group that are restricted from their branch.
    const branchClause = branchVisibleClause({
      linkTable: recipeBranches,
      linkRowId: recipeBranches.recipeId,
      rowId: recipes.id,
      linkBranchId: recipeBranches.branchId,
      currentBranchId: user?.branchId,
    });

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
    const [modIngs, modRecipes, linkedRecipes] = await Promise.all([
      modIds.length > 0
        ? db
            .select()
            .from(modifierIngredients)
            .where(inArray(modifierIngredients.modifierId, modIds))
        : Promise.resolve<(typeof modifierIngredients.$inferSelect)[]>([]),
      modIds.length > 0
        ? db.select().from(modifierRecipes).where(inArray(modifierRecipes.modifierId, modIds))
        : Promise.resolve<(typeof modifierRecipes.$inferSelect)[]>([]),
      db
        .select({
          id: recipes.id,
          code: recipes.code,
          name: recipes.name,
          categoryName: categories.name,
        })
        .from(recipeModifierGroups)
        .innerJoin(recipes, eq(recipeModifierGroups.recipeId, recipes.id))
        .leftJoin(categories, eq(recipes.categoryId, categories.id))
        // ADR-0009 mirror: tombstoned (Deleted) recipes never appear in the UI,
        // so they must not show up in the linked-recipes list either.
        .where(
          and(
            eq(recipeModifierGroups.modifierGroupId, data.id),
            ne(recipes.status, "Deleted"),
            branchClause,
          ),
        ),
    ]);

    return {
      ...group,
      modifiers: mods.map((m) => ({
        ...m,
        ingredients: modIngs.filter((mi) => mi.modifierId === m.id),
        recipes: modRecipes.filter((mr) => mr.modifierId === m.id),
      })),
      recipes: linkedRecipes,
    };
  });

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function createModifierGroupCore(
  user: AppUser,
  data: z.input<typeof modifierGroupInput>,
) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  for (const mod of data.modifiers) assertKindMatchesJoins(mod);

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
        alias: mod.alias ?? null,
        price: mod.price,
        kind: mod.kind,
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
    if (mod.recipeId && mod.recipeQty) {
      await db.insert(modifierRecipes).values({
        modifierId: createdMod.id,
        recipeId: mod.recipeId,
        quantity: mod.recipeQty,
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
}

export const createModifierGroup = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof modifierGroupInput>) => modifierGroupInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return createModifierGroupCore(user, data);
  });

// Same partial-update trap as updateRecipe: `modifierGroupInput`/`modifierInput`
// declare minSelection/maxSelection/price/isExclusion/sortOrder with
// `.default(...)`, and zod re-applies those defaults for keys absent from a
// `.partial()` payload — a rename-only group update would silently reset
// Min/Max to 0/1, and a modifier omitting price would be re-created at Rp 0.
// Strip the defaults so absent keys stay absent; re-add them as plain optionals.
const updateModifierInput = modifierInput
  .omit({ price: true, isExclusion: true, sortOrder: true, kind: true })
  .extend({
    id: z.string().uuid().optional(),
    alias: z.string().max(100).optional().nullable(),
    price: z.number().int().min(0).optional(),
    isExclusion: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
    kind: z.enum(MODIFIER_KINDS).optional(),
  });

const updateModifierGroupInput = modifierGroupInput
  .omit({ minSelection: true, maxSelection: true, modifiers: true })
  .partial()
  .extend({
    id: z.string().uuid(),
    minSelection: z.number().int().min(0).optional(),
    maxSelection: z.number().int().min(1).optional(),
    modifiers: z.array(updateModifierInput).optional(),
  });

// ADR-0014 exactly-one-kind invariant: a modifier's `kind` must match which
// joins are populated. `text` carries no links, `ingredient` exactly one
// ingredient link (zero recipe links), `recipe` exactly one recipe link (zero
// ingredient links). Throw on conflict so the DB state and the app agree.
type ModifierKindLike = {
  kind?: "text" | "ingredient" | "recipe";
  ingredientId?: string | null;
  recipeId?: string | null;
};
function assertKindMatchesJoins(mod: ModifierKindLike) {
  // An update without `kind` sets nothing about it; nothing to check.
  if (!mod.kind) return;
  const hasIngredient = Boolean(mod.ingredientId);
  const hasRecipe = Boolean(mod.recipeId);
  const invalid =
    (mod.kind === "text" && (hasIngredient || hasRecipe)) ||
    (mod.kind === "ingredient" && !hasIngredient) ||
    (mod.kind === "ingredient" && hasRecipe) ||
    (mod.kind === "recipe" && !hasRecipe) ||
    (mod.kind === "recipe" && hasIngredient);
  if (invalid) {
    throw new Error(
      `Opsi "${mod.kind}" tidak cocok dengan isiannya: ${mod.kind} membutuhkan ${
        mod.kind === "text"
          ? "tanpa bahan/menu terpilih"
          : mod.kind === "ingredient"
            ? "satu bahan (tanpa menu)"
            : "satu menu (tanpa bahan)"
      }.`,
    );
  }
}

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function updateModifierGroupCore(
  user: AppUser,
  data: z.input<typeof updateModifierGroupInput>,
) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  const { id, modifiers: mods, ...groupUpdates } = data;

  if (mods) for (const mod of mods) assertKindMatchesJoins(mod);

  const [old] = await db.select().from(modifierGroups).where(eq(modifierGroups.id, id)).limit(1);
  if (!old) throw new Error("Modifier group not found");

  // Only set fields that were actually provided — absent optionals parse to
  // `undefined` now (no default injection), and drizzle throws on an empty set.
  const groupUpdateSet: UnknownRecord = {};
  for (const [key, value] of Object.entries(groupUpdates)) {
    if (value !== undefined) groupUpdateSet[key] = value;
  }

  if (Object.keys(groupUpdateSet).length > 0) {
    await db.update(modifierGroups).set(groupUpdateSet).where(eq(modifierGroups.id, id));
  }

  if (mods !== undefined) {
    // SAFETY: data.code is validated by zod as string | undefined; fallback to stored code.
    const groupCode = (data.code as string | undefined) ?? old.code;

    await db.transaction(async (tx) => {
      const existing = await tx.select().from(modifiers).where(eq(modifiers.modifierGroupId, id));
      const existingMap = new Map(existing.map((e) => [e.id, e]));
      const incomingIds = new Set(
        mods.filter((m): m is typeof m & { id: string } => m.id !== undefined).map((m) => m.id),
      );
      const hasIds = incomingIds.size > 0;
      const legacyNoIds = !hasIds && mods.length > 0;

      if (legacyNoIds && existing.length > 0) {
        // Legacy payload without ids — cannot diff by identity. Guard the
        // FK on order_item_modifiers.modifier_id (restrict) so Postgres
        // doesn't surface a bare `Failed query: delete from "modifiers"`.
        const referenced = await tx
          .select({ rid: orderItemModifiers.modifierId })
          .from(orderItemModifiers)
          .where(
            inArray(
              orderItemModifiers.modifierId,
              existing.map((e) => e.id),
            ),
          )
          .limit(1);
        if (referenced.length > 0) {
          throw new Error(
            "Tidak dapat mengubah opsi modifier karena sudah dipakai di riwayat pesanan. Hapus pemakaian atau edit opsi satu per satu (nama/harga) tanpa menghapus opsi yang sudah terpakai.",
          );
        }
        for (const e of existing) {
          await tx.delete(modifierIngredients).where(eq(modifierIngredients.modifierId, e.id));
          await tx.delete(modifierRecipes).where(eq(modifierRecipes.modifierId, e.id));
        }
        await tx.delete(modifiers).where(eq(modifiers.modifierGroupId, id));
        for (const [idx, mod] of mods.entries()) {
          // SAFETY: mod is validated by updateModifierInput which includes optional alias
          const aliasVal = (mod as { alias?: string | null }).alias ?? null;
          const [createdMod] = await tx
            .insert(modifiers)
            .values({
              modifierGroupId: id,
              code: `${groupCode}-${mod.name.toLowerCase().replace(/\s+/g, "-")}`,
              name: mod.name,
              alias: aliasVal,
              price: mod.price ?? 0,
              kind: mod.kind ?? "text",
              isExclusion: mod.isExclusion ?? false,
              sortOrder: mod.sortOrder ?? idx,
            })
            .returning();
          if (mod.ingredientId && mod.ingredientQty) {
            await tx.insert(modifierIngredients).values({
              modifierId: createdMod.id,
              ingredientId: mod.ingredientId,
              quantity: mod.ingredientQty,
            });
          }
          if (mod.recipeId && mod.recipeQty) {
            await tx.insert(modifierRecipes).values({
              modifierId: createdMod.id,
              recipeId: mod.recipeId,
              quantity: mod.recipeQty,
            });
          }
        }
        return;
      }

      // Id-aware diff: update existing, insert new, delete removed.
      for (const incomingId of incomingIds) {
        if (!existingMap.has(incomingId)) {
          throw new Error(`Modifier ${incomingId} tidak ditemukan di grup ini`);
        }
      }

      const toDeleteIds = existing.filter((e) => !incomingIds.has(e.id)).map((e) => e.id);
      if (toDeleteIds.length > 0) {
        const referenced = await tx
          .select({ rid: orderItemModifiers.modifierId })
          .from(orderItemModifiers)
          .where(inArray(orderItemModifiers.modifierId, toDeleteIds));
        if (referenced.length > 0) {
          const names = existing
            .filter((e) => referenced.some((r) => r.rid === e.id))
            .map((e) => e.name)
            .join(", ");
          throw new Error(
            `Tidak dapat menghapus opsi "${names}" karena sudah dipakai di riwayat pesanan. Ubah nama/harga opsi tersebut tanpa menghapusnya, atau hapus pesanan terkait terlebih dahulu.`,
          );
        }
        for (const delId of toDeleteIds) {
          await tx.delete(modifierIngredients).where(eq(modifierIngredients.modifierId, delId));
          await tx.delete(modifierRecipes).where(eq(modifierRecipes.modifierId, delId));
          await tx.delete(modifiers).where(eq(modifiers.id, delId));
        }
      }

      // Also handle the case where mods is an empty array (remove all) —
      // toDeleteIds already covers it, so just handle upserts below (no-op).
      for (const [idx, mod] of mods.entries()) {
        if (mod.id && existingMap.has(mod.id)) {
          const set: UnknownRecord = {
            name: mod.name,
            sortOrder: mod.sortOrder ?? idx,
            code: `${groupCode}-${mod.name.toLowerCase().replace(/\s+/g, "-")}`,
          };
          // SAFETY: mod validated by updateModifierInput includes optional alias
          const aliasChecked = (mod as { alias?: string | null }).alias;
          if (aliasChecked !== undefined) set.alias = aliasChecked ?? null;
          if (mod.price !== undefined) set.price = mod.price;
          if (mod.isExclusion !== undefined) set.isExclusion = mod.isExclusion;
          if (mod.kind !== undefined) set.kind = mod.kind;
          await tx.update(modifiers).set(set).where(eq(modifiers.id, mod.id));
          await tx.delete(modifierIngredients).where(eq(modifierIngredients.modifierId, mod.id));
          await tx.delete(modifierRecipes).where(eq(modifierRecipes.modifierId, mod.id));
          if (mod.ingredientId && mod.ingredientQty) {
            await tx.insert(modifierIngredients).values({
              modifierId: mod.id,
              ingredientId: mod.ingredientId,
              quantity: mod.ingredientQty,
            });
          }
          if (mod.recipeId && mod.recipeQty) {
            await tx.insert(modifierRecipes).values({
              modifierId: mod.id,
              recipeId: mod.recipeId,
              quantity: mod.recipeQty,
            });
          }
        } else if (!mod.id) {
          // SAFETY: mod validated by updateModifierInput includes optional alias
          const aliasVal2 = (mod as { alias?: string | null }).alias ?? null;
          const [createdMod] = await tx
            .insert(modifiers)
            .values({
              modifierGroupId: id,
              code: `${groupCode}-${mod.name.toLowerCase().replace(/\s+/g, "-")}`,
              name: mod.name,
              alias: aliasVal2,
              price: mod.price ?? 0,
              kind: mod.kind ?? "text",
              isExclusion: mod.isExclusion ?? false,
              sortOrder: mod.sortOrder ?? idx,
            })
            .returning();
          if (mod.ingredientId && mod.ingredientQty) {
            await tx.insert(modifierIngredients).values({
              modifierId: createdMod.id,
              ingredientId: mod.ingredientId,
              quantity: mod.ingredientQty,
            });
          }
          if (mod.recipeId && mod.recipeQty) {
            await tx.insert(modifierRecipes).values({
              modifierId: createdMod.id,
              recipeId: mod.recipeId,
              quantity: mod.recipeQty,
            });
          }
        }
      }
    });
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
}

export const updateModifierGroup = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof updateModifierGroupInput>) =>
    updateModifierGroupInput.parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return updateModifierGroupCore(user, data);
  });

const linkRecipesToModifierGroupInput = z.object({
  modifierGroupId: z.string().uuid(),
  recipeIds: z.array(z.string().uuid()),
});

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function linkRecipesToModifierGroupCore(
  user: AppUser,
  data: z.input<typeof linkRecipesToModifierGroupInput>,
) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

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
}

export const linkRecipesToModifierGroup = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof linkRecipesToModifierGroupInput>) =>
    linkRecipesToModifierGroupInput.parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return linkRecipesToModifierGroupCore(user, data);
  });

export const reorderModifiersInput = z.object({
  modifierGroupId: z.string().uuid(),
  modifierIds: z.array(z.string().uuid()),
});

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function reorderModifiersCore(
  user: AppUser,
  data: z.input<typeof reorderModifiersInput>,
) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  // Update sort_order based on array position
  await db.transaction(async (tx) => {
    for (const [idx, modifierId] of data.modifierIds.entries()) {
      await tx.update(modifiers).set({ sortOrder: idx }).where(eq(modifiers.id, modifierId));
    }
  });

  return { success: true };
}

export const reorderModifiers = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof reorderModifiersInput>) => reorderModifiersInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return reorderModifiersCore(user, data);
  });

export const reorderModifierGroupsInput = z.object({
  modifierGroupIds: z.array(z.string().uuid()),
});

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function reorderModifierGroupsCore(
  user: AppUser,
  data: z.input<typeof reorderModifierGroupsInput>,
) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  // Update sort_order based on array position
  await db.transaction(async (tx) => {
    for (const [idx, groupId] of data.modifierGroupIds.entries()) {
      await tx.update(modifierGroups).set({ sortOrder: idx }).where(eq(modifierGroups.id, groupId));
    }
  });

  return { success: true };
}

export const reorderModifierGroups = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof reorderModifierGroupsInput>) =>
    reorderModifierGroupsInput.parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return reorderModifierGroupsCore(user, data);
  });

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function deleteModifierGroupCore(user: AppUser, data: { id: string }) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  const [old] = await db
    .select()
    .from(modifierGroups)
    .where(eq(modifierGroups.id, data.id))
    .limit(1);
  if (!old) throw new Error("Modifier group not found");

  // Guard FK: order_item_modifiers restricts deletion of a modifier that has
  // been used in order history. Surface a friendly message instead of a raw
  // Postgres FK violation.
  const existingMods = await db
    .select()
    .from(modifiers)
    .where(eq(modifiers.modifierGroupId, data.id));
  if (existingMods.length > 0) {
    const referenced = await db
      .select({ rid: orderItemModifiers.modifierId })
      .from(orderItemModifiers)
      .where(
        inArray(
          orderItemModifiers.modifierId,
          existingMods.map((m) => m.id),
        ),
      )
      .limit(1);
    if (referenced.length > 0) {
      throw new Error(
        "Tidak dapat menghapus grup modifier karena salah satu opsinya sudah dipakai di riwayat pesanan.",
      );
    }
    // Also check modifier_group_id FK from order_item_modifiers
    const groupReferenced = await db
      .select({ rid: orderItemModifiers.modifierGroupId })
      .from(orderItemModifiers)
      .where(eq(orderItemModifiers.modifierGroupId, data.id))
      .limit(1);
    if (groupReferenced.length > 0) {
      throw new Error(
        "Tidak dapat menghapus grup modifier karena grup ini sudah dipakai di riwayat pesanan.",
      );
    }
  }
  // Delete cascade: modifiers → modifierIngredients (safe after guard)
  for (const m of existingMods) {
    await db.delete(modifierIngredients).where(eq(modifierIngredients.modifierId, m.id));
    await db.delete(modifierRecipes).where(eq(modifierRecipes.modifierId, m.id));
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
}

export const deleteModifierGroup = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return deleteModifierGroupCore(user, data);
  });
