import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { sessionModeUrl, requireScriptDatabaseUrl } from "./db-url.mjs";

describe("sessionModeUrl", () => {
  it("moves the shared transaction-mode pooler to session mode", () => {
    const rewritten = new URL(sessionModeUrl("postgresql://u:p@pooler.supabase.com:6543/db"));
    expect(rewritten.port).toBe("5432");
  });

  it("keeps the user, host and path", () => {
    const rewritten = new URL(
      sessionModeUrl("postgresql://postgres.abc:pw@aws-1.pooler.supabase.com:6543/postgres"),
    );
    expect(rewritten.username).toBe("postgres.abc");
    expect(rewritten.hostname).toBe("aws-1.pooler.supabase.com");
    expect(rewritten.pathname).toBe("/postgres");
  });

  it("preserves query parameters", () => {
    expect(new URL(sessionModeUrl("postgresql://u:p@h:6543/db?sslmode=require")).search).toBe(
      "?sslmode=require",
    );
  });

  // A local socket or an already-session-mode URL has no pooled backend to
  // protect, and rewriting its port would point the script at nothing.
  it("leaves a non-pooler URL untouched", () => {
    expect(sessionModeUrl("postgresql://u:p@localhost:5433/db")).toBe(
      "postgresql://u:p@localhost:5433/db",
    );
    expect(sessionModeUrl("postgresql://u:p@h:5432/db")).toBe("postgresql://u:p@h:5432/db");
    expect(sessionModeUrl("postgresql://u:p@localhost/db")).toBe("postgresql://u:p@localhost/db");
  });
});

describe("requireScriptDatabaseUrl", () => {
  // The helper resolves DATABASE_URL from the ambient environment, falling back
  // to .env.local. CI has neither — .env.local is gitignored and the workflow
  // passes only SUPABASE_URL — so this test must supply its own value rather
  // than depend on whatever the machine happens to have. Without it the helper
  // reaches `process.exit(1)`, which fails the run with a bare "process.exit
  // unexpectedly called" and no hint that a gitignored file is the cause.
  // Restored afterwards so this file cannot leak an override into later tests.
  let original;

  beforeEach(() => {
    original = process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it("returns a session-mode URL", () => {
    // loadEnvLocal does not overwrite a variable already in the environment, so
    // this value wins over .env.local. The helper must hand back 5432 so a
    // script cannot poison the app's pool.
    process.env.DATABASE_URL =
      "postgresql://postgres.abc:pw@aws-1.pooler.supabase.com:6543/postgres";
    expect(new URL(requireScriptDatabaseUrl()).port).toBe("5432");
  });

  it("leaves a non-pooler URL alone", () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5433/db";
    expect(new URL(requireScriptDatabaseUrl()).port).toBe("5433");
  });
});
