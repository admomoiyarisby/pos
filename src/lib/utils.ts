import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { z } from "zod";
import type { UnknownRecord } from "#/lib/unknown-record";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number (or numeric string) as Indonesian Rupiah.
 * e.g. 569982 → "Rp 569.982"
 */
export function formatRp(value: number | string | bigint | null | undefined): string {
  const num = Number(value ?? 0);
  return `Rp ${num.toLocaleString("id-ID")}`;
}

/**
 * Read a text field from a FormData at its I/O boundary.
 *
 * `FormData.get` returns `FormDataEntryValue | null` (a string or a File).
 * Text inputs always produce strings; missing fields produce null. This
 * function decodes that representation into a plain string so callers never
 * see File objects or null — matching the old `fd.get(k) as string` casts
 * without the unsound assertion.
 */
export function formText(fd: FormData, key: string): string {
  const value = fd.get(key);
  return value instanceof File ? "" : (value ?? "");
}

/**
 * Read an optional string URL search param at its I/O boundary.
 *
 * URL search values arrive as `unknown`; a param is either a string (the
 * common case) or absent. This decodes that representation into
 * `string | undefined` — replacing the old `useSearch() as { k?: string }`
 * casts without the unsound assertion.
 */
export function searchStringParam(search: UnknownRecord, key: string): string | undefined {
  const value = search[key];
  return z.string().optional().catch(undefined).parse(value);
}

/**
 * Badge variant names accepted by the Badge component (`badgeVariants`).
 */
export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning";

const BADGE_VARIANTS: Set<string> = new Set([
  "default",
  "secondary",
  "destructive",
  "outline",
  "success",
  "warning",
]);

/**
 * Decode a runtime status string into a Badge variant at the UI boundary.
 *
 * Status→color maps are keyed by arbitrary status strings; this validates the
 * mapped value against the literal set of Badge variants and falls back to
 * "default" for anything unknown. Replaces `lookupLabel(...) ?? "default") as
 * BadgeVariant` casts, which were unsound for maps containing "secondary".
 */
export function badgeVariant(value: string | undefined): BadgeVariant {
  if (value === undefined || !BADGE_VARIANTS.has(value)) return "default";
  // SAFETY: membership in the literal BADGE_VARIANTS set is checked above, so
  // the value is exactly one of the Badge variant names.
  return value as BadgeVariant;
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
