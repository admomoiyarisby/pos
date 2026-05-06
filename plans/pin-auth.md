# PIN Authentication Implementation Plan (v2 — Better-Auth Plugin)

## Overview

Implement PIN-based login for `branch_admin` users using a **custom better-auth plugin** instead of a standalone API route. This is the only reliable way to create a properly signed session cookie that better-auth's `getSession` can verify.

## Why the Standalone API Route Failed

The previous approach (`/api/pin-login.ts` as a standalone TanStack Start route) attempted to manually sign the session cookie with HMAC-SHA256 to match better-auth's `getSignedCookie` verification. Despite matching the algorithm, key format, and encoding, the cookie was still rejected with `401 Unauthorized`. The root cause:

- `setSessionCookie()` does more than raw HMAC signing — it also sets secondary cookies (session data cache), handles `dontRememberMe` flags, and uses the internal `authCookies` config from the auth context
- `getSignedCookie` uses `verifySignature` which may have subtle differences in key derivation or encoding that are hard to replicate externally
- The `better-auth.session_token` cookie alone is not sufficient; better-auth may also check `better-auth.session_data` or other companion cookies

**The only reliable solution**: create the session from _inside_ the better-auth framework, using the same `ctx.context.internalAdapter.createSession()` + `setSessionCookie()` pattern that the passkey plugin uses.

---

## Architecture Decision

Create a custom better-auth plugin (`pinAuth`) that adds a `/pin-login` endpoint to the auth router. This endpoint:

1. Receives `{ pin: string }` in the body
2. Queries the `users` table for a matching PIN
3. Validates the user is `branch_admin`, `Active`, and has a `branchId`
4. Creates a session via `ctx.context.internalAdapter.createSession(userId)`
5. Fetches the user via `ctx.context.internalAdapter.findUserById(userId)`
6. Calls `setSessionCookie(ctx, { session, user })` — this properly signs and sets all necessary cookies
7. Returns `{ success: true, user }`

This is the **exact same pattern** the `@better-auth/passkey` plugin uses in its `verifyPasskeyAuthentication` endpoint. By following this pattern, the session cookie will be 100% compatible with better-auth's session validation.

---

## Task 1: Custom PIN Auth Plugin

### File: `src/lib/auth-plugins/pin-auth.ts` (new)

Create a new file that exports a `pinAuth` plugin function.

**Requirements:**

```ts
import { createAuthEndpoint } from "@better-auth/core/api";
import { setSessionCookie } from "better-auth/cookies";
import { APIError } from "@better-auth/core/error";
import { z } from "zod";

export const pinAuth = () => ({
  id: "pin-auth",
  endpoints: {
    signInWithPin: createAuthEndpoint(
      "/pin-login",
      {
        method: "POST",
        body: z.object({
          pin: z.string().regex(/^\d{4}$/, "PIN harus 4 digit"),
        }),
      },
      async (ctx) => {
        // 1. Find user by PIN using the adapter
        const users = await ctx.context.adapter.findMany({
          model: "user",
          where: [{ field: "pin", value: ctx.body.pin }],
        });
        const user = users[0];

        // 2. Validate user exists, is branch_admin, Active, and has branchId
        if (!user || user.role !== "branch_admin" || user.status !== "Active" || !user.branchId) {
          throw APIError.from("UNAUTHORIZED", { message: "PIN tidak valid" });
        }

        // 3. Create session via internal adapter
        const session = await ctx.context.internalAdapter.createSession(user.id);
        if (!session) {
          throw APIError.from("INTERNAL_SERVER_ERROR", { message: "Gagal membuat sesi" });
        }

        // 4. Get full user data
        const userData = await ctx.context.internalAdapter.findUserById(user.id);
        if (!userData) {
          throw APIError.from("INTERNAL_SERVER_ERROR", { message: "User tidak ditemukan" });
        }

        // 5. Set session cookie using better-auth's official function
        await setSessionCookie(ctx, { session, user: userData });

        // 6. Return success
        return ctx.json({
          success: true,
          user: {
            id: userData.id,
            name: userData.name,
            role: userData.role,
            branchId: userData.branchId,
          },
        });
      },
    ),
  },
});
```

**Key points:**

- The endpoint path is `/pin-login` — better-auth will mount it at `/api/auth/pin-login` (respecting the `basePath` config)
- `ctx.context.adapter.findMany` queries the `users` table via the Drizzle adapter
- `ctx.context.internalAdapter.createSession(user.id)` creates the session row in the DB
- `setSessionCookie(ctx, { session, user })` properly signs and sets the cookie using the auth context's secret and cookie config
- No manual cookie signing needed — better-auth handles everything

