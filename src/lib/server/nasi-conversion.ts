/**
 * Nasi Putih conversion formula.
 *
 * 1 portion Nasi Putih = raw ingredients below.
 * Source: Audit Inventory sheet, rows 58-62.
 *
 * This is used in Stock Opname to convert leftover Nasi
 * back to raw ingredient equivalents for inventory adjustment.
 */
export const NASI_CONVERSION = {
  name: "Nasi Putih",
  unit: "porsi",
  ingredients: [
    { name: "Beras", amountPerPortion: 72.9, unit: "gr" },
    { name: "Beras Ketan", amountPerPortion: 8.1, unit: "gr" },
    { name: "Air", amountPerPortion: 117, unit: "gr" },
    { name: "Cuka Nasi", amountPerPortion: 1.25, unit: "gr" },
    { name: "Mangkok soup 300ml", amountPerPortion: 1, unit: "pcs" },
  ],
} as const;

/**
 * Calculate raw ingredient equivalents for a given Nasi portion count.
 * Returns an array of { ingredientName, totalAmount, unit }.
 */
export function calculateNasiConversion(portions: number) {
  return NASI_CONVERSION.ingredients.map((ing) => ({
    ingredientName: ing.name,
    totalAmount: portions * ing.amountPerPortion,
    unit: ing.unit,
  }));
}
