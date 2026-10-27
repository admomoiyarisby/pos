#!/usr/bin/env node
// Create (or reset) the account the rehearsal smoke test logs in with.
//
// Restored production users have unknown passwords, so the rehearsal gets its
// own account. The script refuses any database whose name does not contain
// `rehearsal`, `restore_test`, or `_test` — it must never run against
// production.
//
//   TARGET_DATABASE_URL='postgresql://omoiyari:...@127.0.0.1:55432/omoiyari_rehearsal' \
//   SMOKE_EMAIL=smoke@omoiyari.test \
//   SMOKE_PASSWORD='...' \
//   node scripts/smoke/create-smoke-user.mjs

import pg from "pg";
import { hashPassword } from "better-auth/crypto";
import process from "node:process";

const url = process.env.TARGET_DATABASE_URL;
if (!url) throw new Error("Missing TARGET_DATABASE_URL");
const email = (process.env.SMOKE_EMAIL ?? "smoke@omoiyari.test").toLowerCase();
const password = process.env.SMOKE_PASSWORD ?? "smoke-password-123";
const name = process.env.SMOKE_NAME ?? "Smoke Test";

const database = new URL(url).pathname.replace(/^\//, "").toLowerCase();
if (!/rehearsal|restore_test|_test/.test(database)) {
  throw new Error(
    `Refusing to create a smoke user in "${database}": not a rehearsal/test database`,
  );
}

const client = new pg.Client({
  connectionString: url,
  ssl: /supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

try {
  const userId = crypto.randomUUID();
  const hashed = await hashPassword(password);

  await client.query("begin");
  await client.query(
    `insert into users (id, email, name, role, status, email_verified)
     values ($1, $2, $3, 'super_admin', 'Active', true)
     on conflict (email) do update
       set name = excluded.name, role = excluded.role, status = 'Active', email_verified = true
     returning id`,
    [userId, email, name],
  );
  const { rows } = await client.query("select id from users where email = $1", [email]);
  const id = rows[0].id;

  // better-auth >= 1.7 matches credential accounts on providerId + issuer +
  // accountId. Keep both rows in sync when the user already exists.
  await client.query("delete from account where user_id = $1 and provider_id = 'credential'", [id]);
  await client.query(
    `insert into account (id, account_id, provider_id, issuer, user_id, password, created_at, updated_at)
     values ($1, $2, 'credential', 'local:credential', $3, $4, now(), now())`,
    [crypto.randomUUID(), id, id, hashed],
  );
  await client.query("commit");

  console.log(JSON.stringify({ ok: true, email, userId: id, database }, null, 2));
} catch (err) {
  await client.query("rollback").catch(() => {});
  throw err;
} finally {
  await client.end();
}
