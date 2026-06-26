import * as schema from "#/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

type Database = NodePgDatabase<typeof schema>;

export const db: Database = await (async () => {
  // Outside Vite (no import.meta.env, e.g. tsx scripts) treat as SSR.
  // The original check `!import.meta.env.SSR` throws a TypeError when
  // `import.meta.env` is undefined.
  const isSSR =
    typeof import.meta.env === "undefined" ? true : import.meta.env.SSR;
  if (!isSSR) return null as unknown as Database;
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return drizzle(process.env.DATABASE_URL!, { schema });
})();
