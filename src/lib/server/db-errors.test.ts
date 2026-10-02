import { describe, expect, it } from "vite-plus/test";
import { DrizzleError, DrizzleQueryError } from "drizzle-orm";
import { describeDbError, isUniqueViolation } from "#/lib/server/db-errors";
import type { UnknownRecord } from "#/lib/unknown-record";

/** Stand in for the pg driver error Drizzle nests in `cause`. */
function pgError(fields: UnknownRecord): Error {
  // SAFETY: the helper's whole purpose is to fabricate a driver error, so the
  // extra pg-specific fields are asserted deliberately.
  return Object.assign(new Error("driver message"), fields);
}

function queryError(cause: Error | undefined): DrizzleQueryError {
  return new DrizzleQueryError(
    'insert into "ingredients" ("code", "name") values ($1, $2)',
    ["ING-117", "Plastik 18"],
    cause,
  );
}

describe("db error classification", () => {
  it("detects a unique violation by SQLSTATE", () => {
    expect(isUniqueViolation(queryError(pgError({ code: "23505" })))).toBe(true);
  });

  it("does not mistake other SQLSTATEs for a unique violation", () => {
    expect(isUniqueViolation(queryError(pgError({ code: "23503" })))).toBe(false);
    expect(isUniqueViolation(queryError(pgError({ code: "23514" })))).toBe(false);
  });

  it("tolerates a cause that is not a pg error", () => {
    expect(isUniqueViolation(queryError(new Error("plain")))).toBe(false);
    expect(isUniqueViolation(queryError(undefined))).toBe(false);
  });

  // A digits-only SQLSTATE pattern would reject "22P02" (class 22 uses letters
  // for its subclass) and drop every data-exception error into the fallback.
  it("recognises an alphanumeric SQLSTATE", () => {
    expect(describeDbError(queryError(pgError({ code: "22P02", message: "boom" })))).toContain(
      "Format angka tidak sesuai kolomnya",
    );
  });

  // Guards the class used for narrowing. DrizzleQueryError extends Error
  // directly, so an `instanceof DrizzleError` guard misses every failed query
  // and the raw SQL keeps reaching the client.
  it("is NOT a DrizzleError — narrowing must use DrizzleQueryError", () => {
    const err = queryError(pgError({ code: "23505" }));
    expect(err).toBeInstanceOf(DrizzleQueryError);
    expect(err).not.toBeInstanceOf(DrizzleError);
  });
});

describe("describeDbError", () => {
  it("translates the SQLSTATEs the UI should act on", () => {
    expect(describeDbError(queryError(pgError({ code: "23505" })))).toBe(
      "Nilai sudah dipakai oleh data lain (duplikat).",
    );
    expect(describeDbError(queryError(pgError({ code: "23503" })))).toBe(
      "Data masih terhubung ke data lain, sehingga tidak bisa diubah.",
    );
    expect(describeDbError(queryError(pgError({ code: "23502" })))).toBe(
      "Ada kolom wajib yang belum diisi.",
    );
    expect(describeDbError(queryError(pgError({ code: "23514" })))).toBe(
      "Nilai tidak sesuai aturan yang berlaku.",
    );
  });

  it("explains a value that does not fit its column", () => {
    // What a branch admin saw when stock_opname_items was still `integer` and a
    // branch held 23.5: the driver text is a bare "invalid input syntax for
    // type integer", which names no cause and no remedy.
    const out = describeDbError(
      queryError(
        pgError({ code: "22P02", message: 'invalid input syntax for type integer: "23.5"' }),
      ),
    );
    expect(out).toContain("Format angka tidak sesuai kolomnya");
    expect(out).not.toContain("invalid input syntax");
    expect(out).not.toContain("23.5");
  });

  it("falls back to the driver message for an unrecognised SQLSTATE", () => {
    expect(
      describeDbError(queryError(pgError({ code: "40001", message: "serialization failure" }))),
    ).toBe("serialization failure");
  });

  it("falls back to generic text when there is no usable driver message", () => {
    expect(describeDbError(queryError(new Error("")))).toBe(
      "Terjadi kesalahan saat menyimpan data.",
    );
    expect(describeDbError(queryError(undefined))).toBe("Terjadi kesalahan saat menyimpan data.");
  });

  // The whole point: bound parameters can carry supplier and pricing data, and
  // the reader is a branch admin. The SQL must never appear in the output.
  it("never leaks the SQL or the bound parameters", () => {
    const err = queryError(pgError({ code: "40001", message: "boom" }));
    const out = describeDbError(err);
    expect(out).not.toContain("insert into");
    expect(out).not.toContain("ING-117");
    expect(out).not.toContain("Plastik 18");
    expect(out).not.toContain("Failed query");
  });
});
