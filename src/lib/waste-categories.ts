import { lookupLabel } from "./label-lookup";

export const WASTE_FINANCIAL_MAP = {
  Spoiled: "Operational Loss",
  "Biaya Operasional": "Operational Loss",
  "Beban Makan": "Staff Benefit Expense",
} satisfies Record<string, string>;

export function getFinancialClassification(category: string): string {
  return lookupLabel(WASTE_FINANCIAL_MAP, category) ?? "Operational Loss";
}

export function getFinancialClassificationLabel(category: string): string {
  const classification = getFinancialClassification(category);
  if (classification === "Operational Loss") return "Kerugian Operasional";
  if (classification === "Staff Benefit Expense") return "Biaya Karyawan";
  return classification;
}
