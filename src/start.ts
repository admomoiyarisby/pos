import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { dbErrorMiddleware, dbErrorRequestMiddleware } from "#/lib/server/db-error-middleware";

/**
 * Start-level configuration.
 *
 * The CSRF middleware below is load-bearing. Start only installs its CSRF
 * protection **automatically when this file does not exist**, so defining
 * `src/start.ts` turns that implicit protection off. It is re-registered here
 * with the same scope Start used (server functions). Deleting it would leave
 * every mutating RPC open to cross-site requests on a POS that takes payments —
 * do not remove it without replacing the protection.
 *
 * The two error boundaries stop a failed statement's SQL from reaching a client.
 * The request-scoped one is listed after CSRF so CSRF rejection still wins:
 * `functionMiddleware` only covers `createServerFn`, and `requestMiddleware`
 * additionally covers the `/api/*` file routes and SSR.
 */
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, dbErrorRequestMiddleware],
  functionMiddleware: [dbErrorMiddleware],
}));
