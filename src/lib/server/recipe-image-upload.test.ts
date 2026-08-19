import { describe, it, expect } from "vite-plus/test";
import { parseRecipeImageFormData } from "#/lib/server/recipe-images";

// Regression test for the recipe-image upload bug: a `File` cannot be sent
// inside the server-fn JSON payload (TanStack Start's default seroval plugins
// have no File serializer), so the client must send a multipart `FormData`.
// `parseRecipeImageFormData` enforces that contract on the server side.

function makeFile(type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], "x.png", { type });
}

const recipeId = "00000000-0000-0000-0000-000000000000";

describe("parseRecipeImageFormData", () => {
  it("extracts recipeId + File from a multipart FormData (the supported fix)", () => {
    const fd = new FormData();
    fd.set("recipeId", recipeId);
    fd.set("file", makeFile("image/png", 1024));

    const result = parseRecipeImageFormData(fd);

    expect(result.recipeId).toBe(recipeId);
    expect(result.file).toBeInstanceOf(File);
    expect(result.file.type).toBe("image/png");
  });

  it("rejects a File sent inside a JSON payload (the original bug)", () => {
    // Before the fix the client threw at serialization; now the server fn
    // rejects anything that isn't a FormData. Either way this must never
    // succeed — the upload must use the FormData transport.
    // `any` simulates the untyped JSON payload the framework would hand us.
    const jsonPayload: any = { recipeId, file: makeFile("image/png", 1024) };
    expect(() => parseRecipeImageFormData(jsonPayload)).toThrow(/multipart FormData/);
  });

  it("rejects a FormData with no file", () => {
    const fd = new FormData();
    fd.set("recipeId", recipeId);
    expect(() => parseRecipeImageFormData(fd)).toThrow(/No image file provided/);
  });

  it("rejects an invalid recipeId", () => {
    const fd = new FormData();
    fd.set("recipeId", "not-a-uuid");
    fd.set("file", makeFile("image/png", 1024));
    expect(() => parseRecipeImageFormData(fd)).toThrow();
  });
});
