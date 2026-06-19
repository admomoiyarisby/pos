/**
 * CSV migration orchestrator.
 *
 * Runs every registered migration in declaration order. Pass `--only
 * <name>` to run a single one (useful when iterating on a single CSV).
 *
 * Convention:
 *   - Each migration module exports an async function `(opts) => void`
 *     where `opts.dryRun` lets the caller preview without touching the DB.
 *   - Migrations may declare `truncateTables`; the orchestrator TRUNCATEs
 *     those tables (CASCADE) before the migration runs, but only once per
 *     table per run (so a downstream migration on the same table can
 *     rely on a clean state without re-truncating).
 *   - Migrations should declare dependencies via position: declare them
 *     in the order they must run. The orchestrator does NOT auto-resolve
 *     dependencies from a graph; the file's `migrations` map is the
 *     declaration order.
 */

import { config } from "dotenv";
import { Client } from "pg";

import { migrateBranches } from "./branches";
import { migrateIngredientsCentral } from "./ingredients-central";
import { migrateIngredientsTenant } from "./ingredients-tenant";
import { migrateRecipesRincian } from "./recipes-rincian";
import { migrateMenuKasir } from "./menu-kasir";

config({ path: [".env.local", ".env"] });

type MigrationOptions = { dryRun?: boolean };
type MigrationFn = (options: MigrationOptions) => Promise<void>;

type MigrationSpec = {
  fn: MigrationFn;
  /** Tables to TRUNCATE CASCADE before this migration runs (only once per run). */
  truncateTables?: string[];
};

const migrations: Record<string, MigrationSpec> = {
  branches: {
    fn: migrateBranches,
    truncateTables: ["branches"],
  },
  "ingredients-central": {
    fn: migrateIngredientsCentral,
    truncateTables: ["ingredients"],
  },
  "ingredients-tenant": {
    fn: migrateIngredientsTenant,
  },
  "recipes-rincian": {
    fn: migrateRecipesRincian,
    truncateTables: ["recipes"],
  },
  "menu-kasir": {
    fn: migrateMenuKasir,
  },
  // "staff-menu":           { fn: migrateStaffMenu,           truncateTables: ["recipes"] },
  // "harga-invoice":        { fn: migrateHargaInvoice,        truncateTables: ["recipes"] },
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
  console.log("Registered migrations (in declared order):");
  for (const n of names) console.log(`  - ${n}`);
  if (names.length === 0) console.log("  (none yet)");
}

async function truncateTablesOnce(
  url: string,
  tables: string[],
  alreadyTruncated: Set<string>,
): Promise<void> {
  const toTruncate = tables.filter((t) => !alreadyTruncated.has(t));
  if (toTruncate.length === 0) return;

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Quote each identifier to defend against reserved words.
    const list = toTruncate.map((t) => `"${t}"`).join(", ");
    await client.query(`TRUNCATE TABLE ${list} CASCADE`);
  } finally {
    await client.end();
  }
  for (const t of toTruncate) alreadyTruncated.add(t);
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

  const url = dryRun ? null : (process.env.DATABASE_URL ?? null);
  if (!dryRun && !url) {
    console.error("DATABASE_URL is not set (required for non-dry-run).");
    process.exit(1);
  }

  const alreadyTruncated = new Set<string>();
  for (const name of targets) {
    console.log(`[migrate-csv] → ${name}`);
    const spec = migrations[name]!;
    if (!dryRun && spec.truncateTables && url) {
      await truncateTablesOnce(url, spec.truncateTables, alreadyTruncated);
    }
    await spec.fn({ dryRun });
  }
  console.log("[migrate-csv] done.");
}

main().catch((err) => {
  console.error("[migrate-csv] failed:", err);
  process.exit(1);
});