---

## Task 2: Register the Plugin in Auth Config

### File: `src/lib/auth.ts`

Import and add the `pinAuth` plugin to the plugins array.

```ts
import { passkey } from "@better-auth/passkey";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { pinAuth } from "./auth-plugins/pin-auth";

export const auth = betterAuth({
  // ...existing config...
  plugins: [passkey(), pinAuth(), tanstackStartCookies()],
});
```

**Note:** The `passkey` plugin is already installed and the `passkey` table is already in the schema. Keep it in the plugins array. The `pinAuth` plugin should be added alongside it.

---

## Task 3: Update the Login Page

### File: `src/routes/login.tsx`

Change the PIN submit handler to call the better-auth endpoint instead of the standalone API route.

**Change the fetch URL:**

```tsx
const handlePinSubmit = async (enteredPin: string) => {
  setPinError("");
  setPinLoading(true);
  try {
    const res = await fetch("/api/auth/pin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: enteredPin }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPinError(data.error || "Login gagal");
      setPin("");
    } else {
      void router.invalidate();
    }
  } catch {
    setPinError("Terjadi kesalahan saat login");
    setPin("");
  } finally {
    setPinLoading(false);
  }
};
```

The only change from the previous implementation is the URL: `/api/auth/pin-login` instead of `/api/pin-login`.

