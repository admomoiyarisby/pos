import { describe, it, expect } from "vite-plus/test";
import { getSupabaseServerClient, RECIPE_IMAGES_BUCKET } from "#/lib/server/supabase";

const hasEnv = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("supabase server client", () => {
  it.skipIf(!hasEnv)(
    "authenticates with the service-role key and finds the public recipe-images bucket",
    // Live call to the Supabase project over the public internet. GitHub-hosted
    // runners occasionally take longer than the 5s default to reach it, which
    // failed runs against a perfectly healthy project — and, because `deploy`
    // now `needs` this job, blocked the deploy. A generous timeout plus retries
    // keeps the check meaningful without letting a network blip decide whether
    // code ships.
    { timeout: 30_000, retry: 3 },
    async () => {
      const client = getSupabaseServerClient();

      const { data, error } = await client.storage.listBuckets();
      expect(error, `listBuckets failed: ${error?.message}`).toBeNull();

      const bucket = data?.find((b) => b.name === RECIPE_IMAGES_BUCKET);
      expect(
        bucket,
        `bucket "${RECIPE_IMAGES_BUCKET}" should exist (create it in the Supabase dashboard)`,
      ).toBeDefined();
      expect(bucket?.public, "recipe-images bucket must be public").toBe(true);
    },
  );
});
