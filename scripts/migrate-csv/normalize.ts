/**
 * Cross-reference layer shared by all CSV migrations.
 *
 * Two responsibilities:
 *
 *   1. `canonicalName(raw)` — collapse variant spellings of the same
 *      ingredient (e.g., "Bubuk Matcha" vs "Bubuk Matcha latte") to a
 *      single canonical name. Without this, the recipe BOM in Rincian
 *      Menu couldn't FK into the ingredient inserted from Invoice.
 *
 *   2. `classify(canonical)` — derive `category` and `skuType`
 *      (RM / SFG / FG, Fresh / Dry / Packaging) using hard-coded
 *      knowledge gained by reading all 7 CSVs.
 *
 * Hard-coded rather than re-parsing the CSVs at runtime because:
 *   - the CSVs are frozen starter data (won't be edited post-migration)
 *   - the cross-reference signal is best computed once and committed
 *
 * Add to ALIASES / FG_ITEMS / PACKAGING_ITEMS / FRESH_ITEMS when a
 * future migration uncovers a new variant or wrong classification.
 */

import { lookupLabel } from "../../src/lib/label-lookup";

// ─── Aliases: variant → canonical ─────────────────────────────────────────
// Keyed by lowercased, single-spaced input. Value is the canonical name.
// Returning null means "this is not an ingredient" (operational supply).
const ALIASES = {
  // ─── Drink / powder / sauce variants ────────────────────────────────────
  "bubuk matcha": "Bubuk Matcha latte",
  "bubuk matcha latte": "Bubuk Matcha latte",
  skm: "Susu Kental Manis",
  "susu kental manis": "Susu Kental Manis",
  "saus manis jepang": "Saus Manis Jepang",
  "saus strawberry": "Strawberry Sauce",
  "saus katsu": "Saus Manis Jepang",
  "saus sambal": "Saus Sambal Sachet",
  "saus tomat": "Saus Tomat Sachet",

  // ─── Spicy / minced chicken ─────────────────────────────────────────────
  "spicy minced chicken sauce": "Spicy Sauce Ayam Cincang",
  "saus tiram": "Saus Tiram",

  // ─── Miso forms ─────────────────────────────────────────────────────────
  "biang miso": "Miso Soup",
  "miso pasta": "Miso Pasta",
  "miso soup": "Miso Soup",
  "bubuk dashi": "Dashi Halal",

  // ─── Katsu / beef ───────────────────────────────────────────────────────
  katsu: "Katsu Chicken",
  "daging beef slice": "Daging Blackpepper",
  "daging blackpepper": "Daging Blackpepper",

  // ─── Vinegar ────────────────────────────────────────────────────────────
  cuka: "Cuka Nasi",
  "rice vinegar": "Cuka Nasi",

  // ─── Klip variants ──────────────────────────────────────────────────────
  "plastik klip": "Plastik Klip 100 Pcs",
  "plastik klip 100 pcs": "Plastik Klip 100 Pcs",
  "plastik klip 100pcs": "Plastik Klip 100 Pcs",

  // ─── LPG ────────────────────────────────────────────────────────────────
  lpg: null,
  "tabung lpg 3 kg": null,
  "tabung lpg": null,

  // ─── Nota paper ─────────────────────────────────────────────────────────
  "kertas nota": "Roll Kertas Nota",
  "roll kertas nota": "Roll Kertas Nota",

  // ─── Trash bag ──────────────────────────────────────────────────────────
  "plastik kresek": "Trash Bag",
  "kresek sampah": "Trash Bag",
  "kresek 35": "Trash Bag",

  // ─── Cleansing supplies (operational) ───────────────────────────────────
  sunlight: null,
  "cairan cuci piring": null,
  "super pel": null,

  // ─── Tissue / Battery / Kabel ──────────────────────────────────────────
  tissue: "Tissue",
  "tissue jumbo": "Tissue Jumbo",
  "battery aaa": "Battery AAA",
  battery: "Battery AAA",
  batterai: "Battery AAA",
  "kabel ties": "Kabel Ties",
  "kabel ties 2.5*100mm putih": "Kabel Ties",
  "kable ties": "Kabel Ties",

  // ─── Cups / gelas ───────────────────────────────────────────────────────
  "cup gelas pp 12 oz": "Cup gelas PP 12Oz",
  "cup gelas pp 12oz": "Cup gelas PP 12Oz",
  "cup gelas pp 14 oz": "Cup gelas PP 14Oz",
  "cup gelas pp 14oz": "Cup gelas PP 14Oz",

  // ─── Sealer cup ─────────────────────────────────────────────────────────
  "plastik sealer gelas": "Plastik Sealer Cup",
  "plastik sealer cup": "Plastik Sealer Cup",
  sealercup: "Plastik Sealer Cup",
  "sealer cup": "Plastik Sealer Cup",

  // ─── Thinwall ───────────────────────────────────────────────────────────
  "thinwall 500ml": "Thinwall 500ml",
  "thinwall 500 ml": "Thinwall 500ml",
  "thinwall 300 ml": "Thinwall 300 ml",
  "thinwall 25 ml": "Thinwall 25 ml",
  "thinwall 150 ml": "Thinwall 150 ml",

  // ─── Sendok ─────────────────────────────────────────────────────────────
  "sendok plastik": "Sendok Plastik",
  "sendok puding": "Sendok Pudding",
  "sendok makan": "Sendok Makan",

  // ─── Egg ────────────────────────────────────────────────────────────────
  eggroll: "Egg Roll",
  "egg roll": "Egg Roll",

  // ─── Ice tea (alias between Rincian and Menu Kasir) ───────────────────
  "ice tea": "Ice Tea",

  // ─── Operational extras in Menu Kasir / Invoice ────────────────────────
  galon: null,
  "minyak 1 liter": null,
  "minyak 2 liter": null,
  "pex 15": null,
  "pex 20": null,
  "pex 25": null,
  "tomat 12 x 25": null,
  "tomat 20 x 35": null,
  "wijen 100 gr": "Wijen",
  "daun parsley (gram)": "Daun Parsley",
  "tepung ketan (pack)": "Tepung Ketan",
  "isi steples": "Isi Staples",
  "isi staples": "Isi Staples",
  bulpoint: null,
  "ongkos kirim": null,
  "sunlight 1500": null,

  // ─── Aliases from Harga Invoice (per-unit cost CSV) ────────────────────
  parsley: "Daun Parsley",
  "bubuk cabe": "Cabe bubuk",
  "thin wall 300 ml": "Thinwall 300 ml",
  "thin wall 25 ml": "Thinwall 25 ml",
  "thin wall 150 ml": "Thinwall 150 ml",
  "tray paper bowl": "Paper Bowl 650 ml",
  "bubuk choco latte": "Choco Latte",
  "plastik bawang 15": "Plastik Bawang 15",
  "plastik bawang 20": "Plastik Bawang 20",
  "plastik bawang 25": "Plastik Bawang 25",
  "plastik 12 x 25": "Plastik 12 x 25",
  "plastik 20 x 35": "Plastik 20 x 35",
  "tutup bowl 650 ml": "Tutup Bowl 650 ml",
  "paper bowl 650 ml": "Paper Bowl 650 ml",
  "tray bento": "Bento Tray",
} satisfies Record<string, string | null>;

