import { createMiddleware } from "@tanstack/react-start";
import { DrizzleQueryError } from "drizzle-orm";
import { describeDbError } from "#/lib/server/db-errors";

/** The only part of the Start server context the server-function boundary reads. */
export interface DbErrorBoundaryOptions<TResult> {
  next: () => Promise<TResult>;
}

/** The request boundary's `next()` may return the response directly. */
export interface DbErrorRequestBoundaryOptions<TResult> {
  next: () => TResult | Promise<TResult>;
}

/**
 * Replaces a failed statement's SQL with a readable message.
 *
 * Every `createServerFn` handler that touches the database throws
 * `DrizzleQueryError`, and its message is the full SQL plus every bound
 * parameter:
 *
 *   Failed query: insert into "ingredients" (...) values (...)
 *   params: ING-117,Plastik 18,Packaging,RM,Pack,Pack,1,2600,0.1,true,true
 *
 * Client-side `onError` handlers read `error.message`, so one bad row put raw
 * SQL — including supplier and pricing values — into a toast in front of a
 * branch admin.
 *
 * Exported separately from the middleware so it can be driven directly in a
 * test: the global middleware only runs over a real Start request, which the
 * in-process integration harness cannot reach (the same reason ADR-0015 keeps
 * the server-function cores separately callable).
 */
export async function dbErrorBoundary<TResult>(
  options: DbErrorBoundaryOptions<TResult>,
): Promise<TResult> {
  try {
    return await options.next();
  } catch (err) {
    // Narrow to the query-failure class only. Everything else — auth guards,
    // FSM validation, deliberate domain errors — already carries a message meant
    // for the user and must pass through untouched.
    if (err instanceof DrizzleQueryError) {
      throw new Error(describeDbError(err));
    }
    throw err;
  }
}

/**
 * Global server-function error boundary, installed as `functionMiddleware` in
 * `src/start.ts`. This is the floor: no server function can leak SQL, and no
 * future one has to remember not to.
 *
 * Handlers that can do better still translate at their own boundary — the
 * ingredient and recipe cores pre-check duplicate codes so the message can name
 * the offending row. This is the fallback, not the replacement.
 */
export const dbErrorMiddleware = createMiddleware({ type: "function" }).server(dbErrorBoundary);

/**
 * Global server-route error boundary, installed as `requestMiddleware`.
 *
 * `functionMiddleware` only wraps `createServerFn`, so the `/api/*` file routes
 * need their own boundary or a failed statement there still surfaces raw SQL —
 * `/api/keepalive` in particular reported it straight into a response body.
 *
 * The body is intentionally the same shape as the server-function boundary: the
 * narrowing is duplicated rather than shared because a helper taking the caught
 * value would have to be typed `unknown`, which this repo's lint rules forbid.
 * Both copies must keep using `DrizzleQueryError`, not `DrizzleError`.
 */
export async function dbErrorRequestBoundary<TResult>(
  options: DbErrorRequestBoundaryOptions<TResult>,
): Promise<TResult> {
  try {
    return await options.next();
  } catch (err) {
    if (err instanceof DrizzleQueryError) {
      throw new Error(describeDbError(err));
    }
    throw err;
  }
}

export const dbErrorRequestMiddleware = createMiddleware({ type: "request" }).server(
  dbErrorRequestBoundary,
);
