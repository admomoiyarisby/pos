/**
 * verify-seed.ts — READ-ONLY consistency check.
 *
 * Re-derives the "expected" DB state from the canonical source files
 * (docs/csv/* + docs/excel/*) using the SAME parsing + normalization
 * code the migrations use, then diffs it against the live database.
 *
 * This validates Path A (migrate-csv owns the seed) — i.e. that the rows
 * actually in the DB follow the source data — which the existing
 * docs/csv/compare_report*.py scripts do NOT do (they only compare
 * CSV → seed-data.ts, the deprecated Path B).
 *
 * No writes. Point it at any database via DATABASE_URL / PGURL.
 *
 *   npx tsx scripts/verify-seed.ts
 *   PGURL=postgresql://... npx tsx scripts/verify-seed.ts
 */

import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import * as XLSX from "xlsx";

import { parseCsv, findColumn, findHeader, findColumns } from "./migrate-csv/csv";
import { canonicalName, classify, normaliseUnit } from "./migrate-csv/normalize";
import { formatLocation, parseAddress } from "./migrate-csv/address";

config({ path: [".env.local", ".env"] });

const CSV = (name: string) => resolve(process.cwd(), "docs/csv", name);
const XLSX_PATH = resolve(
  process.cwd(),
  "docs/excel/File Omoiyari Pembukuan TENANT (Mulyorejo)-(Juni,2026).xlsx",
);

// ─── BRANCH_CODE_MAP (frozen, mirrors branches.ts) ───
const BRANCH_CODE_MAP: Record<string, string> = {
  "Omoiyari Wiyung": "WYG",
  "Omoiyari Darmo Permai": "DRM",
  "Omoiyari Tenggilis": "TGL",
  "Omoiyari Mulyorejo": "MLY",
  "Omoiyari Jambangan": "JMB",
  "Omoiyari Pucang": "PCG",
  "Omoiyari Siwalankerto": "SWL",
};

const ALIAS_RECIPES: Record<string, string> = {
  "japanese curry karaage don": "Curry Karage Don",
  "japanese curry katsu don": "Curry Katsu Don",
  gohan: "nasi putih",
  "es teh": "Ice Tea",
  "caramel puding": "Caramel Pudding",
  "extra curry sauce": "Curry Sauce",
};

const OPERATIONAL_SECTIONS = ["barang keluar", "operasional"];

type Diff = { kind: "MISSING" | "EXTRA" | "MISMATCH"; msg: string };
const diffs: Diff[] = [];
let checks = 0;
let ok = 0;
function record(kind: Diff["kind"], msg: string) {
  diffs.push({ kind, msg });
}
function expect(cond: boolean) {
  checks++;
  if (cond) ok++;
  return cond;
}

// ═══════════════════════════════════════════════════════════════════════
// EXPECTED STATE DERIVATION
// ═══════════════════════════════════════════════════════════════════════

// ── Branches ──
function expectedBranches() {
  const raw = readFileSync(CSV("Detail POS - List Cabang.csv"), "utf-8");
  const table = parseCsv(raw);
  const nameCol = findColumn(table.header, "Brand - Outletname");
  const addrCol = findColumn(table.header, "Outlet Location Address");
  const out: { code: string; name: string; location: string; type: string }[] = [];
  for (const row of table.rows) {
    const name = (row[nameCol] ?? "").trim();
    if (!name) continue;
    const prefix = BRANCH_CODE_MAP[name];
    if (!prefix) continue;
    const location = formatLocation(parseAddress(row[addrCol] ?? ""));
    out.push({
      code: `${prefix}-01`,
      name,
      location,
      type: "Outlet",
    });
  }
  return out;
}

