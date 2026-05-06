import { db } from "#/db";
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
  plugins: [passkey(), pinAuth(), tanstackStartCookies()],
});

export type AuthUser = typeof auth.$Infer.Session.user & {
  role: string;
  branchId?: string;
  pin?: string;
  status: string;
};
