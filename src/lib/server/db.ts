import * as schema from "#/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

type Database = NodePgDatabase<typeof schema>;

export const db: Database = await (async () => {
  // Outside Vite (no import.meta.env, e.g. tsx scripts) treat as SSR.
  // The original check `!import.meta.env.SSR` throws a TypeError when
  // `import.meta.env` is undefined.
  const isSSR = "env" in import.meta ? import.meta.env.SSR : true;
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