// ── Ingredients (union of Central + Tenant, dedup by canonical name) ──
type IngExp = { name: string; category: string; skuType: string; unit: string };
function expectedIngredients(): Map<string, IngExp> {
  const merge = (file: string, unitHeader: string) => {
    const raw = readFileSync(CSV(file), "utf-8");
    const table = parseCsv(raw);
    const d = findHeader(table, ["Nama Bahan", unitHeader]);
    if (!d) return;
    const nameCol = d.indices["nama bahan"]!;
    const unitCol = d.indices[unitHeader.toLowerCase()]!;
    for (const row of d.data) {
      const rawName = (row[nameCol] ?? "").trim();
      if (!rawName) continue;
      const canonical = canonicalName(rawName);
      if (canonical === null) continue; // operational
      const key = canonical.toLowerCase();
      if (map.has(key)) continue; // first wins (central before tenant)
      const cls = classify(canonical);
      const unit = normaliseUnit(row[unitCol] ?? "");
      map.set(key, { name: canonical, category: cls.category, skuType: cls.skuType, unit });
    }
  };
  const map = new Map<string, IngExp>();
  merge("Detail POS - List Item Central Kitchen.csv", "Satuan");
  merge("Detail POS - List Item Tenant (Cabang).csv", "Satuan Inventory");
  return map;
}

// ── Ingredient average cost from Harga Invoice (per-item) ──
function expectedCosts(): Map<string, number> {
  const raw = readFileSync(CSV("Detail POS - Harga Invoice all.csv"), "utf-8");
  const table = parseCsv(raw);
  const map = new Map<string, number>();
  const COL_LEFT_NO = 0;
  const COL_LEFT_ITEM = 1;
  const COL_LEFT_PER_UNIT = 6;
  for (const row of table.rows) {
    const rawName = (row[COL_LEFT_ITEM] ?? "").trim();
    if (!rawName) continue;
    if (rawName.toLowerCase() === "item") continue;
    if (rawName.toLowerCase().startsWith("harga invoice")) continue;
    if (!/^\d+$/.test((row[COL_LEFT_NO] ?? "").trim())) continue;
    const perUnit = parseIdrPerUnit(row[COL_LEFT_PER_UNIT] ?? "");
    if (!perUnit) continue;
    const canonical = canonicalName(rawName);
    if (canonical === null) continue;
    map.set(canonical.toLowerCase(), perUnit);
  }
  return map;
}

function parseIdr(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toUpperCase() === "FREE") return 0;
  const cleaned = trimmed.replace(/[^0-9.,]/g, "");
  if (!cleaned) return 0;
  const hasDot = cleaned.includes(".");
  const hasComma = cleaned.includes(",");
  if (hasDot && hasComma) {
    const lastDot = cleaned.lastIndexOf(".");
    const lastComma = cleaned.lastIndexOf(",");
    if (lastComma > lastDot)
      return Math.round(parseFloat(cleaned.replace(/\./g, "").replace(",", ".")));
    return Math.round(parseFloat(cleaned.replace(/,/g, "")));
  }
  if (hasComma) {
    const after = cleaned.slice(cleaned.lastIndexOf(",") + 1);
    if (after.length === 2) return Math.round(parseFloat(cleaned.replace(",", ".")));
    return parseInt(cleaned.replace(/,/g, ""), 10);
  }
  if (hasDot) {
    const after = cleaned.slice(cleaned.lastIndexOf(".") + 1);
    if (after.length === 2) return Math.round(parseFloat(cleaned));
    return parseInt(cleaned.replace(/\./g, ""), 10);
  }
  return parseInt(cleaned, 10);
}

function parseIdrPerUnit(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const cleaned = trimmed.replace(/[^0-9.,]/g, "");
  if (!cleaned) return 0;
  const hasDot = cleaned.includes(".");
  const hasComma = cleaned.includes(",");
  if (hasDot && hasComma) {
    const lastDot = cleaned.lastIndexOf(".");
    const lastComma = cleaned.lastIndexOf(",");
    if (lastComma > lastDot)
      return Math.round(parseFloat(cleaned.replace(/\./g, "").replace(",", ".")));
    return Math.round(parseFloat(cleaned.replace(/,/g, "")));
  }
  if (hasComma) {
    const after = cleaned.slice(cleaned.lastIndexOf(",") + 1);
    if (after.length <= 2) return Math.round(parseFloat(cleaned.replace(",", ".")));
    return parseInt(cleaned.replace(/,/g, ""), 10);
  }
  if (hasDot) {
    const after = cleaned.slice(cleaned.lastIndexOf(".") + 1);
    if (after.length <= 2) return Math.round(parseFloat(cleaned));
    return parseInt(cleaned.replace(/\./g, ""), 10);
  }
  return parseInt(cleaned, 10);
}

