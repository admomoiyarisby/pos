# Auth Schema Refactor Plan

## Current State

| File                    | Purpose                            | Key Tables                                                                                              |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/db/schema.ts`      | Business schema (Drizzle)          | `users` (uuid PK), `userSessions` (custom auth sessions), ~40 business tables                           |
| `./auth-schema.ts`      | Fresh canonical Better-Auth schema | `user` (text PK), `session`, `account`, `verification`                                                  |
| `src/db/auth-schema.ts` | Old adapted Better-Auth schema     | `user` (text PK, plus custom `role`, `branchId`, `pin`, `status`), `session`, `account`, `verification` |

### New Information

A fresh canonical better-auth schema was generated at **`./auth-schema.ts`**. It contains **only** the standard columns (`id`, `name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt`). Critically, the business `users` table already contains every one of these columns. This makes `users` a **strict superset** of the auth `user` table.

### Problems

1. **Identity Split**: `users` (business) and `user` (auth) represent the same person. The fresh schema shows the overlap is 100% on standard fields.
2. **ID Type Mismatch**: `users.id` is `uuid` with `defaultRandom()`. `user.id` is `text` (cuid/nanoid). Every business table FKs to `users.id` (uuid).
3. **Session Duplication**: `userSessions` (custom) and `session` (better-auth) both store auth tokens, expiry, IP, and device info.
4. **Password Duality**: `users.passwordHash` stores local creds; better-auth stores them in `account.password`.
5. **Maintenance Hazard**: If kept separate, every signup, email change, or role update must be synced across two tables. With 20+ FKs pointing to `users`, the business table cannot be dropped.

---

## Decision Matrix

| Approach                                           | Upfront Effort | Long-term Health            | Risk   | Verdict         |
| -------------------------------------------------- | -------------- | --------------------------- | ------ | --------------- |
| **A. Merge into `users`** (single source of truth) | Medium         | Best                        | Medium | **Recommended** |
| **B. Sidecar bridge** (`user` + `users`)           | Low            | Poor (permanent sync logic) | Low    | Fallback only   |

**Recommendation: Approach A**. The fresh canonical schema confirms the overlap is 100% on standard fields. A merge eliminates sync logic, preserves all existing FKs, and gives better-auth direct access to business context (`role`, `branchId`, etc.) without joins.

---

## Approach A: Canonical User Table (Recommended)

### Core Principles

1. **`users` is the only user table.** Better-auth adapts to it; we do not reshape the business schema for the auth library.
2. **`session` replaces `userSessions`.** Better-auth manages auth sessions. `shifts` remains untouched (it is a business concept, not an auth session).
3. **`account` and `verification` are net-new.** They have zero conflicts with existing tables.
4. **Do not change `users.id` to `text`.** That would cascade to 20+ tables. Keep `uuid` and configure better-auth to generate UUID strings instead.

---

### Step 1: Replace `src/db/auth-schema.ts` with the canonical schema (minus `user`)

The fresh `./auth-schema.ts` is the correct reference. Copy its contents into `src/db/auth-schema.ts`, then **delete the `user` table** from it. The remaining tables should be:

- `session`
- `account`
- `verification`

After this, delete the stray `./auth-schema.ts` at the project root to avoid confusion.

> **Why keep `auth-schema.ts`?** Separation of concerns. Business tables in `schema.ts`, auth-only tables in `auth-schema.ts`. Both are exported into the Drizzle client schema map.

---

### Step 2: Fix FK column types in auth tables

Because `users.id` is `uuid`, all auth tables that reference it must use `uuid` FKs, not `text`.

**`src/db/auth-schema.ts` changes:**

```ts
// session.userId
userId: uuid("user_id")
  .notNull()
  .references(() => users.id, { onDelete: "cascade" }),

// account.userId
userId: uuid("user_id")
  .notNull()
  .references(() => users.id, { onDelete: "cascade" }),
```

Also remove `userRelations`, `sessionRelations`, `accountRelations` from `auth-schema.ts` and define them centrally in `schema.ts` (see Step 6).

---

### Step 3: Configure better-auth to use `users`

In the better-auth config, map the schema object so that the **logical** `user` key points to the **physical** `users` table.

```ts
import { users } from "@/db/schema";
import { session, account, verification } from "@/db/auth-schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users, // ← better-auth's "user" concept → our "users" table
      session,
      account,
      verification,
    },
  }),
  advanced: {
    // Generate UUID strings so they fit the uuid column type
    generateId: () => crypto.randomUUID(),
  },
  // ... plugins, social providers, etc.
});
```

Better-auth will ignore columns it does not recognize (`pin`, `branchId`, `status`, `role`). It will read/write the standard fields (`id`, `name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt`) directly from `users`.

**One small alignment:** The fresh schema defines `updatedAt` with `$onUpdate(() => new Date())`. Add this to `users.updatedAt` in `schema.ts` so behavior is identical:

```ts
updatedAt: timestamp("updated_at", { mode: "date" })
  .defaultNow()
  .$onUpdate(() => new Date())
  .notNull(),
