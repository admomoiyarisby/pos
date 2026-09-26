import { DrizzleQueryError } from "drizzle-orm";
import { z } from "zod";
import type { UnknownRecord } from "#/lib/unknown-record";

/**
 * Postgres error translation.
 *
 * When a statement fails, Drizzle throws a `DrizzleQueryError` whose `message`
 * is
 *
 *   Failed query: insert into "ingredients" (...) values (...) returning ...
 *   params: ING-117,Plastik 18,Packaging,RM,Pack,Pack,1,2600,0.1,true,true
 *
 * — the full SQL plus every bound parameter — with the real driver error nested
 * in `cause`. Handing that to a UI shows the user a wall of SQL and says
 * nothing about what went wrong. Observed on the ingredient form as
 * "Gagal menambah bahan baku" with the query text as the description.
 *
 * Note `DrizzleQueryError` extends `Error` directly, NOT `DrizzleError` — an
 * `instanceof DrizzleError` guard silently misses every failed query. Call sites
 * narrow with `instanceof DrizzleQueryError` and rethrow anything else
 * untouched, so only genuine query failures are translated.
 */

/** Postgres SQLSTATE codes this codebase cares about. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const NOT_NULL_VIOLATION = "23502";
const CHECK_VIOLATION = "23514";

/** A 5-character SQLSTATE identifies a real driver error. */
const sqlstateSchema = z.string().regex(/^\d{5}$/);
const driverMessageSchema = z.string().min(1);

function sqlstateOf(err: DrizzleQueryError): string | null {
  // SAFETY: `DrizzleQueryError.cause` is the pg driver error, which pg decorates
  // with a 5-char SQLSTATE `code`. zod validates it before use, so a cause that
  // is not a pg error yields null instead of a wrong SQLSTATE.
  const cause = err.cause as UnknownRecord | undefined;
  const parsed = sqlstateSchema.safeParse(cause?.code);
  return parsed.success ? parsed.data : null;
}

/** True when the failure was a Postgres unique-constraint violation. */
export function isUniqueViolation(err: DrizzleQueryError): boolean {
  return sqlstateOf(err) === UNIQUE_VIOLATION;
}

/**
 * A short, human-readable message for a failed query.
 *
 * Deliberately omits the SQL and the parameters: they can hold supplier, staff
 * and pricing data, and the person reading this is a branch admin, not a DBA.
 * The driver's own message is safe by comparison — it names the constraint, not
 * the row.
 */
export function describeDbError(err: DrizzleQueryError): string {
  switch (sqlstateOf(err)) {
    case UNIQUE_VIOLATION:
      return "Nilai sudah dipakai oleh data lain (duplikat).";
    case FOREIGN_KEY_VIOLATION:
      return "Data masih terhubung ke data lain, sehingga tidak bisa diubah.";
    case NOT_NULL_VIOLATION:
      return "Ada kolom wajib yang belum diisi.";
    case CHECK_VIOLATION:
      return "Nilai tidak sesuai aturan yang berlaku.";
    default:
      break;
  }

  // SAFETY: as in sqlstateOf — `cause` is the pg error; only a non-empty driver
  // message is preferred, and anything else falls back to generic text. The
  // wrapper's own message is never used, since it is the SQL.
  const cause = err.cause as UnknownRecord | undefined;
  const parsed = driverMessageSchema.safeParse(cause?.message);
  return parsed.success ? parsed.data : "Terjadi kesalahan saat menyimpan data.";
}
