import { ilike, sql, type SQL, type AnyColumn } from "drizzle-orm";

type FuzzyColumn = SQL | AnyColumn;

/**
 * Typo-tolerant (fuzzy) predicate for free-text search across one or more text
 * columns. Matches a substring (ILIKE) OR a trigram `similarity(...) > 0.3`, so
 * minor typos still return results. Requires the `pg_trgm` extension (ADR-0008).
 *
 * The term is always bound as a parameter (via `ilike` and `sql.param`), never
 * inlined, so this is SQL-injection safe.
 */
export function fuzzySearch(columns: FuzzyColumn | FuzzyColumn[], term: string): SQL {
  const cols = Array.isArray(columns) ? columns : [columns];
  const t = sql.param(term);
  const parts = cols.map((c) => sql`(${ilike(c, `%${term}%`)} OR similarity(${c}, ${t}) > 0.3)`);
  return parts.length === 1 ? parts[0] : parts.reduce((acc, p) => sql`${acc} OR ${p}`);
}

/** Similarity score used to re-rank fuzzy results best-match first. */
export function fuzzyRank(columns: FuzzyColumn | FuzzyColumn[], term: string): SQL {
  const cols = Array.isArray(columns) ? columns : [columns];
  const t = sql.param(term);
  const scored = cols.map((c) => sql`similarity(${c}, ${t})`);
  const greatest = scored.length === 1 ? scored[0] : sql`GREATEST(${sql.join(scored, sql`, `)})`;
  return sql`${greatest} DESC`;
}
