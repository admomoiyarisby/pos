/**
 * Mulyorejo channel-accounting migration (#42, design #40).
 *
 * Loads the historical June-2026 daily channel revenue for the Mulyorejo
 * outlet from the Pembukuan TENANT Excel into `channel_revenues`, and seeds
 * `platform_fees` for the marketplace channels.
 *
 * Source: docs/excel/File Omoiyari Pembukuan TENANT (Mulyorejo)-(Juni,2026).xlsx
 *   - Daily sheets named DDMMYYYY (e.g. "25062026" = 25 Jun 2026).
 *   - Each daily sheet's top table has one block per platform. The block's
 *     first row carries the platform name in column A ("PLATFORM") and the
 *     platform's GROSS daily revenue in the "Uang Masuk" column.
 *   - Platform label → channel enum:
 *       SHOPEE            → ShopeeFood
 *       GRAB              → Grabfood
 *       GOJEK             → Gofood
 *       OFFLINE           → Dine-in
 *       GRAB/ OFFLINE Q   → Grabfood (merged Grab + offline-QR; noted in `notes`)
 *
 * Decisions (design #40):
 *   - Daily granularity, GROSS amount (Uang Masuk).
 *   - date stored as ddmmyy (schema document-code convention).
 *   - submittedBy = Mulyorejo branch_admin, fallback super admin, fallback any user.
 *
 * Idempotent: channel_revenues upsert keyed (branchId, date, channel) via
 * ON CONFLICT DO NOTHING; platform_fees upsert by channel. No TRUNCATE.
 *
 * NOTE (ordering): a pure `migrate-csv` run seeds no users, and
 * channel_revenues.submitted_by is NOT NULL → users.id. If no user exists yet
 * the module logs a warning and SKIPS the revenue inserts (platform_fees still
 * seed). Run after the Path B demo seed (which creates users) to load revenue,
 * or ensure a user exists. See #43.
 */

import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import * as XLSX from "xlsx";
import { z } from "zod";

config({ path: [".env.local", ".env"] });

const XLSX_PATH = resolve(
  process.cwd(),
  "docs/excel/File Omoiyari Pembukuan TENANT (Mulyorejo)-(Juni,2026).xlsx",
);

const BRANCH_CODE = "MLY-01";

type OrderChannel = "Gofood" | "Grabfood" | "ShopeeFood" | "Dine-in" | "TikTok";

/** Map an Excel platform label to a channel enum (+ optional note). */
function mapPlatform(label: string): { channel: OrderChannel; note?: string } | null {
  const l = label.trim().toUpperCase();
  if (l === "SHOPEE") return { channel: "ShopeeFood" };
  if (l === "GOJEK") return { channel: "Gofood" };
  if (l === "GRAB") return { channel: "Grabfood" };
  if (l === "OFFLINE") return { channel: "Dine-in" };
  if (l.startsWith("GRAB/") || l.includes("OFFLINE Q"))
    return { channel: "Grabfood", note: "includes offline QR (merged GRAB/OFFLINE Q block)" };
  return null;
}

/** "25062026" (DDMMYYYY) → "250626" (ddmmyy). */
function sheetNameToDdmmyy(sheet: string): string | null {
  if (!/^\d{8}$/.test(sheet)) return null;
  const dd = sheet.slice(0, 2);
  const mm = sheet.slice(2, 4);
  const yy = sheet.slice(6, 8);
  return `${dd}${mm}${yy}`;
}

type RevenueRow = {
  date: string; // ddmmyy
  channel: OrderChannel;
  amount: number;
  note?: string;
};

/** Parse the workbook's daily sheets into (date, channel, gross amount) rows. */
function parseRevenue(): RevenueRow[] {
  const wb = XLSX.read(readFileSync(XLSX_PATH), { type: "buffer" });
  const rows: RevenueRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const date = sheetNameToDdmmyy(sheetName);
    if (!date) continue; // only DDMMYYYY daily sheets

    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });

    // Header row 0: [_, Tanggal, Nama Item, HPP, Jumlah, Jumlah QR,
    //   Total Jumlah, Total, Total HPP, Uang Masuk, Margin, Gross Profit]
    // Platform blocks live at the top; a second (inventory) section follows
    // with Uang Masuk empty. We only take rows where col A is a platform
    // label AND Uang Masuk (col 9) is a finite number.
    for (const row of grid) {
      // Excel cells arrive as `unknown`; a platform label is a string, and any
      // non-string cell is treated as empty (never stringified as an object).
      const label = z.string().catch("").parse(row[0]);
      if (!label.trim()) continue;
      const mapped = mapPlatform(label);
      if (!mapped) continue; // skip inventory-section rows / unknown labels
      const amount = Number(row[9]);
      if (!Number.isFinite(amount)) continue;
      rows.push({
        date,
        channel: mapped.channel,
        amount: Math.round(amount),
        note: mapped.note,
      });
    }
  }
  return rows;
}

