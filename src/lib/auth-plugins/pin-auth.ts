import { createAuthEndpoint, APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { db } from "#/lib/server/db";
import { users as usersTable, systemLogs } from "#/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

/**
 * PIN Auth Plugin for better-auth
 *
 * Adds a `/pin-login` endpoint that creates a properly signed session cookie
 * using better-auth's internal session creation and cookie-signing mechanism.
 *
 * Uses Drizzle directly for the PIN user lookup (the adapter's findMany
 * doesn't reliably query additionalFields) and better-auth's official
 * `internalAdapter.createSession()` + `setSessionCookie()` for the session.
 */
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
      async (ctx: any) => {
        const { pin } = ctx.body;

        // 1. Find user by PIN via Drizzle (direct query, reliable)
        const [user] = await db
          .select()
          .from(usersTable)
          .where(
            and(
              eq(usersTable.pin, pin),
              // eq(usersTable.role, "branch_admin"),
              eq(usersTable.status, "Active"),
            ),
          )
          .limit(1);

        // 2. Validate user exists and has branchId
        if (!user || !user.branchId) {
          throw APIError.from("UNAUTHORIZED", {
            code: "INVALID_PIN",
            message: "PIN tidak valid",
          });
        }

        // 3. Create session via internal adapter
        const session = await ctx.context.internalAdapter.createSession(user.id);
        if (!session) {
          throw APIError.from("INTERNAL_SERVER_ERROR", {
            code: "FAILED_TO_CREATE_SESSION",
            message: "Gagal membuat sesi",
          });
        }

        // 4. Get full user data for the session cookie
        const userData = await ctx.context.internalAdapter.findUserById(user.id);
        if (!userData) {
          throw APIError.from("INTERNAL_SERVER_ERROR", {
            code: "USER_NOT_FOUND",
            message: "User tidak ditemukan",
          });
        }

        // 5. Set session cookie using better-auth's official function.
        //    This properly signs the token, sets companion cookies, and handles
        //    httpOnly/Secure/SameSite attributes — exactly the same as
        //    better-auth's own sign-in endpoints.
        await setSessionCookie(ctx, { session, user: userData });

        // 6. Log PIN login
        await db.insert(systemLogs).values({
          action: "PIN Login",
          detail: `User "${String(userData.name)}" (${String((userData as Record<string, unknown>).role)}) login via PIN`,
          userId: userData.id,
          userName: String(userData.name),
        });

        // 7. Return success
        return ctx.json({
          success: true,
          user: {
            id: userData.id,
            name: userData.name,
            role: (userData as Record<string, unknown>).role,
            branchId: (userData as Record<string, unknown>).branchId,
          },
        });
      },
    ),
  },
});
