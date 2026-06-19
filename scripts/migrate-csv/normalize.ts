/**
 * Cross-reference layer shared by all CSV migrations.
 *
 * Two responsibilities:
 *
 *   1. `canonicalName(raw)` — collapse variant spellings of the same
 *      ingredient (e.g., "Bubuk Matcha" vs "Bubuk Matcha latte") to a
 *      single canonical name. Without this, Rincian Menu's `Bubuk Matcha
 *      latte` wouldn't match List Item Central's `Bubuk Hojicha`... wait,
 *      different item. Let me restate: without this, the recipe BOM
 *      "Bubuk Matcha latte" wouldn't FK into the ingredient inserted
 *      from Invoice's "Bubuk Matcha".
 *
 *   2. `classify(canonical, unit)` — derive `category` and `skuType`
 *      (RM / SFG / FG, Fresh / Dry / Packaging) using hard-coded
 *      knowledge gained by reading all 7 CSVs (see `docs/csv/`).
 *
 * Hard-coded rather than re-parsing the CSVs at runtime because:
 *   - the CSVs are frozen starter data (won't be edited post-migration)
 *   - the cross-reference signal is best computed once and committed
 *
 * Add to ALIASES / FG_ITEMS / PACKAGING_ITEMS / FRESH_ITEMS / SKIP_ITEMS
 * when a future migration uncovers a new variant or a wrong classification.
 */

// ─── Aliases: variant → canonical ─────────────────────────────────────────
// Keyed by lowercased, single-spaced input. Value is the canonical name.
// Returning null means "this is not an ingredient" (operational supply).
const ALIASES: Record<string, string | null> = {
  // "Bubuk Matcha" (Invoice) vs "Bubuk Matcha latte" (Tenant/Rincian)
  "bubuk matcha": "Bubuk Matcha latte",
  "bubuk matcha latte": "Bubuk Matcha latte",

  // "SKM" / "Susu Kental Manis" → same item
  skm: "Susu Kental Manis",
  "susu kental manis": "Susu Kental Manis",

  // Sauce casing / packaging-form vs bottled
  "saus manis jepang": "Saus Manis Jepang",
  "saus sambal": "Saus Sambal Sachet",
  "saus tomat": "Saus Tomat Sachet",
  "saus strawberry": "Strawberry Sauce",
  "saus katsu": "Saus Katsu",

  // Sealer cup spelling variants
  "plastik sealer gelas": "Plastik Sealer Cup",
  "plastik sealer cup": "Plastik Sealer Cup",
  "plastik sealer cup ": "Plastik Sealer Cup",
  sealercup: "Plastik Sealer Cup",
  "sealer cup": "Plastik Sealer Cup",

  // Miso forms
  "biang miso": "Miso Soup",
  "miso pasta": "Miso Pasta",
  "miso soup": "Miso Soup",

  // Katsu forms
  katsu: "Katsu Chicken",

  // Beef slice = blackpepper cut (per Rincian Menu context)
  "daging beef slice": "Daging Blackpepper",
  "daging blackpepper": "Daging Blackpepper",

  // Vinegar
  cuka: "Cuka Nasi",
  "rice vinegar": "Cuka Nasi",

  // Klip variants
  "plastik klip": "Plastik Klip 100 Pcs",
  "plastik klip 100 pcs": "Plastik Klip 100 Pcs",
  "plastik klip 100pcs": "Plastik Klip 100 Pcs",

  // LPG
  lpg: null,
  "tabung lpg 3 kg": null,

  // Nota paper
  "kertas nota": "Roll Kertas Nota",
  "roll kertas nota": "Roll Kertas Nota",

  // Trash bag
  "plastik kresek": "Trash Bag",
  "kresek sampah": "Trash Bag",
  "kresek 35": "Trash Bag",

  // Cleansing supplies — not ingredients
  sunlight: null,
  "cairan cuci piring": null,
  "super pel": null,

  // Tissue variants
  tissue: "Tissue",
  "tissue jumbo": "Tissue Jumbo",

  // Battery
  "battery aaa": "Battery AAA",
  battery: "Battery AAA",
  batterai: "Battery AAA",

  // Kabel ties
  "kabel ties": "Kabel Ties",
  "kabel ties 2.5*100mm putih": "Kabel Ties",
  "kable ties": "Kabel Ties",

  // Cups / gelas variants
  "cup gelas pp 12 oz": "Cup gelas PP 12Oz",
  "cup gelas pp 12oz": "Cup gelas PP 12Oz",
  "cup gelas pp 14 oz": "Cup gelas PP 14Oz",
  "cup gelas pp 14oz": "Cup gelas PP 14Oz",

  // Thinwall
  "thinwall 500ml": "Thinwall 500ml",
  "thinwall 500 ml": "Thinwall 500ml",
  "thinwall 300 ml": "Thinwall 300 ml",
  "thinwall 25 ml": "Thinwall 25 ml",
  "thinwall 150 ml": "Thinwall 150 ml",

  // Sendok
  "sendok plastik": "Sendok Plastik",
  "sendok puding": "Sendok Pudding",
  "sendok makan": "Sendok Makan",

  // Egg
  eggroll: "Egg Roll",
  "egg roll": "Egg Roll",

  // Ice tea (drink as ingredient? no, it's a recipe. But Menu Kasir lists it.)
  "ice tea": "Ice Tea",

  // Operational extras in Menu Kasir (not ingredients)
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
  "isi staples": "Isi Staples",
  "isi steples": "Isi Staples",
  bulpoint: null,
};

const FG_ITEMS = new Set<string>([
  // Items that appear as primary ingredient in Rincian Menu — these are
  // pre-made goods the branch uses directly, made at the central kitchen.
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
]);

const PACKAGING_ITEMS = new Set<string>([
  // Items with `pcs` unit and packaging-related name.
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
  "Tray Bento",
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
  "Gelas Polos",
  "Vaccum Pack 10 x 15",
  "Vaccum Pack 25 x 37",
  "Vaccum Pack 30 x 40",
  "Tabung LPG 3 Kg", // also packaging-like form (sealed cylinder)
]);

const FRESH_ITEMS = new Set<string>([
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
]);

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Return the canonical name for an ingredient, or `null` if the input
 * is an operational/non-ingredient item that should be skipped.
 */
export function canonicalName(raw: string): string | null {
  const norm = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (norm in ALIASES) return ALIASES[norm];
  // Pass-through: trim whitespace but keep original casing/spelling.
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
  if (PACKAGING_ITEMS.has(canonical)) return { category: "Packaging", skuType: "RM" };
  if (FG_ITEMS.has(canonical)) return { category: "Fresh", skuType: "FG" };
  if (FRESH_ITEMS.has(canonical)) return { category: "Fresh", skuType: "RM" };
  return { category: "Dry", skuType: "RM" };
}

/**
 * Normalise a unit string from the CSVs to a single canonical form.
 * "pcs" / "Pcs" / "PCS" → "pcs". "ml" / "ML" → "ml". Etc.
 */
export function normaliseUnit(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}
