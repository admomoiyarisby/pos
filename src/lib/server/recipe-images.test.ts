import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  uploadRecipeImageToStorage,
  deleteRecipeImageFromStorage,
  objectPathFromPublicUrl,
} from "#/lib/server/recipe-images";

// --- mocks ---------------------------------------------------------------

import type { AppUser } from "#/lib/server/auth";

const fakeUser: AppUser = {
  id: "u1",
  name: "Tester",
  email: "tester@pos.test",
  role: "super_admin",
  status: "Active",
};

const PUBLIC_BASE = "https://pos.test";
let mediaRoot = "";

const updated: Array<{ imageUrl: string | null }> = [];
type RecipeRow = { id: string; name: string; imageUrl: string | null };
const row: RecipeRow = {
  id: "rid",
  name: "Nasi Goreng",
  imageUrl: null,
};

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ validator: () => ({ handler: () => ({}) }) }),
}));

vi.mock("#/lib/server/auth", () => ({
  requireRole: async () => fakeUser,
}));

vi.mock("#/lib/server/logging", () => ({
  logSystemAction: async () => {},
  logAudit: async () => {},
}));

// Minimal Drizzle chain mock: returns the mutable recipe row, records updates.
vi.mock("#/lib/server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [row],
        }),
      }),
    }),
    update: () => ({
      set: (values: { imageUrl: string | null }) => ({
        where: async () => {
          updated.push(values);
          row.imageUrl = values.imageUrl;
          return [{ id: "rid" }];
        },
      }),
    }),
  },
}));

// --- helpers -------------------------------------------------------------

function makeFile(type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], "x.png", { type });
}

function recipeImagesDir(): string {
  return path.join(mediaRoot, "recipe-images");
}

beforeEach(async () => {
  mediaRoot = await mkdtemp(path.join(tmpdir(), "pos-media-"));
  process.env.MEDIA_ROOT = mediaRoot;
  process.env.PUBLIC_BASE_URL = PUBLIC_BASE;
  updated.length = 0;
  row.imageUrl = null;
});

afterEach(async () => {
  delete process.env.MEDIA_ROOT;
  delete process.env.PUBLIC_BASE_URL;
  await rm(mediaRoot, { recursive: true, force: true });
});

// --- tests ---------------------------------------------------------------

describe("objectPathFromPublicUrl", () => {
  it("extracts the path from a media URL", () => {
    expect(objectPathFromPublicUrl(`${PUBLIC_BASE}/media/recipe-images/recipes/rid/a.png`)).toBe(
      "recipes/rid/a.png",
    );
  });

  it("ignores foreign and traversal URLs", () => {
    expect(objectPathFromPublicUrl(null)).toBeNull();
    expect(
      objectPathFromPublicUrl("https://x.supabase.co/storage/v1/object/public/recipe-images/a.png"),
    ).toBeNull();
    expect(
      objectPathFromPublicUrl(`${PUBLIC_BASE}/media/recipe-images/../../etc/passwd`),
    ).toBeNull();
  });
});

describe("uploadRecipeImageToStorage", () => {
  it("writes the file, stores the public URL, and removes nothing on first upload", async () => {
    const file = makeFile("image/png", 1024);
    const res = await uploadRecipeImageToStorage("rid", file, fakeUser);

    expect(res.imageUrl).toMatch(
      new RegExp(`^${PUBLIC_BASE}/media/recipe-images/recipes/rid/[0-9a-f-]+\\.png$`),
    );
    const relativePath = res.imageUrl.replace(`${PUBLIC_BASE}/media/recipe-images/`, "");
    const onDisk = await readFile(path.join(recipeImagesDir(), relativePath));
    expect(onDisk.byteLength).toBe(1024);
    expect(updated[0]).toMatchObject({ imageUrl: res.imageUrl });
  });

  it("rejects unsupported types", async () => {
    await expect(
      uploadRecipeImageToStorage("rid", makeFile("image/gif", 10), fakeUser),
    ).rejects.toThrow(/Unsupported image type/);
  });

  it("rejects oversized files (>2 MB)", async () => {
    await expect(
      uploadRecipeImageToStorage("rid", makeFile("image/png", 3 * 1024 * 1024), fakeUser),
    ).rejects.toThrow(/too large/);
  });

  it("removes the previous file when replacing", async () => {
    const first = await uploadRecipeImageToStorage("rid", makeFile("image/png", 10), fakeUser);
    const firstPath = first.imageUrl.replace(`${PUBLIC_BASE}/media/recipe-images/`, "");

    const second = await uploadRecipeImageToStorage("rid", makeFile("image/png", 20), fakeUser);
    const secondPath = second.imageUrl.replace(`${PUBLIC_BASE}/media/recipe-images/`, "");

    expect(secondPath).not.toBe(firstPath);
    const files = await readdir(path.join(recipeImagesDir(), "recipes", "rid"));
    expect(files).toEqual([path.basename(secondPath)]);
  });
});

describe("deleteRecipeImageFromStorage", () => {
  it("removes the file and clears image_url", async () => {
    await uploadRecipeImageToStorage("rid", makeFile("image/png", 10), fakeUser);

    await deleteRecipeImageFromStorage("rid", fakeUser);

    const files = await readdir(path.join(recipeImagesDir(), "recipes", "rid"));
    expect(files).toEqual([]);
    expect(updated.at(-1)).toMatchObject({ imageUrl: null });
  });

  it("clears image_url when the file is already missing", async () => {
    row.imageUrl = `${PUBLIC_BASE}/media/recipe-images/recipes/rid/gone.png`;
    await expect(deleteRecipeImageFromStorage("rid", fakeUser)).resolves.toEqual({ success: true });
    expect(updated.at(-1)).toMatchObject({ imageUrl: null });
  });
});
