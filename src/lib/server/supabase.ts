import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the **service-role** key.
 *
 * This client bypasses Row Level Security and has full read/write access to
 * Storage (and the database). It must ONLY be imported from server code
 * (e.g. inside `createServerFn`s in `src/lib/server/`). Never import it from
 * a route component or any client-bundled module — the service-role key must
 * never reach the browser.
 */

/** Public Storage bucket that holds recipe images. */
export const RECIPE_IMAGES_BUCKET = "recipe-images";

function buildSupabaseServerClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Add both to .env.local (and your deploy secrets) to use Supabase Storage.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let _client: SupabaseClient | null = null;

/**
 * Returns a lazily-created, process-wide singleton Supabase service-role
 * client. Throws a clear error on first use if the required env vars are
 * missing, so misconfiguration fails fast.
 */
export function getSupabaseServerClient(): SupabaseClient {
  if (!_client) {
    _client = buildSupabaseServerClient();
  }
  return _client;
}
