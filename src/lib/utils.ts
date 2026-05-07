import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number (or numeric string) as Indonesian Rupiah.
 * e.g. 569982 → "Rp 569.982"
 */
export function formatRp(value: number | string | bigint | null | undefined): string {
  const num = typeof value === "string" ? Number(value) : (value ?? 0);
  return `Rp ${Number(num).toLocaleString("id-ID")}`;
}
