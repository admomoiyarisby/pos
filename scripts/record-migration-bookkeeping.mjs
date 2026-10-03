// Records bookkeeping for ONE migration whose SQL was applied to the test
// database out-of-band.
//
// `drizzle-kit migrate` exits 1 with no error output in this environment (seen
// on 0057 and 0058), so the statements are applied with psql and the bookkeeping
// row written here. The hash and folderMillis come from drizzle's own
// `readMigrationFiles` — the same function `src/lib/server/migration-drift.ts`
// uses — so they are exactly what the migrator would have written.
//
// Idempotent, and scoped to the tag given: it will not touch the pre-existing
// bookkeeping drift earlier in the table. Writes to the local test database
// unless `--prod --yes-i-mean-prod` is passed, because .env.local holds the live
// DATABASE_URL. Delete once `drizzle-kit migrate` works again.
import { readMigrationFiles } from "drizzle-orm/migrator";
import { readFileSync } from "node:fs";
import { Client } from "pg";

const tag = process.argv[2];
if (!tag) {
  console.error("usage: node scripts/record-migration-bookkeeping.mjs <tag>");
  process.exit(1);
}

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const entry = journal.entries.find((e) => e.tag === tag);
if (!entry) {
  console.error(`tag "${tag}" is not in drizzle/meta/_journal.json`);
  process.exit(1);
}

// readMigrationFiles returns entries in journal order, so index lines up.
const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
const idx = journal.entries.findIndex((e) => e.tag === tag);
const migration = migrations[idx];
if (!migration) {
  console.error(`drizzle/ does not contain a readable file for "${tag}"`);
  process.exit(1);
}

// Default is the local test database. `--prod` is required to write anywhere
// else, so this can never touch production by accident or by inherited env:
// .env.local holds the live DATABASE_URL, and an unqualified run would then
// record bookkeeping against the live database.
const targetProd = process.argv.includes("--prod");
let url;
let label;
if (targetProd) {
  url = process.env.DATABASE_URL;
  label = "PRODUCTION";
  if (!url) {
    console.error(
      "--prod needs DATABASE_URL set (it is in .env.local, which this script does not load)",
    );
    process.exit(1);
  }
  if (!process.argv.includes("--yes-i-mean-prod")) {
    console.error("Refusing to write to production without --yes-i-mean-prod.");
    process.exit(1);
  }
} else {
  url =
    process.env.TEST_DATABASE_URL ??
    "postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test";
  label = "test";
}

const client = new Client({ connectionString: url });
await client.connect();
console.log(`target: ${label}`);

const existing = await client.query(
  "select id from drizzle.__drizzle_migrations where created_at = $1 and hash = $2",
  [migration.folderMillis, migration.hash],
);
if (existing.rowCount && existing.rowCount > 0) {
  console.log(`= ${tag} already recorded`);
} else {
  const next = await client.query(
    "select coalesce(max(id), 0) + 1 as id from drizzle.__drizzle_migrations",
  );
  await client.query(
    "insert into drizzle.__drizzle_migrations (id, hash, created_at) values ($1, $2, $3)",
    [next.rows[0].id, migration.hash, migration.folderMillis],
  );
  console.log(
    `+ ${tag} recorded (${migration.hash.slice(0, 12)}…, folderMillis=${migration.folderMillis})`,
  );
}

const { rows } = await client.query(
  "select count(*)::int as count, max(created_at) as latest from drizzle.__drizzle_migrations",
);
console.log("bookkeeping:", rows[0], "| journal when:", entry.when);

await client.end();
