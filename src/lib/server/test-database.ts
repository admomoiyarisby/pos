import { URL } from "node:url";

const LOCAL_TEST_DATABASE_URL =
  "postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test";

export function getTestDatabaseUrl(): string | undefined {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;

  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const database = url.pathname.replace(/^\//, "").toLowerCase();
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const isTestDatabase = database.includes("test") || database.includes("_test");

  if (!isLocalHost || !isTestDatabase) {
    throw new Error(
      "Refusing integration tests: TEST_DATABASE_URL must point to a local test database.",
    );
  }

  return value;
}

export { LOCAL_TEST_DATABASE_URL };