// ── Recipes (Rincian Menu names) + Menu Kasir prices ──
type RecipeExp = { name: string; basePrice: number; totalCogs: number; category: string };
function classifyRecipe(name: string): string {
  const l = name.toLowerCase();
  if (/\b(latte|tea|jus|es teh|matcha|coffee)\b/.test(l)) return "minuman";
  if (l.includes("sauce") || l.startsWith("extra ") || l.includes("add")) return "add_ons";
  return "makanan";
}

function expectedRecipes(): {
  byName: Map<string, RecipeExp>;
  bomByName: Map<string, Map<string, number>>; // recipe name -> (ing canonical -> total qty)
} {
  // 1) Rincian Menu -> recipe names + BOM
  const rawR = readFileSync(CSV("Detail POS - Rincian Menu.csv"), "utf-8");
  const tR = parseCsv(rawR);
  const dR = findColumns(tR, ["Menu", "Bahan", "Berat"]);
  const recipeNames = new Map<string, RecipeExp>();
  const bomByName = new Map<string, Map<string, number>>();
  if (dR) {
    const menuCol = dR.indices["menu"]!;
    const bahanCol = dR.indices["bahan"]!;
    const beratCol = dR.indices["berat"]!;
    let current: string | null = null;
    for (const row of dR.data) {
      const menu = (row[menuCol] ?? "").trim();
      if (menu) {
        current = menu;
        recipeNames.set(menu.toLowerCase(), {
          name: menu,
          basePrice: 0,
          totalCogs: 0,
          category: classifyRecipe(menu),
        });
        if (!bomByName.has(menu.toLowerCase())) bomByName.set(menu.toLowerCase(), new Map());
      }
      if (!current) continue;
      const ing = (row[bahanCol] ?? "").trim();
      const qtyRaw = parseFloat((row[beratCol] ?? "0").trim());
      // NOTE: compare against RAW CSV values. The canonical migrate-csv
      // recipes-rincian step applies Math.round() (e.g. 67.5 -> 68) when
      // writing; we intentionally keep raw here so we can see whether the
      // DB carries raw CSV values (Path B / seed-data.ts behaviour) vs the
      // rounded canonical-pipeline values.
      const qty = Number.isFinite(qtyRaw) ? qtyRaw : 0;
      if (!ing) continue;
      const canonical = canonicalName(ing);
      if (canonical === null) continue;
      const m = bomByName.get(current.toLowerCase())!;
      m.set(canonical.toLowerCase(), (m.get(canonical.toLowerCase()) ?? 0) + qty);
    }
  }

  // 2) Menu Kasir -> prices + possibly new recipes
  const rawK = readFileSync(CSV("Detail POS - List Menu Kasir.csv"), "utf-8");
  const tK = parseCsv(rawK);
  let currentSection: string | null = null;
  let curCols: { name: number; hpp: number; price: number } | null = null;
  const flush = () => {
    curCols = null;
  };
  for (const row of tK.rows) {
    const lower = row.map((c) => c.trim().toLowerCase());
    const hpp = lower.indexOf("hpp");
    const price = lower.indexOf("harga offline");
    if (hpp >= 0 && price >= 0) {
      flush();
      const labelCells = row
        .map((c, i) => ({ cell: c.trim(), idx: i }))
        .filter(({ cell, idx }) => cell.length > 0 && idx !== 0 && idx !== hpp && idx !== price);
      currentSection = labelCells[0]?.cell ?? "";
      curCols = { name: labelCells[0]?.idx ?? -1, hpp, price };
      continue;
    }
    if (!curCols || curCols.name < 0) continue;
    const rawName = (row[curCols.name] ?? "").trim();
    if (!rawName) continue;
    if (OPERATIONAL_SECTIONS.some((s) => (currentSection ?? "").toLowerCase().includes(s)))
      continue;
    const hppV = parseIdr(row[curCols.hpp] ?? "");
    const priceV = parseIdr(row[curCols.price] ?? "");
    const canonical =
      ALIAS_RECIPES[rawName.trim().toLowerCase().replace(/\s+/g, " ")] ?? rawName.trim();
    const key = canonical.toLowerCase();
    if (recipeNames.has(key)) {
      const r = recipeNames.get(key)!;
      r.basePrice = priceV;
      r.totalCogs = hppV;
    } else {
      recipeNames.set(key, {
        name: canonical,
        basePrice: priceV,
        totalCogs: hppV,
        category: classifyRecipe(canonical),
      });
    }
  }

  // 3) Staff menu prices (new recipes)
  const rawS = readFileSync(CSV("Detail POS - Menu Makan Staff.csv"), "utf-8");
  const tS = parseCsv(rawS);
  const dS = findColumns(tS, ["Harga HPP Makan Pegawai", "Harga"]);
  if (dS) {
    const nameCol = dS.indices["harga hpp makan pegawai"]!;
    const priceCol = dS.indices["harga"]!;
    for (const row of dS.data) {
      const allEmpty = row.every((c) => !c.trim());
      if (allEmpty) break;
      if (row.some((c) => /rincian menu/i.test(c.trim()))) break;
      const name = (row[nameCol] ?? "").trim();
      if (!name) continue;
      if (name.toLowerCase() === "harga hpp makan pegawai") continue;
      const key = name.toLowerCase();
      if (!recipeNames.has(key))
        recipeNames.set(key, {
          name,
          basePrice: parseIdr(row[priceCol] ?? ""),
          totalCogs: 0,
          category: "makanan",
        });
    }
  }

  // 4) ShopeeFood new recipes
  const SHOPEE = [
    { name: "Choco Latte", basePrice: 21000, cogs: 6014 },
    { name: "Hojicha Latte", basePrice: 28500, cogs: 8151 },
    { name: "Choco Ichigo Latte", basePrice: 25000, cogs: 7131 },
    { name: "Curry Omurice", basePrice: 27700, cogs: 9230 },
    { name: "Japanese Caramel Pudding", basePrice: 7200, cogs: 2065 },
    { name: "Katsu Bento", basePrice: 31600, cogs: 10521 },
  ];
  for (const r of SHOPEE) {
    const key = r.name.toLowerCase();
    if (!recipeNames.has(key))
      recipeNames.set(key, {
        name: r.name,
        basePrice: r.basePrice,
        totalCogs: r.cogs,
        category:
          r.name.includes("Latte") || r.name.includes("Pudding")
            ? r.name.includes("Latte")
              ? "minuman"
              : "snack"
            : "makanan",
      });
  }

  return { byName: recipeNames, bomByName };
}