const FG_ITEMS = new Set<string>(
  [
    "Ayam Karage",
    "Daging Blackpepper",
    "Hot Honey Sauce",
    "Curry Sauce",
    "Spicy Sauce Ayam Cincang",
    "Miso Soup",
    "Katsu Chicken",
    "Pudding Caramel",
    "Egg Roll",
    "Choco Latte",
    "Bayam Krispy",
    "Ice Tea",
  ].map((s) => s.toLowerCase()),
);

const PACKAGING_ITEMS = new Set<string>(
  [
    "Cup gelas PP 12Oz",
    "Cup gelas PP 14Oz",
    "Plastik Sealer Cup",
    "Sedotan",
    "Sendok Makan",
    "Sendok Plastik",
    "Sendok Pudding",
    "Bowl Mangkok",
    "Tutup Mangkok",
    "Mangkok soup 300ml",
    "Paper Bowl 650 ml",
    "Tutup Bowl 650 ml",
    "Thinwall 300 ml",
    "Thinwall 25 ml",
    "Thinwall 150 ml",
    "Thinwall 500ml",
    "Inner Tray Bowl",
    "Bento Tray",
    "Tissue",
    "Tissue Jumbo",
    "Kabel Ties",
    "Battery AAA",
    "Plastik Klip 100 Pcs",
    "Plastik 12 x 25",
    "Plastik 20 x 35",
    "Plastik Bawang 15",
    "Plastik Bawang 20",
    "Plastik Bawang 25",
    "Roll Kertas Nota",
    "Isolasi Bening",
    "Lakban Bening",
    "Isi Staples",
    "Cling Wrap",
    "Trash Bag",
    "Spons Cuci",
    "Vaccum Pack 10 x 15",
    "Vaccum Pack 25 x 37",
    "Vaccum Pack 30 x 40",
  ].map((s) => s.toLowerCase()),
);

