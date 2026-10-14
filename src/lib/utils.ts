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

/** Max fraction digits shown for stock/quantity displays. */
const QUANTITY_MAX_FRACTION_DIGITS = 3;

/**
 * Clean a quantity for storage: rounds float32 residue away at the same
 * precision `formatQuantity` displays.
 *
 * Quantities live in float32 (`real`) columns, so an SO snapshot taken straight
 * from `inventory.quantity` can read 23.499999 and produce a variance of
 * -0.000001 against a real count. Rounding at the write boundary keeps the
 * count sheet honest; the underlying `inventory.quantity` is deliberately left
 * unrounded (see `STOCK_CHECK_EPSILON` in scm-effects for why the float32
 * residue is tolerated rather than chased).
 */
export function roundQuantity(value: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** QUANTITY_MAX_FRACTION_DIGITS;
  return Math.round(value * factor) / factor;
}

/** id-ID grouped form: "1.234", "6.000", "1.234.567", "1.234,5". */
const GROUPED_ID_ID = /^\d{1,3}(\.\d{3})*(,\d+)?$/;
/** Ungrouped form: "23", "23.5", "0.5", "1234.5". */
const UNGROUPED = /^\d+(\.\d+)?$/;

/**
 * Parse a quantity typed into a text field, in Indonesian number convention.
 *
 * `formatQuantity` renders id-ID, where "." groups thousands and "," is the
 * decimal point — so the two are NOT interchangeable on input: `Number("6.000")`
 * is 6, and reading a count of 6000 as 6 would silently miscount stock. A dot
 * is therefore read as grouping only when it forms exact 3-digit groups, which
 * is what id-ID writes; anything else is a decimal point, so a US-style "23.5"
 * works too. A comma is always the decimal point, since id-ID never groups with
 * one.
 *
 * The one residual ambiguity is "0.500": exact 3-digit grouping says 500, but a
 * decimal reading would say 0.5. The locale-correct (grouping) reading wins,
 * and a user who means a half writes "0,5" or "0.5" — both of which parse as
 * intended.
 *
 * Returns null for anything not a plain number, including a half-typed "23,"
 * which is a value still being typed rather than a bad one.
 */
export function parseQuantityInput(value: string): number | null {
  const raw = value.trim();
  if (raw === "") return null;

  if (GROUPED_ID_ID.test(raw)) {
    // Dots are thousands grouping; the optional comma is the decimal point.
    return Number(raw.replace(/\./g, "").replace(",", "."));
  }
  if (UNGROUPED.test(raw)) {
    return Number(raw);
  }
  return null;
}

/**
 * Format a stock/quantity value for the Indonesian UI.
 *
 * Quantities live in float32 (`real`) columns, so arithmetic can produce
 * round-off artifacts (e.g. 7.75 → 7.7500001). Rounding to 3 fraction digits
 * (well below any real-world stock unit) cleans those up, then id-ID locale
 * formatting renders integers compactly (6000 → "6.000") and decimals with a
 * comma (2.25 → "2,25").
 *
 * e.g. 6000 → "6.000", 2.25 → "2,25", 0.1 + 0.2 → "0,3"
 */
export function formatQuantity(value: number | null | undefined): string {
  const num = Number(value ?? 0);
  return num.toLocaleString("id-ID", {
    maximumFractionDigits: QUANTITY_MAX_FRACTION_DIGITS,
  });
}

/**
 * Format a timestamp for the Indonesian UI using the application's fixed
 * timezone. An explicit timezone keeps SSR and browser output identical.
 */
export function formatJakartaDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

/**
 * Date-only variant of `formatJakartaDateTime`: "14 Okt 2026".
 *
 * Calendar dates (production date, request date) are days, not instants. The
 * pinned timezone keeps a tablet with a misconfigured system timezone from
 * shifting the day: a UTC-midnight instant renders as the previous day on any
 * device set behind UTC.
 */
export function formatJakartaDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

/**
 * Time-only variant of `formatJakartaDateTime`: "22.02".
 */
export function formatJakartaTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

/** Strict `YYYY-MM-DD` shape produced by `<input type="date">`. */
const DATE_ONLY_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a `<input type="date">` value into a Date that cannot drift across
 * midnight.
 *
 * `new Date("2026-10-14")` is UTC midnight by spec, so storing that instant
 * and rendering it in a timezone behind UTC shows the 13th. Noon UTC stays on
 * the same calendar day from UTC-12 to UTC+12, and pairs with the
 * Jakarta-pinned formatters so the listed day always matches the picked day.
 * Noon is fixed in UTC (not server-local) so dev, test, and Vercel runtimes
 * all store the identical instant.
 *
 * Returns null for anything that is not a valid calendar date.
 */
export function parseDateOnlyInput(value: string): Date | null {
  const match = DATE_ONLY_INPUT.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Format any instant as a `YYYY-MM-DD` day in the application timezone, for
 * `<input type="date">` values, date-column comparisons, and day bucketing.
 */
export function toDateInputValue(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Today's date as a `<input type="date">` value, in the application timezone.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which is yesterday
 * during 00:00–06:59 WIB — the form would open on the wrong day.
 */
export function todayDateInputValue(now: Date = new Date()): string {
  return toDateInputValue(now);
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
