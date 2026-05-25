import * as schema from "#/db/schema";

export const db = await (async () => {
  if (!import.meta.env.SSR) return null as any;
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return drizzle(process.env.DATABASE_URL!, { schema });
})();
