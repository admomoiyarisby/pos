import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { branches } from "#/db/schema";

const seedData = createServerFn({ method: "POST" }).handler(async () => {
  // Seed branches
  const existingBranches = await db.select().from(branches);
  if (existingBranches.length === 0) {
    await db.insert(branches).values([
      {
        code: "CENTRAL",
        name: "Central Warehouse",
        location: "Pusat",
        active: true,
        isOnline: true,
        type: "Central",
      },
      {
        code: "SBY-01",
        name: "Omoiyari Surabaya Pusat",
        location: "Tegalsari, Surabaya",
        active: true,
        isOnline: true,
        type: "Outlet",
      },
      {
        code: "SBY-02",
        name: "Omoiyari Surabaya Barat",
        location: "Sambikerep, Surabaya",
        active: true,
        isOnline: false,
        type: "Outlet",
      },
    ]);
  }

  return { success: true, message: "Seed completed" };
});

export const Route = createFileRoute("/api/seed")({
  server: {
    handlers: {
      POST: async () => {
        const result = await seedData();
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
