import { describe, expect, it } from "vite-plus/test";
import { DrizzleQueryError } from "drizzle-orm";
import { dbErrorBoundary, dbErrorRequestBoundary } from "#/lib/server/db-error-middleware";
import type { UnknownRecord } from "#/lib/unknown-record";

/**
 * Drives the global boundary directly.
 *
 * The middleware only runs over a real Start request, which the in-process
 * integration harness cannot reach (the same reason ADR-0015 keeps the
 * server-function cores separately callable). Calling the exported handler with
 * a stub `next` exercises the branch that matters: what crosses the wire when
 * the inner handler throws.
 */

function pgError(fields: UnknownRecord): Error {
  // SAFETY: fabricating a driver error is this helper's entire purpose.
  return Object.assign(new Error("duplicate key value violates unique constraint"), fields);
}

const SQL = 'insert into "ingredients" ("code", "name", "average_cost") values ($1, $2, $3)';
const PARAMS = ["ING-117", "Plastik 18", 2600];

/** Capture the rejection so the message can be asserted on directly. */
async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected the boundary to reject, but it resolved");
}

describe("global db error boundary", () => {
  it("replaces a failed query's SQL with a readable message", async () => {
    const boom = new DrizzleQueryError(SQL, PARAMS, pgError({ code: "23505" }));
    expect(await messageOf(dbErrorBoundary({ next: () => Promise.reject(boom) }))).toBe(
      "Nilai sudah dipakai oleh data lain (duplikat).",
    );
  });

  it("never lets the SQL or its bound parameters escape", async () => {
    const boom = new DrizzleQueryError(SQL, PARAMS, pgError({ code: "23505" }));
    const message = await messageOf(dbErrorBoundary({ next: () => Promise.reject(boom) }));
    expect(message).not.toContain("insert into");
    expect(message).not.toContain("ING-117");
    expect(message).not.toContain("Plastik 18");
    expect(message).not.toContain("Failed query");
  });

  it("passes a non-database error through untouched", async () => {
    // A domain error the user is meant to read, e.g. the FSM/auth guards.
    const domain = new Error("PIN sudah digunakan oleh cabang/staf lain");
    expect(await messageOf(dbErrorBoundary({ next: () => Promise.reject(domain) }))).toBe(
      "PIN sudah digunakan oleh cabang/staf lain",
    );
  });

  it("passes a Zod-style validation failure through untouched", async () => {
    const invalid = new Error("Invalid input: expected number, received string");
    expect(await messageOf(dbErrorBoundary({ next: () => Promise.reject(invalid) }))).toBe(
      "Invalid input: expected number, received string",
    );
  });

  it("returns the handler's result when nothing throws", async () => {
    const result = await dbErrorBoundary({ next: () => Promise.resolve({ ok: true }) });
    expect(result).toEqual({ ok: true });
  });
});

/**
 * The request-scoped twin. `functionMiddleware` never runs for the `/api/*` file
 * routes, so without this boundary a failed statement there still reached the
 * client — `/api/keepalive` rendered it into a body anyone could fetch.
 */
describe("global db error boundary (server routes)", () => {
  it("replaces a failed query's SQL with a readable message", async () => {
    const boom = new DrizzleQueryError(SQL, PARAMS, pgError({ code: "23505" }));
    expect(await messageOf(dbErrorRequestBoundary({ next: () => Promise.reject(boom) }))).toBe(
      "Nilai sudah dipakai oleh data lain (duplikat).",
    );
  });

  it("never lets the SQL or its bound parameters escape", async () => {
    const boom = new DrizzleQueryError(SQL, PARAMS, pgError({ code: "23505" }));
    const message = await messageOf(dbErrorRequestBoundary({ next: () => Promise.reject(boom) }));
    expect(message).not.toContain("insert into");
    expect(message).not.toContain("ING-117");
    expect(message).not.toContain("Failed query");
  });

  it("passes a non-database error through untouched", async () => {
    // e.g. the "Seed routes are disabled in production" guard.
    const domain = new Error("Seed routes are disabled in production");
    expect(await messageOf(dbErrorRequestBoundary({ next: () => Promise.reject(domain) }))).toBe(
      "Seed routes are disabled in production",
    );
  });

  it("returns the handler's result when nothing throws", async () => {
    const result = await dbErrorRequestBoundary({ next: () => Promise.resolve({ ok: true }) });
    expect(result).toEqual({ ok: true });
  });
});
