// Deploy-time migration step (see vercel.json buildCommand).
//
// Why this exists (Data Penjualan outage, 2026-10-01): code selecting
// `orders.verified` was deployed while migration 0056 had never been applied
// to production — Data Penjualan rendered correct summary totals over an
// empty table and every transaction failed with `column "verified" does not
// exist`. Migrations now run as part of the deploy itself so code and schema
// ship together.
//
// Guard: migrations are applied ONLY on production deploys
// (VERCEL_ENV === "production"). Preview deployments build every open PR —
// if they migrated the shared production database, an unmerged branch could
// push schema changes ahead of its code. Local runs and CI are no-ops too.
const isProductionDeploy = process.env.VERCEL_ENV === "production";

if (!isProductionDeploy) {
  console.log(
    `[deploy-migrate] VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"} — skipping migrations (production deploys only).`,
  );
  process.exit(0);
}

// No connection string means we cannot migrate — but that is a configuration
// gap, not a schema problem, and it must not brick the build.
//
// Vercel scopes variables to Builds and/or Runtime independently. A DATABASE_URL
// set only for Runtime is absent here, drizzle-kit then fails with
// `Please provide required params for Postgres driver: [x] url: ''`, and this
// script's non-zero exit aborted the build — which is why deployments went
// missing on 2026-10-03 while CI stayed green. Skipping loudly keeps the deploy
// alive and names the setting that needs fixing.
//
// The cost is honest: with no build-time URL there is no fail-closed guarantee
// on deploy. Fix the variable's scope to restore it.
if (!process.env.DATABASE_URL) {
  console.warn(
    "[deploy-migrate] DATABASE_URL is not available at build time — skipping migrations.",
  );
  console.warn(
    "[deploy-migrate] If this project stores DATABASE_URL as a runtime-only Vercel variable, enable it for Builds as well, or schema changes will not be applied on deploy.",
  );
  process.exit(0);
}

console.log("[deploy-migrate] production deploy — running drizzle-kit migrate…");
const { spawnSync } = await import("node:child_process");

// `pnpm exec` resolves drizzle-kit from the project's own dependencies;
// inherit stdio so migration output lands in the Vercel build log.
const result = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
  stdio: "inherit",
});
if (result.status !== 0) {
  console.error(
    "[deploy-migrate] drizzle-kit migrate FAILED — aborting the deploy so code cannot ship ahead of its schema.",
  );
  process.exit(result.status ?? 1);
}
console.log("[deploy-migrate] migrations applied.");