const PLATFORM_FEES: { channel: OrderChannel; feePercentage: number; fixedFee: number }[] = [
  { channel: "ShopeeFood", feePercentage: 20, fixedFee: 0 },
  { channel: "Grabfood", feePercentage: 20, fixedFee: 0 },
  { channel: "Gofood", feePercentage: 20, fixedFee: 0 },
  { channel: "Dine-in", feePercentage: 0, fixedFee: 0 },
];

async function resolveSubmittedBy(client: Client): Promise<string | null> {
  // 1) Mulyorejo branch_admin.
  const byBranch = await client.query<{ id: string }>(
    `SELECT u.id FROM users u
       JOIN branches b ON b.id = u.branch_id
      WHERE b.code = $1 AND u.role = 'branch_admin'
      LIMIT 1`,
    [BRANCH_CODE],
  );
  if (byBranch.rows[0]) return byBranch.rows[0].id;

  // 2) Any super admin.
  const superAdmin = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE role = 'super_admin' LIMIT 1`,
  );
  if (superAdmin.rows[0]) return superAdmin.rows[0].id;

  // 3) Any user.
  const anyUser = await client.query<{ id: string }>(`SELECT id FROM users LIMIT 1`);
  return anyUser.rows[0]?.id ?? null;
}

export type ChannelAccountingOptions = { dryRun?: boolean };

export async function migrateChannelAccounting(
  options: ChannelAccountingOptions = {},
): Promise<void> {
  const rows = parseRevenue();

  if (options.dryRun) {
    // Aggregate for a compact summary.
    const byChannel = new Map<string, { count: number; total: number }>();
    for (const r of rows) {
      const agg = byChannel.get(r.channel) ?? { count: 0, total: 0 };
      agg.count += 1;
      agg.total += r.amount;
      byChannel.set(r.channel, agg);
    }
    console.log(
      `[channel-accounting] dry-run: would upsert ${rows.length} channel_revenues rows for ${BRANCH_CODE}, seed ${PLATFORM_FEES.length} platform_fees`,
    );
    for (const [ch, agg] of byChannel) {
      console.log(
        `  - ${ch}: ${agg.count} days, total gross Rp ${agg.total.toLocaleString("id-ID")}`,
      );
    }
    // Show first few rows for spot-checking.
    for (const r of rows.slice(0, 8)) {
      console.log(`      ${r.date} ${r.channel} Rp ${r.amount}${r.note ? ` (${r.note})` : ""}`);
    }
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Resolve branch id.
    const branch = await client.query<{ id: string }>(
      `SELECT id FROM branches WHERE code = $1 LIMIT 1`,
      [BRANCH_CODE],
    );
    const branchId = branch.rows[0]?.id;
    if (!branchId)
      throw new Error(`Branch ${BRANCH_CODE} not found — run branches migration first`);

    await client.query("BEGIN");

    // 1) platform_fees (idempotent upsert by channel).
    for (const f of PLATFORM_FEES) {
      await client.query(
        `INSERT INTO platform_fees (channel, fee_percentage, fixed_fee)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel) DO NOTHING`,
        [f.channel, f.feePercentage, f.fixedFee],
      );
    }

    // 2) channel_revenues — needs a submittedBy user (NOT NULL FK).
    const submittedBy = await resolveSubmittedBy(client);
    let inserted = 0;
    let skipped = 0;
    if (!submittedBy) {
      console.log(
        `  ! [channel-accounting] no users exist — skipping ${rows.length} channel_revenues rows ` +
          `(submitted_by is NOT NULL). Seed users (Path B) first, then re-run.`,
      );
    } else {
      // Merge duplicate (date, channel) rows by summing (e.g. a day with both
      // GRAB and GRAB/OFFLINE Q both mapping to Grabfood).
      const merged = new Map<string, RevenueRow>();
      for (const r of rows) {
        const key = `${r.date}|${r.channel}`;
        const cur = merged.get(key);
        if (cur) {
          cur.amount += r.amount;
          if (r.note && !cur.note) cur.note = r.note;
        } else {
          merged.set(key, { ...r });
        }
      }
      for (const r of merged.values()) {
        const res = await client.query(
          `INSERT INTO channel_revenues (branch_id, date, channel, amount, notes, submitted_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (branch_id, date, channel) DO NOTHING`,
          [branchId, r.date, r.channel, r.amount, r.note ?? null, submittedBy],
        );
        if (res.rowCount && res.rowCount > 0) inserted += 1;
        else skipped += 1;
      }
    }

    await client.query("COMMIT");
    console.log(
      `[channel-accounting] platform_fees ensured (${PLATFORM_FEES.length}); ` +
        `channel_revenues inserted ${inserted}, skipped ${skipped} (existing)`,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}
