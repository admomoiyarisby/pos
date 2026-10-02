// Migration-journal consistency check (CI tripwire).
//
// Verifies every entry in drizzle/meta/_journal.json has its migration SQL
// file present, and every drizzle/*.sql file is referenced by the journal.
// A partial migration commit (journal updated, file forgotten, or vice versa)
// makes `drizzle-kit migrate` apply nothing while the repo diverges — the
// bookkeeping confusion behind the 2026-10-01 schema-drift outage (migration
// 0056 committed but never applied to production).
//
// Snapshot files are NOT checked: this repo's history predates consistent
// snapshot tracking (many journal entries never had a snapshot committed),
// so a snapshot check would fail on every historical branch. The full
// SQL-drift check (bookkeeping vs journal against a live database) lives in
// src/lib/server/migrations.integration.test.ts and runs in the CI `test`
// job.
import { readFileSync, existsSync, readdirSync } from "node:fs";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));

let failed = false;
for (const entry of journal.entries) {
  const sqlFile = `drizzle/${entry.tag}.sql`;

  if (!existsSync(sqlFile)) {
    console.error(`✗ journal entry ${entry.tag}: missing ${sqlFile}`);
    failed = true;
  }
}

// Orphaned SQL files: present on disk but not in the journal — the reverse
// of a partial commit, and equally confusing to `migrate`.
const journalTags = new Set(journal.entries.map((e) => `${e.tag}.sql`));
for (const f of readdirSync("drizzle")) {
  if (f.endsWith(".sql") && !journalTags.has(f)) {
    console.error(`✗ orphaned migration drizzle/${f} — not referenced by _journal.json`);
    failed = true;
  }
}

if (failed) {
  console.error("\nMigration journal is inconsistent — fix the missing/orphaned files.");
  process.exit(1);
}
console.log(
  `✓ migration journal consistent: ${journal.entries.length} entries, every SQL file present and referenced.`,
);
