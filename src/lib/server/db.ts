import * as schema from "#/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

type Database = NodePgDatabase<typeof schema>;

export const db: Database = await (async () => {
  if (!import.meta.env.SSR) return null as unknown as Database;
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return drizzle(process.env.DATABASE_URL!, { schema });
})();
