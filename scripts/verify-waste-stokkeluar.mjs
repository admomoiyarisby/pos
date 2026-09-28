// Visual verification for two recent changes:
// 1. /stok-keluar — "Total Estimasi" (Rp) in the Rincian Stok Keluar header + footer
// 2. /waste — branch filter dropdown, Total Kerugian following the filter,
//    and the Cabang column hiding when a specific branch is selected
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const OUT = "screenshots";
const EMAIL = "superadmin@omoiyari.net";
const PASSWORD = "password123";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const failures = [];

function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures.push(name);
}

// ── Login ──
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
// SSR shell arrives first; wait for the client app to hydrate the mode buttons.
await page.waitForLoadState("domcontentloaded");
await page.waitForFunction(() => document.querySelectorAll("button").length > 2, {
  timeout: 30000,
});
// Default mode is PIN — switch to Email Login explicitly.
// (Playwright pointer clicks are flaky on this toggle; dispatch a real DOM click.)
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

// ── 1. Stok Keluar ──
await page.goto(`${BASE}/stok-keluar`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const headerText = await page.locator("body").innerText();
// NB: the label is styled with CSS `uppercase`, so innerText returns "TOTAL ESTIMASI".
check("Stok Keluar: 'Total Estimasi' badge present", /total estimasi/i.test(headerText));
const totalChip = page
  .locator("button[aria-expanded]")
  .filter({ hasText: "Rincian Stok Keluar" })
  .locator("span:has-text('Rp')");
check(
  "Stok Keluar: header shows an Rp total",
  (await totalChip.count()) > 0 && /Rp\s?[\d.]+/.test(await totalChip.first().innerText()),
);
// Expand the section and look for the footer total row
const toggle = page.locator("button[aria-expanded]").filter({ hasText: "Rincian Stok Keluar" });
if (
  await toggle
    .first()
    .getAttribute("aria-expanded")
    .then((v) => v !== "true")
) {
  await toggle.first().click();
  await page.waitForTimeout(800);
}
check(
  "Stok Keluar: footer 'Total Nilai (estimasi)' row present",
  /Total Nilai \(estimasi\)/.test(await page.locator("body").innerText()),
);
await page.screenshot({ path: `${OUT}/stok-keluar.png`, fullPage: true });

// ── 2. Waste ──
await page.goto(`${BASE}/waste`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const wasteBody = await page.locator("body").innerText();
check(
  "Waste: 'Filter cabang' dropdown present",
  (await page.locator('select[aria-label="Filter cabang"]').count()) > 0,
);
check("Waste: Total Kerugian card present", /total kerugian/i.test(wasteBody));
check("Waste: Cabang column visible when 'Semua Cabang'", /Cabang/.test(wasteBody));
await page.screenshot({ path: `${OUT}/waste-all-branches.png`, fullPage: true });

// Select a specific branch via the filter dropdown
const branchSelect = page.locator('select[aria-label="Filter cabang"]');
if ((await branchSelect.count()) > 0) {
  const options = branchSelect.locator("option");
  const n = await options.count();
  if (n > 1) {
    const value = await options.nth(1).getAttribute("value");
    const label = await options.nth(1).innerText();
    await branchSelect.selectOption(value);
    await page.waitForTimeout(1200);
    const body2 = await page.locator("body").innerText();
    // Header total card should now mention the branch name
    check(`Waste: Total Kerugian card names branch "${label}"`, body2.includes(label));
    // Cabang column should be hidden — the table header row no longer has it.
    // Heuristic: count table header cells named exactly "Cabang" (modal pickers
    // also use the word, so restrict to th elements).
    const thCabang = await page.locator("th", { hasText: /^Cabang$/ }).count();
    check("Waste: Cabang column hidden when branch filtered", thCabang === 0);
    await page.screenshot({ path: `${OUT}/waste-filtered.png`, fullPage: true });
  } else {
    console.log("SKIP  waste branch filter: only one option available");
  }
} else {
  console.log("SKIP  waste branch filter select not found");
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll visual checks passed");