const FRESH_ITEMS = new Set<string>(
  [
    "Susu",
    "Susu Fresh Milk",
    "Telor Ayam",
    "Ayam Cincang",
    "Dada Ayam Mentah",
    "Paha Ayam",
    "Beras",
    "Beras Ketan",
    "Bayam",
    "Edamame",
    "Kubis Mentah",
    "Wortel Mentah",
    "Daun Bawang",
    "Daun Parsley",
    "Bawang Bombay",
    "Bawang Putih",
    "Jahe",
    "Daun Teh Hitam",
    "Wakame",
  ].map((s) => s.toLowerCase()),
);

// Canonical (proper-cased) form per known name. Built from the sets
// above so we always return the same casing for a known item.
const CANONICAL_FORMS = new Map<string, string>();
{
  const all = [...FG_ITEMS, ...PACKAGING_ITEMS, ...FRESH_ITEMS];
  for (const lower of all) {
    const proper = lower
      .split(" ")
      .map((w, i) => {
        if (i > 0 && /^(ml|gr|kg|pcs|pax)$/i.test(w)) return w.toLowerCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(" ");
    CANONICAL_FORMS.set(lower, proper);
  }
  // Override entries whose canonical form needs non-default casing.
  CANONICAL_FORMS.set("cup gelas pp 12oz", "Cup gelas PP 12Oz");
  CANONICAL_FORMS.set("cup gelas pp 14oz", "Cup gelas PP 14Oz");
  CANONICAL_FORMS.set("daun teh hitam", "Daun Teh Hitam");
  CANONICAL_FORMS.set("mangkok soup 300ml", "Mangkok soup 300ml");
  CANONICAL_FORMS.set("paper bowl 650 ml", "Paper Bowl 650 ml");
  CANONICAL_FORMS.set("tutup bowl 650 ml", "Tutup Bowl 650 ml");
  CANONICAL_FORMS.set("thinwall 300 ml", "Thinwall 300 ml");
  CANONICAL_FORMS.set("thinwall 25 ml", "Thinwall 25 ml");
  CANONICAL_FORMS.set("thinwall 150 ml", "Thinwall 150 ml");
  CANONICAL_FORMS.set("thinwall 500ml", "Thinwall 500ml");
  CANONICAL_FORMS.set("tray bento", "Bento Tray");
  CANONICAL_FORMS.set("plastik klip 100 pcs", "Plastik Klip 100 Pcs");
  CANONICAL_FORMS.set("plastik 12 x 25", "Plastik 12 x 25");
  CANONICAL_FORMS.set("plastik 20 x 35", "Plastik 20 x 35");
  CANONICAL_FORMS.set("plastik bawang 15", "Plastik Bawang 15");
  CANONICAL_FORMS.set("plastik bawang 20", "Plastik Bawang 20");
  CANONICAL_FORMS.set("plastik bawang 25", "Plastik Bawang 25");
  CANONICAL_FORMS.set("roll kertas nota", "Roll Kertas Nota");
  CANONICAL_FORMS.set("kabel ties", "Kabel Ties");
  CANONICAL_FORMS.set("battery aaa", "Battery AAA");
  CANONICAL_FORMS.set("isi staples", "Isi Staples");
  CANONICAL_FORMS.set("isolasi bening", "Isolasi Bening");
  CANONICAL_FORMS.set("lakban bening", "Lakban Bening");
  CANONICAL_FORMS.set("cling wrap", "Cling Wrap");
  CANONICAL_FORMS.set("trash bag", "Trash Bag");
  CANONICAL_FORMS.set("spons cuci", "Spons Cuci");
  CANONICAL_FORMS.set("vaccum pack 10 x 15", "Vaccum Pack 10 x 15");
  CANONICAL_FORMS.set("vaccum pack 25 x 37", "Vaccum Pack 25 x 37");
  CANONICAL_FORMS.set("vaccum pack 30 x 40", "Vaccum Pack 30 x 40");
  CANONICAL_FORMS.set("sendok makan", "Sendok Makan");
  CANONICAL_FORMS.set("sendok plastik", "Sendok Plastik");
  CANONICAL_FORMS.set("sendok pudding", "Sendok Pudding");
  CANONICAL_FORMS.set("bowl mangkok", "Bowl Mangkok");
  CANONICAL_FORMS.set("tutup mangkok", "Tutup Mangkok");
  CANONICAL_FORMS.set("inner tray bowl", "Inner Tray Bowl");
  CANONICAL_FORMS.set("plastik sealer cup", "Plastik Sealer Cup");
  CANONICAL_FORMS.set("sedotan", "Sedotan");
  CANONICAL_FORMS.set("tissue", "Tissue");
  CANONICAL_FORMS.set("tissue jumbo", "Tissue Jumbo");
  CANONICAL_FORMS.set("telor ayam", "Telor Ayam");
  CANONICAL_FORMS.set("daging blackpepper", "Daging Blackpepper");
  CANONICAL_FORMS.set("ayam karage", "Ayam Karage");
  CANONICAL_FORMS.set("hot honey sauce", "Hot Honey Sauce");
  CANONICAL_FORMS.set("curry sauce", "Curry Sauce");
  CANONICAL_FORMS.set("spicy sauce ayam cincang", "Spicy Sauce Ayam Cincang");
  CANONICAL_FORMS.set("miso soup", "Miso Soup");
  CANONICAL_FORMS.set("katsu chicken", "Katsu Chicken");
  CANONICAL_FORMS.set("pudding caramel", "Pudding Caramel");
  CANONICAL_FORMS.set("egg roll", "Egg Roll");
  CANONICAL_FORMS.set("choco latte", "Choco Latte");
  CANONICAL_FORMS.set("bayam krispy", "Bayam Krispy");
  CANONICAL_FORMS.set("ice tea", "Ice Tea");
  CANONICAL_FORMS.set("susu", "Susu");
  CANONICAL_FORMS.set("susu fresh milk", "Susu Fresh Milk");
  CANONICAL_FORMS.set("ayam cincang", "Ayam Cincang");
  CANONICAL_FORMS.set("dada ayam mentah", "Dada Ayam Mentah");
  CANONICAL_FORMS.set("paha ayam", "Paha Ayam");
  CANONICAL_FORMS.set("beras", "Beras");
  CANONICAL_FORMS.set("beras ketan", "Beras Ketan");
  CANONICAL_FORMS.set("bayam", "Bayam");
  CANONICAL_FORMS.set("edamame", "Edamame");
  CANONICAL_FORMS.set("kubis mentah", "Kubis Mentah");
  CANONICAL_FORMS.set("wortel mentah", "Wortel Mentah");
  CANONICAL_FORMS.set("daun bawang", "Daun Bawang");
  CANONICAL_FORMS.set("daun parsley", "Daun Parsley");
  CANONICAL_FORMS.set("bawang bombay", "Bawang Bombay");
  CANONICAL_FORMS.set("bawang putih", "Bawang Putih");
  CANONICAL_FORMS.set("jahe", "Jahe");
  CANONICAL_FORMS.set("wakame", "Wakame");
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Return the canonical name for an ingredient, or `null` if the input
 * is an operational/non-ingredient item that should be skipped.
 */
export function canonicalName(raw: string): string | null {
  const norm = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (norm in ALIASES) return lookupLabel(ALIASES, norm) ?? null;
  // Known classification → return its proper-cased canonical form.
  if (CANONICAL_FORMS.has(norm)) return CANONICAL_FORMS.get(norm)!;
  // Pass-through: trim but keep original casing.
  return raw.trim();
}

export type Classification = {
  category: "Fresh" | "Dry" | "Packaging";
  skuType: "RM" | "SFG" | "FG";
};

/**
 * Derive category + skuType for a canonical ingredient name.
 *
 * Rules:
 *   1. Packaging items → category=Packaging, skuType=RM
 *   2. FG items → category=Fresh, skuType=FG (finished food)
 *   3. Fresh items → category=Fresh, skuType=RM
 *   4. Default → category=Dry, skuType=RM
 */
export function classify(canonical: string): Classification {
  const norm = canonical.trim().toLowerCase();
  if (PACKAGING_ITEMS.has(norm)) return { category: "Packaging", skuType: "RM" };
  if (FG_ITEMS.has(norm)) return { category: "Fresh", skuType: "FG" };
  if (FRESH_ITEMS.has(norm)) return { category: "Fresh", skuType: "RM" };
  return { category: "Dry", skuType: "RM" };
}

/**
 * Normalise a unit string from the CSVs to a single canonical form.
 * "pcs" / "Pcs" / "PCS" → "pcs". "ml" / "ML" → "ml". Etc.
 */
export function normaliseUnit(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}
