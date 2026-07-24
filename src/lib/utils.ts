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

/**
 * Convert an arbitrary string into a slug: lowercase, non-alphanumeric
 * characters replaced with underscores, runs of underscores collapsed,
 * and leading/trailing underscores trimmed.
 * e.g. "Minuman Dingin!" → "minuman_dingin"
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}