**Also update:** The existing standalone `src/routes/api/pin-login.ts` can be deleted or left as-is (it won't be used anymore).

---

## Task 4: PIN Uniqueness Validation in User Management

### File: `src/lib/server/users.ts`

Keep the existing plan: add PIN uniqueness validation in `createUser` and `updateUser` before calling better-auth's sign-up or before the DB update.

**Validation logic:**

```ts
// In createUser:
if (data.pin) {
  const existing = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.pin, data.pin), eq(usersTable.branchId, data.branchId)))
    .limit(1);
  if (existing[0]) {
    throw new Error("PIN sudah digunakan oleh user lain di cabang ini");
  }
}

// In updateUser:
if (data.pin) {
  const existing = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.pin, data.pin),
        eq(usersTable.branchId, data.branchId),
        data.id ? not(eq(usersTable.id, data.id)) : undefined,
      ),
    )
    .limit(1);
  if (existing[0]) {
    throw new Error("PIN sudah digunakan oleh user lain di cabang ini");
  }
}
```

---

## Task 5: PIN Pad UI Component

### File: `src/components/PinPad.tsx`

No changes from the previous plan. The component already exists and works correctly.

---

## Task 6: Login Page — Dual Mode (Email / PIN)

### File: `src/routes/login.tsx`

No major changes from the previous plan. The PIN/Email tab switcher and PinPad integration are already implemented. Only the API endpoint URL changes (see Task 3).

---

## Task 7: Users Admin Page — PIN Display & Enhanced Validation

### File: `src/routes/_layout/admin/users.tsx`

No changes from the previous plan. The PIN column, role-gated PIN field, and branch requirement validation are already specified.

---

## Task 8: Passkey Plugin Integration (Optional Future)

The `@better-auth/passkey` plugin is already installed and configured. It adds WebAuthn passkey support for users who want biometric or security key authentication.

**Current state:**

- Plugin is registered in `src/lib/auth.ts`
- `passkey` table exists in `src/db/schema.ts`
- DB migration has been run

**Future enhancement (not required for PIN login):**

- Super Admin users can register passkeys for additional security
- The login page could offer a "Sign in with Passkey" button alongside Email and PIN
- This is a separate feature from PIN login and can be implemented later

**For now:** Keep the passkey plugin installed but don't expose passkey UI on the login page. The primary login methods remain Email and PIN.

---

## Task 9: Seed Data

### File: `src/lib/seed/seed-data.ts`

The current seed data already includes PIN values for all `branch_admin` users:

```ts
{ email: "hans@omoiyari.net",  pin: "1234", role: "branch_admin", branchCode: "SBY-01" },
{ email: "siti@omoiyari.net",  pin: "2345", role: "branch_admin", branchCode: "SBY-02" },
{ email: "budi@omoiyari.net",  pin: "3456", role: "branch_admin", branchCode: "SBY-03" },
{ email: "rina@omoiyari.net",  pin: "4567", role: "branch_admin", branchCode: "SBY-04" },
{ email: "dewi@omoiyari.net",  pin: "5678", role: "branch_admin", branchCode: "MLG-01" },
```

**No changes needed** to the seed data. The PIN values are already unique per branch and correctly assigned.

**Note:** Non-branch_admin users (super_admin, admin_pusat, area_manager, central_kitchen) also have PINs in the seed data (`1111`, `2222`, `3333`). These PINs are stored but won't work for PIN login because the endpoint only allows `branch_admin` with an assigned `branchId`.

---

## Task 10: Setup Endpoint

### File: `src/routes/api/setup.ts`

The setup endpoint currently calls `seedAll(true)` which seeds all demo data including users with PINs.

**No changes needed** to the setup endpoint logic. However, after implementing the PIN auth plugin, verify that the setup endpoint still works correctly:

1. Run `POST /api/setup` to seed data
2. Verify that `branch_admin` users have PINs in the DB
3. Test PIN login with one of the seeded PINs (e.g., `1234` for hans@omoiyari.net)

**Optional enhancement:** Add a dedicated seed function for passkey demo data (if passkey login is ever exposed in the UI):

```ts
// In src/lib/seed/seed.ts (future)
export async function seedPasskeys(idMap: IdMap) {
  // Register demo passkeys for super admin
  // This requires WebAuthn browser APIs and can't be done server-side
  // Skip for now — passkey registration is client-side only
}
```

---

## File Summary

| File                                 | Action                | Description                                            |
| ------------------------------------ | --------------------- | ------------------------------------------------------ |
| `src/lib/auth-plugins/pin-auth.ts`   | **Create**            | Custom better-auth plugin for PIN login                |
| `src/lib/auth.ts`                    | **Modify**            | Add `pinAuth()` to plugins array                       |
| `src/routes/login.tsx`               | **Modify**            | Change PIN login API URL to `/api/auth/pin-login`      |
| `src/lib/server/users.ts`            | **Modify**            | Add PIN uniqueness validation (if not already done)    |
| `src/routes/api/pin-login.ts`        | **Delete** (optional) | Remove the standalone API route                        |
| `src/components/PinPad.tsx`          | **Keep**              | Already implemented                                    |
| `src/routes/_layout/admin/users.tsx` | **Modify**            | PIN column, role-gated PIN field (if not already done) |
| `src/lib/seed/seed-data.ts`          | **Keep**              | No changes needed                                      |
| `src/lib/seed/seed.ts`               | **Keep**              | No changes needed                                      |
| `src/routes/api/setup.ts`            | **Keep**              | No changes needed                                      |

---

## Testing Checklist

### Plugin & Backend

- [ ] `POST /api/auth/pin-login` with valid PIN → creates session, sets cookie, returns user
- [ ] `POST /api/auth/pin-login` with invalid PIN → 401 error
- [ ] `POST /api/auth/pin-login` with inactive user PIN → 401 error
- [ ] `POST /api/auth/pin-login` with non-branch_admin PIN → 401 error
- [ ] `POST /api/auth/pin-login` with branch_admin missing branchId → 401 error
- [ ] After PIN login, `auth.api.getSession` returns the session
- [ ] After PIN login, root loader `getCurrentUser` returns the correct user
- [ ] Session cookie persists across page reloads
- [ ] `authClient.signOut()` clears the session after PIN login
- [ ] Create user with duplicate PIN in same branch → server error
- [ ] Update user with duplicate PIN in same branch → server error

### Frontend

- [ ] Login page shows PIN/Email tabs
- [ ] PIN pad renders and submits correctly
- [ ] Entering 4 digits auto-submits
- [ ] Invalid PIN shows error and resets pad
- [ ] Email login still works
- [ ] After PIN login, user is redirected to dashboard
- [ ] After PIN login, sidebar shows correct branch context
- [ ] After PIN login, POS page shows correct branch

### Passkey Plugin (Verification)

- [ ] Passkey plugin endpoints are accessible at `/api/auth/passkey/*`
- [ ] Passkey table exists and is queryable
- [ ] No errors in server logs from passkey plugin

---

## Migration Notes

1. The `passkey` table is already in `src/db/schema.ts` and already migrated
2. The `@better-auth/passkey` package is already installed
3. The `passkey()` plugin is already in `src/lib/auth.ts`
4. The `pin` field is already in `users` table and better-auth `additionalFields`
5. The `user_pin_branch_unique` constraint already exists
6. The only new file needed is `src/lib/auth-plugins/pin-auth.ts`
7. Only minor changes needed to `src/lib/auth.ts` and `src/routes/login.tsx`
