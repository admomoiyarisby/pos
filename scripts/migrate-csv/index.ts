/**
 * CSV migration orchestrator.
 *
 * Runs every registered migration in declaration order. Pass `--only
 * <name>` to run a single one (useful when iterating on a single CSV).
 *
 * Convention: each migration module exports an async function with the
 * same name as the source CSV (without the `.csv` extension and without
 * "Detail POS - " prefix).
 */

import { migrateBranches } from "./branches";

type MigrationFn = (options: { dryRun?: boolean }) => Promise<void>;

const migrations: Record<string, MigrationFn> = {
  branches: migrateBranches,
  // menu: migrateMenu,              // upcoming CSVs
  // ingredients-central: ...,
  // ingredients-tenant: ...,
  // staff-menu: ...,
  // invoice-prices: ...,
};

function parseArgs(argv: string[]): { only: string | null; dryRun: boolean; help: boolean } {
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx >= 0 ? (argv[onlyIdx + 1] ?? "") || null : null;
  const dryRun = argv.includes("--dry-run");
  const help = argv.includes("--help") || argv.includes("-h");
  return { only, dryRun, help };
}

function printHelp(): void {
  const names = Object.keys(migrations);
  console.log("Usage: vp run migrate-csv [--only <name>] [--dry-run]");
  console.log("");
  console.log("Options:");
  console.log("  --only <name>  Run only the named migration");
  console.log("  --dry-run      Parse the CSV and print rows without touching the DB");
  console.log("");
  console.log("Registered migrations:");
  for (const n of names) console.log(`  - ${n}`);
  if (names.length === 0) console.log("  (none yet)");
}

async function main(): Promise<void> {
  const { only, dryRun, help } = parseArgs(process.argv.slice(2));
  if (help) {
    printHelp();
    return;
  }

  const targets = only
    ? Object.keys(migrations).filter((n) => n === only)
    : Object.keys(migrations);

  if (only && targets.length === 0) {
    console.error(`Unknown migration: "${only}". Run with --help to list registered names.`);
    process.exit(1);
  }

  console.log(`[migrate-csv] running ${targets.length} migration(s)${dryRun ? " (dry-run)" : ""}`);
  for (const name of targets) {
    console.log(`[migrate-csv] → ${name}`);
    await migrations[name]!({ dryRun });
  }
  console.log("[migrate-csv] done.");
}

main().catch((err) => {
  console.error("[migrate-csv] failed:", err);
  process.exit(1);
});
