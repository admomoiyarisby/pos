import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local disk storage for recipe images.
 *
 * The app writes under `$MEDIA_ROOT/recipe-images/<path>` and serves the files
 * from `/media/recipe-images/<path>`. `MEDIA_ROOT` is a mounted volume in
 * production (see deploy/compose.yaml) and `.media/` in local development.
 *
 * Keep this module server-only. It uses Node's fs APIs and must never be
 * imported from a client-bundled module.
 */

const RECIPE_IMAGES_DIR = "recipe-images";

function mediaRoot(): string {
  return (
    process.env.MEDIA_ROOT ?? (process.env.NODE_ENV === "production" ? "/app/media" : ".media")
  );
}

function publicBaseUrl(): string {
  const base = process.env.PUBLIC_BASE_URL ?? process.env.BETTER_AUTH_URL;
  if (!base) {
    throw new Error(
      "Missing PUBLIC_BASE_URL or BETTER_AUTH_URL. Set one to build recipe image URLs.",
    );
  }
  return base.replace(/\/+$/, "");
}

export function recipeImageUrl(relativePath: string): string {
  return `${publicBaseUrl()}/media/${RECIPE_IMAGES_DIR}/${relativePath}`;
}

/**
 * Resolve a stored path to an absolute file path, or null when the path would
 * escape the media directory. Rejects absolute paths, empty segments, `.` and
 * `..`, and backslashes. The generated paths never contain any of these, so a
 * rejection means the input came from outside the app.
 */
export function recipeImageAbsolutePath(relativePath: string): string | null {
  if (!relativePath || relativePath.includes("\\")) return null;

  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }

  const root = path.resolve(mediaRoot(), RECIPE_IMAGES_DIR);
  const target = path.resolve(root, ...segments);
  return target.startsWith(root + path.sep) ? target : null;
}

export async function writeRecipeImage(relativePath: string, data: Uint8Array): Promise<void> {
  const target = recipeImageAbsolutePath(relativePath);
  if (!target) throw new Error(`Unsafe recipe image path: ${relativePath}`);

  await mkdir(path.dirname(target), { recursive: true });
  // `wx` fails instead of overwriting: every upload path ends in a fresh UUID.
  await writeFile(target, data, { flag: "wx" });
}

export async function deleteRecipeImage(relativePath: string): Promise<void> {
  const target = recipeImageAbsolutePath(relativePath);
  if (!target) return;

  try {
    await unlink(target);
  } catch (err) {
    // SAFETY: fs errors carry a string `code`; only a missing file is ignored.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
