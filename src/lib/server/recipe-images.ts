import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { recipes } from "#/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireRole, type AppUser } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { getSupabaseServerClient, RECIPE_IMAGES_BUCKET } from "./supabase";

/**
 * Recipe image storage. Each recipe has at most one image, stored in the
 * public `recipe-images` bucket at `recipes/{recipeId}/{uuid}.{ext}`. The
 * public object URL lives in `recipes.image_url`. See wayfinder map #64.
 */

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
// Decided in ticket #75.
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Extract the object path *inside* the bucket from a public Storage URL.
 * Returns null for URLs we didn't create (so we never delete foreign objects).
 */
export function objectPathFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/object\/public\/recipe-images\/(.+)$/);
  return match ? match[1] : null;
}

/**
 * Upload (or replace) a recipe's image. Deletes the previously stored object
 * to avoid orphans. Pure logic — the `createServerFn` wrapper below applies the
 * role gate and audit trail.
 */
export async function uploadRecipeImageToStorage(
  recipeId: string,
  file: File,
  user: AppUser,
): Promise<{ imageUrl: string }> {
  if (!(file instanceof File) || !file.type) {
    throw new Error("No image file provided");
  }
  const ext = ALLOWED_MIME[file.type];
  if (!ext) {
    throw new Error(`Unsupported image type "${file.type}". Allowed: JPEG, PNG, WebP.`);
  }
  if (file.size > MAX_BYTES) {
    throw new Error(
      `Image is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 2 MB.`,
    );
  }

  const [recipe] = await db.select().from(recipes).where(eq(recipes.id, recipeId)).limit(1);
  if (!recipe) throw new Error("Recipe not found");

  const oldUrl = recipe.imageUrl ?? null;
  const path = `recipes/${recipeId}/${crypto.randomUUID()}.${ext}`;

  const client = getSupabaseServerClient();
  const buffer = await file.arrayBuffer();
  const { error } = await client.storage
    .from(RECIPE_IMAGES_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const publicUrl = client.storage.from(RECIPE_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;

  await db
    .update(recipes)
    .set({ imageUrl: publicUrl, updatedAt: new Date() })
    .where(eq(recipes.id, recipeId));

  // Reclaim the previous object (only if it was one we created).
  const oldPath = objectPathFromPublicUrl(oldUrl);
  if (oldPath && oldPath !== path) {
    await client.storage.from(RECIPE_IMAGES_BUCKET).remove([oldPath]);
  }

  await logSystemAction(
    user,
    "Upload Recipe Image",
    `Image untuk "${recipe.name}" diunggah oleh ${user.name}`,
  );
  await logAudit(
    user,
    "recipes",
    recipeId,
    "UPDATE",
    { ...recipe, imageUrl: oldUrl } as Record<string, unknown>,
    { ...recipe, imageUrl: publicUrl } as Record<string, unknown>,
  );

  return { imageUrl: publicUrl };
}

/**
 * Remove a recipe's image (object + `image_url` column). Pure logic — the
 * `createServerFn` wrapper below applies the role gate and audit trail.
 */
export async function deleteRecipeImageFromStorage(
  recipeId: string,
  user: AppUser,
): Promise<{ success: true }> {
  const [recipe] = await db.select().from(recipes).where(eq(recipes.id, recipeId)).limit(1);
  if (!recipe) throw new Error("Recipe not found");

  const oldUrl = recipe.imageUrl ?? null;
  const oldPath = objectPathFromPublicUrl(oldUrl);

  const client = getSupabaseServerClient();
  if (oldPath) {
    const { error } = await client.storage.from(RECIPE_IMAGES_BUCKET).remove([oldPath]);
    if (error) throw new Error(`Storage delete failed: ${error.message}`);
  }

  await db
    .update(recipes)
    .set({ imageUrl: null, updatedAt: new Date() })
    .where(eq(recipes.id, recipeId));

  await logSystemAction(
    user,
    "Delete Recipe Image",
    `Image untuk "${recipe.name}" dihapus oleh ${user.name}`,
  );
  await logAudit(
    user,
    "recipes",
    recipeId,
    "UPDATE",
    { ...recipe, imageUrl: oldUrl } as Record<string, unknown>,
    { ...recipe, imageUrl: null } as Record<string, unknown>,
  );

  return { success: true };
}

type RecipeImageUploadInput = { recipeId: string; file: File };

/**
 * Extract the recipe id + image `File` from a multipart `FormData`.
 *
 * The client must send a `FormData` (built in the recipe routes): a bare
 * `File` cannot survive the server-fn JSON payload because TanStack Start's
 * default seroval plugins have no File/Blob/FormData serializer — the upload
 * would throw on the client before the request is even made. The framework
 * reconstructs the `File` server-side from the raw multipart body.
 */
export function parseRecipeImageFormData(data: unknown): RecipeImageUploadInput {
  if (!(data instanceof FormData)) {
    throw new Error("Expected a multipart FormData payload for image upload.");
  }
  const recipeId = data.get("recipeId");
  const file = data.get("file");
  z.string().uuid().parse(recipeId);
  if (!(file instanceof File) || !file.type) {
    throw new Error("No image file provided");
  }
  return { recipeId: recipeId as string, file: file as File };
}

export const uploadRecipeImage = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseRecipeImageFormData(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return uploadRecipeImageToStorage(data.recipeId, data.file, user);
  });

export const deleteRecipeImage = createServerFn({ method: "POST" })
  .validator((data: { recipeId: string }) => {
    z.string().uuid().parse(data.recipeId);
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return deleteRecipeImageFromStorage(data.recipeId, user);
  });
