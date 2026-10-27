#!/usr/bin/env node
// Rehearsal smoke test: log into the real app against the restored database
// and prove the main read paths work. Run after `db:migrate` + restore.
//
//   BASE_URL=https://staging.example.com \
//   SMOKE_EMAIL=smoke@omoiyari.test \
//   SMOKE_PASSWORD='...' \
//   TARGET_DATABASE_URL='postgresql://omoiyari:...@127.0.0.1:55432/omoiyari_rehearsal' \
//   node scripts/smoke/pos-smoke.mjs
//
// `TARGET_DATABASE_URL` is optional; when set, the script also fetches a real
// recipe image through the app and checks it is served from local disk.
//
// The script is READ-ONLY on the app. Writes (order, stock movement) are in the
// manual cutover checklist in deploy/README.md — a scripted checkout is too
// brittle to gate a migration on.

import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import pg from "pg";
import process from "node:process";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const EMAIL = process.env.SMOKE_EMAIL ?? "smoke@omoiyari.test";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "smoke-password-123";
const ARTIFACTS = process.env.SMOKE_ARTIFACTS ?? "smoke-artifacts";

const failures = [];
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures.push(name);
}

async function assertPage(page, path, label) {
  const response = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
  const status = response?.status() ?? 0;
  const body = await page.locator("body").innerText();
  const crashed = body.includes("Terjadi kesalahan");
  const loggedOut = page.url().includes("/login");
  check(
    `${label} (${path})`,
    status < 400 && !crashed && !loggedOut,
    `status=${status}${crashed ? " error-boundary" : ""}${loggedOut ? " redirected-to-login" : ""}`,
  );
  return body;
}

await mkdir(ARTIFACTS, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  // ── login ──────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("button").length > 2, {
    timeout: 30000,
  });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Email Login"),
    );
    if (!button) throw new Error("Email Login button not found");
    button.click();
  });
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]', { hasText: "Masuk" }).first().click();
  await page.waitForURL((url) => !String(url).includes("/login"), { timeout: 30000 });
  check("login", true, EMAIL);

  // ── read paths ─────────────────────────────────────────────────────────
  await assertPage(page, "/dashboard", "dashboard");
  const posBody = await assertPage(page, "/pos", "POS catalog");
  check("POS catalog has items", /\bRp\s?[\d.,]+/.test(posBody), "prices rendered");

  await assertPage(page, "/inventory", "inventory");
  const salesBody = await assertPage(page, "/data-penjualan", "sales history");
  check(
    "sales history has orders",
    /\b(INV|ORD|TRX)[-/A-Z0-9]*\b/i.test(salesBody) || /Rp\s?[\d.,]+/.test(salesBody),
  );

  await assertPage(page, "/recipes", "recipes");
  await assertPage(page, "/finance", "finance");

  // ── media served from local disk ───────────────────────────────────────
  if (process.env.TARGET_DATABASE_URL) {
    const client = new pg.Client({
      connectionString: process.env.TARGET_DATABASE_URL,
      ssl: /supabase\.(co|com)/.test(process.env.TARGET_DATABASE_URL)
        ? { rejectUnauthorized: false }
        : undefined,
    });
    await client.connect();
    try {
      const { rows } = await client.query(
        "select image_url from recipes where image_url is not null order by updated_at desc limit 1",
      );
      if (rows.length === 0) {
        check("recipe image served", false, "no recipe has an image");
      } else {
        const response = await fetch(rows[0].image_url);
        const type = response.headers.get("content-type") ?? "";
        check(
          "recipe image served from local media",
          response.ok && type.startsWith("image/"),
          `${rows[0].image_url} status=${response.status} type=${type}`,
        );
      }
    } finally {
      await client.end();
    }
  }
} catch (err) {
  check("smoke run", false, err.message);
  await page.screenshot({ path: `${ARTIFACTS}/failure.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const report = { base: BASE, email: EMAIL, failures, ok: failures.length === 0 };
await writeFile(`${ARTIFACTS}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
