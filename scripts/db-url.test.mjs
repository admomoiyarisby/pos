import { describe, expect, it } from "vite-plus/test";

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
  it("returns a session-mode URL", () => {
    // The live value from .env.local is the 6543 pooler; the helper must hand
    // back 5432 so a script cannot poison the app's pool.
    expect(["5432", ""]).toContain(new URL(requireScriptDatabaseUrl()).port);
  });
});
