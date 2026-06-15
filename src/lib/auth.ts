import { db } from "#/lib/server/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { account, session, users, verification } from "#/db/schema";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { passkey } from "@better-auth/passkey";
import { pinAuth } from "./auth-plugins/pin-auth";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session,
      account,
      verification,
    },
  }),

  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
  },

  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
      },
      status: {
        type: "string",
        required: false,
        defaultValue: "Active",
      },
      branchId: {
        type: "string",
        required: false,
      },
      pin: {
        type: "string",
        required: false,
      },
    },
  },

  emailAndPassword: {
    enabled: true,
  },
  // CSRF/origin check: better-auth's originCheckMiddleware skips requests
  // with no cookies (so signin works without a trusted origin) but
  // validates every state-changing request that carries the session
  // cookie (signout, update, etc.) against trustedOrigins. The default
  // trustedOrigins is derived from BETTER_AUTH_URL, which is set in
  // .env.local. If that env var points to a different port than the
  // actual dev server (eg 3000 vs 3001), the origin check rejects
  // signout with 403 "Invalid origin" -- the session cookie is never
  // cleared, and the hard navigation to /login still finds a valid
  // session, so the login page's 'if (user) Navigate to="/"' guard
  // fires and the user lands on their role-home (/pos for branch_admin,
  // /purchase-requisitions for admin_pusat) instead of /login.
  //
  // Always trust the request's own origin as a safety net. This
  // matches what the browser sends in the Origin header, so any
  // same-origin state-changing request passes CSRF.
  trustedOrigins: async (request) => {
    if (!request) return [];
    try {
      return [new URL(request.url).origin];
    } catch {
      return [];
    }
  },
  plugins: [passkey(), pinAuth(), tanstackStartCookies()],
});

export type AuthUser = typeof auth.$Infer.Session.user & {
  role: string;
  branchId?: string;
  pin?: string;
  status: string;
};
