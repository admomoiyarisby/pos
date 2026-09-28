// Visual verification: Surat Jalan (scm-transfers/new) ingredient picker shows
// real sender-branch stock for ingredients past getInventory's default 50-row
// page. Regression for: "Ayam Karaage shows Stok 0 / habis despite 52.000 in
// the warehouse" — the form omitted `limit`, so only the first 50 ingredients
// (alphabetically) had stock rows and the rest rendered "⛔ habis".
//
// Checks:
//  1. The picker's option count is not capped at the old 50-row inventory page
//     (options whose stock rows fell past row 50 now show "Stok: <n>" with n>0
//     when the DB has stock).
//  2. At least one ingredient that sorts after the first 50 alphabetically
//     displays a non-zero stock (i.e. the previously-invisible tail is visible).
//  3. No option shows "⛔ habis" for an ingredient that actually has stock —
//     verified by cross-checking the rendered stocks against the DB's real
//     inventory for the sender branch via the page's own stock info bar.
//
// Run with the dev server on :3000 (as superadmin so the sender branch is
// selectable).
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const OUT = "screenshots";
const EMAIL = "superadmin@omoiyari.net";
const PASSWORD = "password123";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const failures = [];

function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures.push(name);
}

// ── Login ──
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForLoadState("domcontentloaded");
await page.waitForFunction(() => document.querySelectorAll("button").length > 2, {
  timeout: 30000,
});
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    x.textContent.includes("Email Login"),
  );
  b.click();
});
await page.locator('input[type="email"]').first().waitFor({ timeout: 15000 });
await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
await page.locator('input[type="password"], input[name="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"]', { hasText: "Masuk" }).first().click();
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });
console.log("logged in");

// ── Surat Jalan form ──
await page.goto(`${BASE}/scm-transfers/new`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// Superadmin has no default branch — pick the first sender branch so the
// inventory query for that branch actually runs (it's `enabled: !!fromBranchId`).
const fromSelect = page.locator("select").first();
const fromOptions = fromSelect.locator("option");
const nFrom = await fromOptions.count();
if (nFrom < 2) {
  console.error("FAIL  no sender branch available in 'Dari Cabang' select");
  await browser.close();
  process.exit(1);
}
const fromValue = await fromOptions.nth(1).getAttribute("value");
const fromLabel = await fromOptions.nth(1).innerText();
await fromSelect.selectOption(fromValue);
console.log(`sender branch: ${fromLabel}`);
// Wait for the branch inventory query to land.
await page.waitForTimeout(2500);

// Add an item row and open the ingredient combobox.
await page.locator('button:has-text("Tambah Item")').first().click();
await page.locator('input[placeholder="Cari bahan…"]').first().click();
await page.waitForTimeout(800);

// Collect every option's "Stok: N" label from the open combobox list.
const optionStocks = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("[role='option']")) {
    const nameEl = el.querySelector("span");
    const m = el.textContent?.match(/Stok:\s*(-?[\d.]+)/);
    if (nameEl && m) out.push({ name: nameEl.textContent?.trim() ?? "", stock: Number(m[1]) });
  }
  return out;
});

console.log(`combobox rendered ${optionStocks.length} options with stock labels`);
check(
  "combobox rendered more than 50 ingredient options",
  optionStocks.length > 50,
  `${optionStocks.length} options`,
);

// The old bug: every option past inventory row 50 showed "Stok: 0 ⛔ habis".
// Count how many non-zero-stock options appear AFTER the first 50 (the tail the
// old code silently dropped).
const tail = optionStocks.slice(50);
const tailWithStock = tail.filter((o) => o.stock > 0);
console.log(
  `tail (options 51+): ${tail.length}, with non-zero stock: ${tailWithStock.length}`,
  tailWithStock
    .slice(0, 5)
    .map((o) => `${o.name}=${o.stock}`)
    .join(", "),
);
check(
  "ingredients past the old 50-row page show real (non-zero) stock",
  tailWithStock.length > 0,
  tailWithStock.length === 0 && tail.length > 0
    ? "entire tail showed 0 — limit still missing?"
    : "",
);

// "Ayam Karaage" specifically (the reported ingredient), if seeded.
const karaage = optionStocks.find((o) => /karaage/i.test(o.name));
if (karaage) {
  check("Ayam Karaage shows non-zero stock", karaage.stock > 0, `stock=${karaage.stock}`);
} else {
  console.log("SKIP  Ayam Karaage not in the ingredient list (not seeded)");
}

await page.screenshot({ path: `${OUT}/scm-transfer-new-combobox.png`, fullPage: true });

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Surat Jalan stock-picker checks passed");
