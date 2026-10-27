import { createFileRoute } from "@tanstack/react-router";
import { readFile, stat } from "node:fs/promises";
import { recipeImageAbsolutePath } from "#/lib/server/media";

const CONTENT_TYPES = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

function contentTypeFor(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES.get(ext) ?? "application/octet-stream";
}

export const Route = createFileRoute("/media/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const splat = params._splat ?? "";
        if (!splat.startsWith("recipe-images/")) {
          return new Response("Not found", { status: 404 });
        }
        const relativePath = splat.slice("recipe-images/".length);
        const absolutePath = recipeImageAbsolutePath(relativePath);
        if (!absolutePath) {
          return new Response("Not found", { status: 404 });
        }

        let body: Uint8Array;
        try {
          const info = await stat(absolutePath);
          if (!info.isFile()) return new Response("Not found", { status: 404 });
          body = await readFile(absolutePath);
        } catch {
          return new Response("Not found", { status: 404 });
        }

        return new Response(body, {
          headers: {
            "Content-Type": contentTypeFor(absolutePath),
            "Content-Length": String(body.byteLength),
            // Uploads get a fresh UUID, so a file at a given URL never changes.
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
