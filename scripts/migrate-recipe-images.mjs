#!/usr/bin/env node
// Move recipe images from Supabase Storage to the VPS's local media directory,
// then point the target database at the new URLs.
//
// The source database is only READ. The target database is updated, so a
// failed cutover can still fall back to Supabase with no repair step.
//
//   SOURCE_DATABASE_URL='postgresql://...:5432/postgres' \
//   TARGET_DATABASE_URL='postgresql://omoiyari:...@127.0.0.1:55432/omoiyari' \
//   MEDIA_ROOT=/srv/omoiyari-pos/media \
//   PUBLIC_BASE_URL=https://pos.example.com \
//   node scripts/migrate-recipe-images.mjs --dry-run
//
// Drop --dry-run to download and rewrite. Re-running is safe: existing files
// are skipped (identical bytes) and already-rewritten rows no longer match.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const SUPABASE_PREFIX = "/storage/v1/object/public/recipe-images/";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const sourceUrl = required("SOURCE_DATABASE_URL");
const targetUrl = required("TARGET_DATABASE_URL");
const mediaRoot = path.resolve(process.env.MEDIA_ROOT ?? "/srv/omoiyari-pos/media");
const publicBase = required("PUBLIC_BASE_URL").replace(/\/+$/, "");
const dryRun = process.argv.includes("--dry-run");

const client = (url) =>
  new pg.Client({
    connectionString: url,
    // Supabase terminates TLS; the local tunnel/container does not.
    ssl: /supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined,
  });

function objectPath(imageUrl) {
  const index = imageUrl.indexOf(SUPABASE_PREFIX);
  if (index === -1) return null;
  const relativePath = decodeURIComponent(imageUrl.slice(index + SUPABASE_PREFIX.length));
  const segments = relativePath.split("/");
  if (!relativePath || segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return relativePath;
}

function mediaPath(relativePath) {
  const root = path.resolve(mediaRoot, "recipe-images");
  const target = path.resolve(root, ...relativePath.split("/"));
  if (!target.startsWith(root + path.sep)) throw new Error(`Unsafe path: ${relativePath}`);
  return target;
}

const source = client(sourceUrl);
const target = client(targetUrl);
await source.connect();
await target.connect();

try {
  const { rows } = await source.query(
    "select id, name, image_url from recipes where image_url like $1 order by id",
    [`%${SUPABASE_PREFIX}%`],
  );
  console.log(`found ${rows.length} Supabase image URLs`);

  let downloaded = 0;
  let skipped = 0;
  const failures = [];

  for (const row of rows) {
    const relativePath = objectPath(row.image_url);
    if (!relativePath) {
      failures.push({ id: row.id, reason: "unparseable URL", url: row.image_url });
      continue;
    }
    const targetPath = mediaPath(relativePath);
    const newUrl = `${publicBase}/media/recipe-images/${relativePath}`;

    try {
      const response = await fetch(row.image_url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());

      let existing = null;
      try {
        existing = await readFile(targetPath);
      } catch {
        // Not downloaded yet.
      }

      if (existing && existing.byteLength === bytes.byteLength) {
        skipped += 1;
      } else {
        if (!dryRun) {
          await mkdir(path.dirname(targetPath), { recursive: true });
          await writeFile(targetPath, bytes);
        }
        downloaded += 1;
      }

      if (!dryRun) {
        await target.query("update recipes set image_url = $1, updated_at = now() where id = $2", [
          newUrl,
          row.id,
        ]);
      }
      console.log(
        `${dryRun ? "would move" : "moved"} ${row.name}: ${relativePath} (${bytes.byteLength} B)`,
      );
    } catch (err) {
      failures.push({ id: row.id, reason: err.message, url: row.image_url });
    }
  }

  const remaining = await target.query(
    "select count(*)::int n from recipes where image_url like $1",
    [`%${SUPABASE_PREFIX}%`],
  );

  console.log(
    JSON.stringify(
      {
        dryRun,
        total: rows.length,
        downloaded,
        skipped,
        failed: failures.length,
        failures,
        targetSupabaseUrlsRemaining: remaining.rows[0].n,
        mediaRoot,
        publicBase,
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) process.exitCode = 1;
  if (!dryRun && remaining.rows[0].n > 0) process.exitCode = 1;
} finally {
  await source.end();
  await target.end();
}
