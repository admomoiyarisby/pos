// Read-only: inspect drizzle.__drizzle_migrations rows in prod (what hashes
// are recorded, what folderMillis values) so the drift test can compare them
// against drizzle/meta/_journal.json reliably.
import "dotenv/config";
import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync(".env.local", "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  "select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 5",
);
console.log(JSON.stringify(rows, null, 1));
await client.end();
