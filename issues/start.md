# Import Protection Error: `@tanstack/react-start/server` in Client Bundle

## Error Summary

```
[import-protection] Import denied in client environment
  Denied by specifier pattern: @tanstack/react-start/server
  Importer: src/lib/server/auth.ts:58:19
  Import: "@tanstack/react-start/server"
```

The TanStack Start import protection plugin blocks the import of `@tanstack/react-start/server` because it is a server-only module that should never reach a client bundle.

## Import Chain

```
src/router.tsx:2:27          (entry)                   → imports "./routeTree.gen"
src/routeTree.gen.ts:5:42                               → imports "./routes/__root"
src/routes/__root.tsx:6:36   (import getCurrentUser)    → imports "../lib/server/auth"
src/lib/server/auth.ts:1:29  (import getRequest)        → imports "@tanstack/react-start/server"  ✗ DENIED
```

## Root Cause

The module `src/lib/server/auth.ts` imports `getRequest` from `@tanstack/react-start/server` at the module level (line 1):

```ts
import { getRequest } from "@tanstack/react-start/server";
```

This server-only function is used inside `getCurrentUserRaw()` (line 58) to access the Node.js request object for session validation.

The problem is that `src/routes/__root.tsx` imports `getCurrentUser` directly from this same module:

```ts
import { getCurrentUser } from "../lib/server/auth";
```

Route files under `src/routes/` are bundled for **both** the server and the client. When the client bundle is built, the static `import` of `@tanstack/react-start/server` is detected in the dependency graph, and the import protection plugin rejects it.

Even though:

- `getCurrentUser` is a `createServerFn` (designed to be called from the client via RPC)
- `getCurrentUserRaw()` is only **called** on the server
- `getRequest` is only called inside the function body, not at module scope

The **static ES module import** itself is enough to trigger the protection, because the bundler statically resolves all imports for the client bundle.

## Why It Exists

The architecture was likely structured this way for convenience:

- `getCurrentUserRaw` is a plain async function that does the actual work (query DB, parse user, fetch area manager branches)
- `getCurrentUser` is a thin `createServerFn` wrapper around `getCurrentUserRaw`
- `requireAuth` and `requireRole` are other thin wrappers that re-use `getCurrentUserRaw`
- All these live in one file sharing the `getRequest` call and the `auth` instance

However, placing the `@tanstack/react-start/server` import in a file that's reachable from a route component violates the client/server boundary enforced by TanStack Start.

## Possible Fixes (no code changes yet)

### Option A: Split server-only internals into a `.server.ts` file

Move the functions that depend on `getRequest()` (i.e., `getCurrentUserRaw`, `requireAuth`, `requireRole`) into a **new file** like `src/lib/server/auth.server.ts`. This file would contain the `import { getRequest } from "@tanstack/react-start/server"` and the raw logic.

Then `src/lib/server/auth.ts` would **re-export** the `createServerFn` wrappers from the `.server.ts` file, but would **not** itself import `@tanstack/react-start/server`.

The route would import only the `createServerFn` from `auth.ts`, and the server-only code stays safely in `auth.server.ts`.

**Downside**: The `.server.ts` file still cannot be imported by `__root.tsx` directly (that would trigger the same error). The route would still import the wrapper from `auth.ts`.

### Option B: Restructure the route to not import from `server/auth` at all

Instead of importing `getCurrentUser` from `../lib/server/auth` in `__root.tsx`, the route could:

- Define the loader using an inline `createServerFn`
- Or call the server function through TanStack Start's RPC mechanism

### Option C: Create a separate server-only route API

Move the `getCurrentUserRaw` logic to an API route (`/api/auth/user`) and call it from the client via a server function or fetch. This would keep server-only code completely out of the route files.

### Option D: Use `createIsomorphicFn` pattern

Use `createIsomorphicFn().client(() => ...).server(() => ...)` to provide separate implementations, avoiding the need to import server-only code from client-reachable modules.

## Recommendation

**Option A** is the cleanest approach with minimal restructuring:

1. Rename or extract `getCurrentUserRaw`, `requireAuth`, `requireRole` and the `getRequest` import into `src/lib/server/auth.server.ts`
2. Keep `getCurrentUser` (the `createServerFn`) in `src/lib/server/auth.ts`, but have it call the raw function from `auth.server.ts`
3. The route continues to import `getCurrentUser` from `../lib/server/auth` — this file no longer imports `@tanstack/react-start/server`