```

---

### Step 4: Remove `passwordHash` from `users`

Better-auth stores local passwords in `account.password` (credential provider). The `passwordHash` column in `users` is now orphaned.

**Migration options:**

- **Preferred**: Force a password reset for all users on next login. This is the cleanest because existing bcrypt/argon2 hashes in `users.passwordHash` may not match better-auth's internal hash format.
- **Alternative**: If the hash format is compatible (e.g., both use bcrypt), write a one-off script to migrate each `users.passwordHash` into a new `account` row with `providerId: "credential"`.

After migration, drop the column:

```ts
// In schema.ts — remove this line from users table
passwordHash: text("password_hash"),
```

---

### Step 5: Replace `userSessions` with `session`

`userSessions` is a custom auth session. Better-auth's `session` table covers the same ground.

| `userSessions` | `session` (better-auth)           |
| -------------- | --------------------------------- |
| `id: uuid`     | `id: text`                        |
| `userId: uuid` | `userId: uuid` (after Step 2)     |
| `token`        | `token`                           |
| `deviceInfo`   | `userAgent` (semantic equivalent) |
| `ipAddress`    | `ipAddress`                       |
| `isActive`     | implicit: `expiresAt > now()`     |
| `expiresAt`    | `expiresAt`                       |
| `createdAt`    | `createdAt`                       |

**Action:**

1. Drop `userSessions` from `schema.ts`.
2. Update any queries that read `userSessions` to query `session` instead.
3. Replace `isActive` checks with `expiresAt` comparisons.
4. Map `deviceInfo` reads to `userAgent`.

> **Note**: This will invalidate all active sessions (users must log in again). Announce a maintenance window or accept the logout blast.

---

### Step 6: Centralize relations

Remove all `relations` definitions from `auth-schema.ts`. In `schema.ts`, add:

```ts
export const usersRelations = relations(users, ({ one, many }) => ({
  // ... existing relations ...
  sessions: many(session), // replaces userSessions
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(users, {
    fields: [session.userId],
    references: [users.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(users, {
    fields: [account.userId],
    references: [users.id],
  }),
}));
```

Remove `userSessions` and `userSessionsRelations` entirely.

---

### Step 7: Migration order (Drizzle / SQL)

Run these in a single deploy to avoid partial states:

1. **Create** `account`, `session`, `verification` tables (Drizzle migration).
2. **Migrate passwords** (optional script) or announce forced reset.
3. **Drop** `userSessions` table.
4. **Drop** `user` table (if it was ever pushed to the database).
5. **Drop** `passwordHash` column from `users`.

---

## Approach B: Sidecar Bridge (Fallback)

If better-auth proves incompatible with custom columns or uuid PKs (unlikely, but possible), fall back to this pattern:

1. **Keep both tables:**
   - `user` (better-auth, text PK, minimal fields)
   - `users` (business, uuid PK, all FKs)
2. **Add a bridge column:**
   ```ts
   authUserId: text("auth_user_id").references(() => user.id);
   ```
3. **Sync via hooks:**
   ```ts
   databaseHooks: {
     user: {
       create: {
         after: async (user) => {
           // Insert matching row into `users`
         };
       }
     }
   }
   ```
4. **Rename `userSessions` → `deviceSessions`** to avoid semantic collision with better-auth `session`.

**Downside:** Every user read in business logic requires a join or dual fetch. Every email update must be synced. Permanent tech debt.

---

## File Structure (Target)

```
src/db/
  schema.ts          # Business tables + relations (users, orders, shifts, inventory, ...)
  auth-schema.ts     # Auth-only tables (session, account, verification)
  index.ts           # Drizzle client + schema map export
```

`schema.ts` should import `session`, `account`, `verification` from `auth-schema.ts` only for the purpose of re-exporting them in the central schema object. Do not define `user` in `auth-schema.ts`.

---

## What was done

### Schema (`src/db/schema.ts`)

- [x] Added `$onUpdate(() => new Date())` to `users.updatedAt`
- [x] Removed `passwordHash` column from `users`
- [x] Removed `userSessions` table (was duplicated by better-auth `session`)
- [x] Added `session` table (FK → users.id, uuid type)
- [x] Added `account` table (FK → users.id, uuid type)
- [x] Added `verification` table (standalone, no FK)
- [x] Updated `usersRelations`: `sessions: many(session)`, `accounts: many(account)`
- [x] Added `sessionRelations` and `accountRelations`
- [x] Removed `userSessionsRelations`

### Auth config (`src/lib/auth.ts`)

- [x] Added schema mapping: `user: users`
- [x] Added `advanced.generateId: () => crypto.randomUUID()`

### Helper files

- [x] **`src/routes/api/setup.ts`**: Removed `authId` references (unneeded since `users.id` IS the auth ID now)
- [x] **`src/lib/server/auth.ts`**: Removed `users.authId` lookup — `session.user` now contains `role`, `branchId`, `pin`, `status` directly
- [x] **`src/db/auth-schema.ts`**: Reduced to a reference comment (tables live in `schema.ts`)
- [x] **`./auth-schema.ts`** (root): Deleted

### Migration (`drizzle/`)

- [x] Created `0001_add_better_auth_tables.sql` — incremental migration
- [x] Updated `_journal.json` with entry for 0001
- [x] Updated `0001_snapshot.json` to reflect state after migration

### Remaining checks

- [ ] Run `vp exec drizzle-kit migrate` against the real DB to apply `0001_add_better_auth_tables.sql`
- [ ] Test signup, login, session refresh, password reset
- [ ] Test business flows that read `users.role`, `users.branchId`, etc.
