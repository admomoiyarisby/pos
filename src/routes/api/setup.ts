import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { seedAll } from "#/lib/seed/seed";

function assertDevOnly() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed routes are disabled in production");
  }
}

const setupDemoData = createServerFn({ method: "POST" }).handler(async () => {
  assertDevOnly();
  await seedAll(true);
  return { success: true, message: "Setup completed" };
});

export const Route = createFileRoute("/api/setup")({
  server: {
    handlers: {
      POST: async () => {
        const result = await setupDemoData();
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