// ── Channel revenues from Excel ──
function expectedChannelRevenue() {
  const wb = XLSX.read(readFileSync(XLSX_PATH), { type: "buffer" });
  const rows: { date: string; channel: string; amount: number }[] = [];
  const mapPlatform = (label: string): string | null => {
    const l = label.trim().toUpperCase();
    if (l === "SHOPEE") return "ShopeeFood";
    if (l === "GOJEK") return "Gofood";
    if (l === "GRAB") return "Grabfood";
    if (l === "OFFLINE") return "Dine-in";
    if (l.startsWith("GRAB/") || l.includes("OFFLINE Q")) return "Grabfood";
    return null;
  };
  const sheetToDate = (s: string): string | null => {
    if (!/^\d{8}$/.test(s)) return null;
    return `${s.slice(0, 2)}${s.slice(2, 4)}${s.slice(6, 8)}`;
  };
  for (const sn of wb.SheetNames) {
    const date = sheetToDate(sn);
    if (!date) continue;
    const ws = wb.Sheets[sn];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
    for (const raw of grid) {
      const row = raw as unknown[];
      const label = row[0];
      const uang = row[9];
      if (typeof label !== "string" || !label.trim()) continue;
      const ch = mapPlatform(label);
      if (!ch) continue;
      const amount = typeof uang === "number" ? uang : Number(uang);
      if (!Number.isFinite(amount)) continue;
      rows.push({ date, channel: ch, amount: Math.round(amount) });
    }
  }
  // Merge (date,channel) by summing (mirrors migration).
  const merged = new Map<string, { date: string; channel: string; amount: number }>();
  for (const r of rows) {
    const k = `${r.date}|${r.channel}`;
    const cur = merged.get(k);
    if (cur) cur.amount += r.amount;
    else merged.set(k, { ...r });
  }
  return [...merged.values()];
}

