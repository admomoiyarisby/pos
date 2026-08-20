import * as schema from "#/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

type Database = NodePgDatabase<typeof schema>;

export const db: Database = await (async () => {
  // `import.meta.env.SSR` is statically replaced by the bundler: false in the
  // client bundle (so the `pg` driver is never loaded in the browser) and true
  // in the SSR bundle. Do NOT gate on `"env" in import.meta`: `import.meta.env`
  // is a build-time replacement, not a real property of `import.meta`, so that
  // check is false in the browser and would eagerly load `pg` (crashing on
  // `Buffer is not defined`). Outside Vite (no `import.meta.env`, e.g. tsx
  // scripts) the optional chaining yields undefined and we treat it as SSR.
  const isSSR = import.meta.env?.SSR ?? true;
  // SAFETY: in the client bundle `db` is never actually called (server-only
  // modules); the assertion keeps the import type stable without crashing the
  // bundle, and the `!isSSR` branch is unreachable at runtime.
  if (!isSSR) {
    // SAFETY: `never` is only ever used as a type-level placeholder for the
    // dead client branch; db is never invoked in the bundle.
    return null as never;
  }
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return drizzle(process.env.DATABASE_URL!, { schema });
})();
