import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import { branches, users } from "#/db/schema";
import { auth } from "#/lib/auth";
import { eq } from "drizzle-orm";

const setupDemoData = createServerFn({ method: "POST" }).handler(async () => {
  // Seed branches if empty
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

  // ---- superadmin ----
  try {
    await auth.api.signUpEmail({
      body: {
        email: "superadmin@omoiyari.net",
        password: "password123",
        name: "Super Admin",
        role: "super_admin",
        status: "Active",
      } as never,
    });
  } catch (err) {
    console.error("[setup] superadmin signUp failed:", err);
    // Already exists — update in case fields drifted
    await db
      .update(users)
      .set({ name: "Super Admin", role: "super_admin", status: "Active" })
      .where(eq(users.email, "superadmin@omoiyari.net"));
  }

  // ---- branch admin ----
  try {
    const sby01 = await db.query.branches.findFirst({
      where: (b, { eq }) => eq(b.code, "SBY-01"),
    });
    await auth.api.signUpEmail({
      body: {
        email: "branch@omoiyari.net",
        password: "password123",
        name: "Branch Admin Demo",
        role: "branch_admin",
        branchId: sby01?.id,
        status: "Active",
      } as never,
    });
  } catch (err) {
    console.error("[setup] branch admin signUp failed:", err);
    // Already exists — update in case fields drifted
    const sby01 = await db.query.branches.findFirst({
      where: (b, { eq }) => eq(b.code, "SBY-01"),
    });
    await db
      .update(users)
      .set({
        name: "Branch Admin Demo",
        role: "branch_admin",
        branchId: sby01?.id,
        status: "Active",
      })
      .where(eq(users.email, "branch@omoiyari.net"));
  }

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
