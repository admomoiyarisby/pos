import { createAuthEndpoint, APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { db } from "#/lib/server/db";
import { users as usersTable, systemLogs, branches, branchStaffNames } from "#/db/schema";
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
          detail: `User "${String(userData.name)}" (${String(userData.role)}) login via PIN`,
          userId: userData.id,
          userName: String(userData.name),
        });

        // 7. Return success
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

    /**
     * Verify a branch PIN and return branch info + staff names.
     * Used as step 1 of the branch login flow.
     */
    verifyBranchPin: createAuthEndpoint(
      "/branch-pin-verify",
      {
        method: "POST",
        body: z.object({
          branchCode: z.string().min(1, "Kode cabang wajib diisi"),
          pin: z.string().regex(/^\d{4}$/, "PIN harus 4 digit"),
        }),
      },
      async (ctx: any) => {
        const { branchCode, pin } = ctx.body;

        // 1. Find branch by code
        const [branch] = await db
          .select()
          .from(branches)
          .where(and(eq(branches.code, branchCode), eq(branches.active, true)))
          .limit(1);

        if (!branch) {
          throw APIError.from("NOT_FOUND", {
            code: "BRANCH_NOT_FOUND",
            message: "Cabang tidak ditemukan",
          });
        }

        // 2. Verify PIN
        // TODO(security): PINs are stored as plaintext. Consider hashing with bcrypt
        // before storage. This is a shared branch secret, not per-user, so the threat
        // model is different from user passwords, but hashing is still recommended.
        if (!branch.pin || branch.pin !== pin) {
          throw APIError.from("UNAUTHORIZED", {
            code: "INVALID_PIN",
            message: "PIN cabang tidak valid",
          });
        }

        // 3. Get staff names for this branch
        // Combine staff from branchStaffNames table AND users table
        const staffNameEntries = await db
          .select({
            id: branchStaffNames.id,
            name: branchStaffNames.name,
          })
          .from(branchStaffNames)
          .where(and(eq(branchStaffNames.branchId, branch.id), eq(branchStaffNames.active, true)))
          .orderBy(branchStaffNames.name);

        // Also get users assigned to this branch
        const branchUsers = await db
          .select({
            id: usersTable.id,
            name: usersTable.name,
          })
          .from(usersTable)
          .where(and(eq(usersTable.branchId, branch.id), eq(usersTable.status, "Active")))
          .orderBy(usersTable.name);

        // Merge and deduplicate by name
        const nameSet = new Set<string>();
        const staffNames: { id: string; name: string }[] = [];

        // Add staff name entries first
        for (const entry of staffNameEntries) {
          if (!nameSet.has(entry.name)) {
            nameSet.add(entry.name);
            staffNames.push(entry);
          }
        }

        // Add branch users that aren't already in the list
        for (const user of branchUsers) {
          if (!nameSet.has(user.name)) {
            nameSet.add(user.name);
            staffNames.push({ id: user.id, name: user.name });
          }
        }

        // 4. Return branch info + staff names
        return ctx.json({
          success: true,
          branch: {
            id: branch.id,
            code: branch.code,
            name: branch.name,
          },
          staffNames,
        });
      },
    ),

    /**
     * Login with a non-branch user PIN.
     * Used for Superadmin, Admin Pusat, Central Kitchen, and Area Manager.
     * The PIN is individual and globally unique, so entering it directly
     * identifies the user — no name picker needed.
     */
    nonBranchPinLogin: createAuthEndpoint(
      "/non-branch-pin-login",
      {
        method: "POST",
        body: z.object({
          pin: z.string().regex(/^\d{4}$/, "PIN harus 4 digit"),
        }),
      },
      async (ctx: any) => {
        const { pin } = ctx.body;

        // 1. Find user by PIN
        const [user] = await db
          .select()
          .from(usersTable)
          .where(and(eq(usersTable.pin, pin), eq(usersTable.status, "Active")))
          .limit(1);

        // 2. Validate user exists and is a non-branch role
        const nonBranchRoles = ["super_admin", "admin_pusat", "central_kitchen", "area_manager"];
        if (!user || !nonBranchRoles.includes(user.role)) {
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

        // 5. Set session cookie
        await setSessionCookie(ctx, { session, user: userData });

        // 6. Log PIN login
        await db.insert(systemLogs).values({
          action: "Non-Branch PIN Login",
          detail: `User "${String(userData.name)}" (${String(userData.role)}) login via PIN`,
          userId: userData.id,
          userName: String(userData.name),
        });

        // 7. Return success
        return ctx.json({
          success: true,
          user: {
            id: userData.id,
            name: userData.name,
            role: userData.role,
          },
        });
      },
    ),

    /**
     * Login with branch ID and staff name.
     * Used as step 2 of the branch login flow.
     * Creates a session for the selected staff member.
     */
    branchLogin: createAuthEndpoint(
      "/branch-login",
      {
        method: "POST",
        body: z.object({
          branchId: z.string().uuid(),
          staffName: z.string().min(1, "Nama staff wajib diisi"),
        }),
      },
      async (ctx: any) => {
        const { branchId, staffName } = ctx.body;

        // 1. Verify branch exists
        const [branch] = await db
          .select()
          .from(branches)
          .where(and(eq(branches.id, branchId), eq(branches.active, true)))
          .limit(1);

        if (!branch) {
          throw APIError.from("NOT_FOUND", {
            code: "BRANCH_NOT_FOUND",
            message: "Cabang tidak ditemukan",
          });
        }

        // 2. Verify staff name exists for this branch
        // Check branchStaffNames table first
        const [staffEntry] = await db
          .select()
          .from(branchStaffNames)
          .where(
            and(
              eq(branchStaffNames.branchId, branchId),
              eq(branchStaffNames.name, staffName),
              eq(branchStaffNames.active, true),
            ),
          )
          .limit(1);

        // Also check users table for existing users assigned to this branch
        const [existingUser] = await db
          .select()
          .from(usersTable)
          .where(
            and(
              eq(usersTable.branchId, branchId),
              eq(usersTable.name, staffName),
              eq(usersTable.status, "Active"),
            ),
          )
          .limit(1);

        // Staff must exist in at least one of the tables
        if (!staffEntry && !existingUser) {
          throw APIError.from("NOT_FOUND", {
            code: "STAFF_NOT_FOUND",
            message: "Nama staff tidak ditemukan di cabang ini",
          });
        }

        // 3. Find or create a user account for this staff member
        // If user already exists in users table, use that account
        let user = existingUser;

        if (!user) {
          // Create a user account for this staff member
          const email = `${branch.code.toLowerCase()}_${staffName.toLowerCase().replace(/\s+/g, "_")}@staff.omoiyari.net`;

          const [newUser] = await db
            .insert(usersTable)
            .values({
              name: staffName,
              email,
              role: "branch_admin",
              branchId,
              status: "Active",
              emailVerified: true,
            })
            .returning();
          user = newUser;
        }

        // 4. Create session
        const session = await ctx.context.internalAdapter.createSession(user.id);
        if (!session) {
          throw APIError.from("INTERNAL_SERVER_ERROR", {
            code: "FAILED_TO_CREATE_SESSION",
            message: "Gagal membuat sesi",
          });
        }

        // 5. Get full user data for the session cookie
        const userData = await ctx.context.internalAdapter.findUserById(user.id);
        if (!userData) {
          throw APIError.from("INTERNAL_SERVER_ERROR", {
            code: "USER_NOT_FOUND",
            message: "User tidak ditemukan",
          });
        }

        // 6. Set session cookie
        await setSessionCookie(ctx, { session, user: userData });

        // 7. Log branch login
        await db.insert(systemLogs).values({
          action: "Branch Login",
          detail: `Staff "${staffName}" login di cabang "${branch.name}" (${branch.code})`,
          userId: userData.id,
          userName: staffName,
        });

        // 8. Return success
        return ctx.json({
          success: true,
          user: {
            id: userData.id,
            name: staffName,
            role: "branch_admin",
            branchId,
            branchCode: branch.code,
            branchName: branch.name,
          },
        });
      },
    ),
  },
});