// ═══════════════════════════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════════════════════════
async function main() {
  const url = process.env.PGURL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL / PGURL is not set.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // ── BRANCHES ──
    console.log("\n=== BRANCHES ===");
    const expB = expectedBranches();
    const dbB = await client.query<{ code: string; name: string; location: string; type: string }>(
      `SELECT code, name, location, type FROM branches WHERE code <> 'CENTRAL'`,
    );
    const dbByCode = new Map(dbB.rows.map((r) => [r.code, r]));
    for (const e of expB) {
      const d = dbByCode.get(e.code);
      expect(!!d);
      if (!d) {
        record("MISSING", `branch ${e.code} (${e.name}) not in DB`);
        continue;
      }
      if (d.name !== e.name)
        record("MISMATCH", `branch ${e.code}: name '${d.name}' != '${e.name}'`);
      else expect(true);
      if (d.type !== e.type)
        record("MISMATCH", `branch ${e.code}: type '${d.type}' != '${e.type}'`);
      else expect(true);
      // location may differ in whitespace; compare normalized
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
      if (norm(d.location) !== norm(e.location))
        record(
          "MISMATCH",
          `branch ${e.code}: location differs\n    DB : ${d.location}\n    CSV: ${e.location}`,
        );
      else expect(true);
    }
    // extras
    for (const d of dbB.rows) {
      if (!expB.find((e) => e.code === d.code))
        record("EXTRA", `branch ${d.code} (${d.name}) in DB but not in CSV`);
    }
    console.log(`  expected ${expB.length} outlet branches; DB has ${dbB.rows.length} non-CENTRAL`);

    // ── INGREDIENTS ──
    console.log("\n=== INGREDIENTS ===");
    const expI = expectedIngredients();
    const dbI = await client.query<{
      id: string;
      name: string;
      category: string;
      sku_type: string;
      purchase_unit: string;
      stock_unit: string;
      average_cost: number;
    }>(
      `SELECT id, name, category, sku_type, purchase_unit, stock_unit, average_cost FROM ingredients`,
    );
    const dbByName = new Map(dbI.rows.map((r) => [r.name.toLowerCase(), r]));
    let missI = 0;
    for (const [key, e] of expI) {
      const d = dbByName.get(key);
      if (!d) {
        missI++;
        record("MISSING", `ingredient '${e.name}' (${e.category}/${e.skuType}) not in DB`);
        continue;
      }
      expect(true);
      if (d.category !== e.category) {
        record(
          "MISMATCH",
          `ingredient '${e.name}': category '${d.category}' != expected '${e.category}'`,
        );
      } else expect(true);
      if (d.sku_type !== e.skuType) {
        record(
          "MISMATCH",
          `ingredient '${e.name}': skuType '${d.sku_type}' != expected '${e.skuType}'`,
        );
      } else expect(true);
      const u = normaliseUnit(e.unit);
      if (d.purchase_unit !== u || d.stock_unit !== u) {
        record(
          "MISMATCH",
          `ingredient '${e.name}': unit '${d.purchase_unit}'/'${d.stock_unit}' != expected '${u}'`,
        );
      } else expect(true);
    }
    console.log(
      `  expected ${expI.size} unique ingredients (union central+tenant); DB has ${dbI.rows.length}; missing ${missI}`,
    );
    // extras
    let extraI = 0;
    for (const r of dbI.rows) {
      if (!expI.has(r.name.toLowerCase())) {
        extraI++;
        record("EXTRA", `ingredient '${r.name}' in DB but not derived from ingredient CSVs`);
      }
    }
    if (extraI)
      console.log(
        `  (note: ${extraI} DB ingredients are not in the ingredient CSVs — could be manual/other seed)`,
      );

    // ── INGREDIENT COSTS (Harga Invoice) ──
    console.log("\n=== INGREDIENT COSTS (Harga Invoice) ===");
    const expC = expectedCosts();
    let costChecked = 0;
    let costMismatch = 0;
    for (const [key, perUnit] of expC) {
      const d = dbByName.get(key);
      if (!d) continue;
      costChecked++;
      if (d.average_cost !== perUnit) {
        costMismatch++;
        record(
          "MISMATCH",
          `ingredient '${d.name}': averageCost ${d.average_cost} != invoice ${perUnit}`,
        );
      } else expect(true);
    }
    console.log(
      `  checked ${costChecked} ingredient costs against invoice; mismatches ${costMismatch}`,
    );

    // ── RECIPES ──
    console.log("\n=== RECIPES (prices) ===");
    const { byName: expR } = expectedRecipes();
    const dbR = await client.query<{
      id: string;
      name: string;
      base_price: number;
      total_cogs: number;
      category: string;
    }>(`SELECT id, name, base_price, total_cogs, category FROM recipes`);
    const dbRByName = new Map(dbR.rows.map((r) => [r.name.toLowerCase(), r]));
    let missR = 0;
    for (const [key, e] of expR) {
      const d = dbRByName.get(key);
      if (!d) {
        missR++;
        record("MISSING", `recipe '${e.name}' (basePrice expected ${e.basePrice}) not in DB`);
        continue;
      }
      expect(true);
      if (d.base_price !== e.basePrice) {
        record(
          "MISMATCH",
          `recipe '${e.name}': basePrice ${d.base_price} != expected ${e.basePrice}`,
        );
      } else expect(true);
      if (d.total_cogs !== e.totalCogs) {
        record(
          "MISMATCH",
          `recipe '${e.name}': totalCogs ${d.total_cogs} != expected ${e.totalCogs}`,
        );
      } else expect(true);
    }
    console.log(`  expected ${expR.size} recipes; DB has ${dbR.rows.length}; missing ${missR}`);
    let extraR = 0;
    for (const r of dbR.rows) {
      if (!expR.has(r.name.toLowerCase())) {
        extraR++;
        record("EXTRA", `recipe '${r.name}' in DB but not derived from any CSV/seed source`);
      }
    }
    if (extraR)
      console.log(
        `  (note: ${extraR} DB recipes are not in the source-derived set — likely manual additions or other seed paths)`,
      );

    // ── RECIPE BOM (Rincian) ──
    console.log("\n=== RECIPE BOM (Rincian Menu) ===");
    const { bomByName } = expectedRecipes();
    // ingredient id map for resolving BOM
    const ingIdByName = new Map<string, string>();
    for (const r of dbI.rows) ingIdByName.set(r.name.toLowerCase(), r.id);
    let bomRecipes = 0;
    let bomLines = 0;
    let bomMismatch = 0;
    for (const [rkey, expectedMap] of bomByName) {
      const d = dbRByName.get(rkey);
      if (!d) continue;
      bomRecipes++;
      const rows = await client.query<{ ingredient_id: string; quantity: number }>(
        `SELECT ingredient_id, quantity FROM recipe_ingredients WHERE recipe_id = $1`,
        [d.id],
      );
      // group DB by ingredient id -> total qty
      const dbQty = new Map<string, number>();
      for (const rr of rows.rows)
        dbQty.set(rr.ingredient_id, (dbQty.get(rr.ingredient_id) ?? 0) + rr.quantity);
      // expected keyed by ingredient name lower
      const expById = new Map<string, number>();
      for (const [ingKey, qty] of expectedMap) {
        const ingId = ingIdByName.get(ingKey);
        if (!ingId) {
          record(
            "MISMATCH",
            `recipe '${d.name}': BOM ingredient '${ingKey}' not found in ingredients`,
          );
          continue;
        }
        expById.set(ingId, qty);
      }
      // compare
      const allIds = new Set([...dbQty.keys(), ...expById.keys()]);
      for (const id of allIds) {
        const a = dbQty.get(id) ?? 0;
        const b = expById.get(id) ?? 0;
        bomLines++;
        if (Math.abs(a - b) > 0.001) {
          bomMismatch++;
          const nm = dbI.rows.find((r) => r.id === id)?.name ?? id;
          record("MISMATCH", `recipe '${d.name}': BOM '${nm}' qty ${a} != expected ${b}`);
        } else expect(true);
      }
    }
    console.log(
      `  checked ${bomRecipes} recipes' BOMs (${bomLines} ingredient-lines); mismatches ${bomMismatch}`,
    );

    // ── CHANNEL REVENUES ──
    console.log("\n=== CHANNEL REVENUES (Excel) ===");
    const expCh = expectedChannelRevenue();
    const branch = await client.query<{ id: string }>(
      `SELECT id FROM branches WHERE code = 'MLY-01' LIMIT 1`,
    );
    const branchId = branch.rows[0]?.id;
    if (branchId) {
      const dbCh = await client.query<{ date: string; channel: string; amount: number }>(
        `SELECT date, channel, amount FROM channel_revenues WHERE branch_id = $1`,
        [branchId],
      );
      const dbMap = new Map<string, number>();
      for (const r of dbCh.rows) dbMap.set(`${r.date}|${r.channel}`, r.amount);
      const expMap = new Map<string, number>();
      for (const r of expCh) expMap.set(`${r.date}|${r.channel}`, r.amount);
      let chMiss = 0;
      for (const [k, v] of expMap) {
        const d = dbMap.get(k);
        if (d === undefined) {
          chMiss++;
          record("MISSING", `channel_revenue ${k} (Rp ${v}) not in DB`);
        } else if (d !== v) {
          record("MISMATCH", `channel_revenue ${k}: DB ${d} != Excel ${v}`);
        } else expect(true);
      }
      for (const k of dbMap.keys())
        if (!expMap.has(k)) record("EXTRA", `channel_revenue ${k} in DB but not in Excel`);
      console.log(
        `  expected ${expCh.length} (date,channel) rows from Excel; DB has ${dbCh.rows.length}; missing ${chMiss}`,
      );
    } else {
      console.log("  branch MLY-01 not found — channel revenue check skipped");
    }

    // ── PLATFORM FEES ──
    console.log("\n=== PLATFORM FEES ===");
    const dbF = await client.query<{ channel: string; fee_percentage: number; fixed_fee: number }>(
      `SELECT channel, fee_percentage, fixed_fee FROM platform_fees`,
    );
    const expF = [
      { channel: "ShopeeFood", fee: 20 },
      { channel: "Grabfood", fee: 20 },
      { channel: "Gofood", fee: 20 },
      { channel: "Dine-in", fee: 0 },
    ];
    const dbFMap = new Map(dbF.rows.map((r) => [r.channel, r]));
    for (const e of expF) {
      const d = dbFMap.get(e.channel);
      if (!d) record("MISSING", `platform_fee '${e.channel}' not in DB`);
      else if (d.fee_percentage !== e.fee)
        record("MISMATCH", `platform_fee '${e.channel}': ${d.fee_percentage}% != ${e.fee}%`);
      else expect(true);
    }

    // ── SUMMARY ──
    console.log("\n" + "=".repeat(70));
    console.log("SUMMARY");
    console.log("=".repeat(70));
    const counts = { MISSING: 0, EXTRA: 0, MISMATCH: 0 };
    for (const d of diffs) counts[d.kind]++;
    console.log(`Checks passed: ${ok}/${checks}`);
    console.log(
      `Differences: ${diffs.length}  (MISSING=${counts.MISSING}, EXTRA=${counts.EXTRA}, MISMATCH=${counts.MISMATCH})`,
    );
    if (diffs.length) {
      console.log("\n--- DETAIL ---");
      for (const d of diffs) console.log(`  [${d.kind}] ${d.msg}`);
    }
    await client.end();
    process.exit(diffs.length ? 2 : 0);
  } catch (err) {
    await client.end();
    throw err;
  }
}

main().catch((err) => {
  console.error("verify-seed failed:", err);
  process.exit(1);
});
