/**
 * Seed data for the new SCM procurement lifecycle (ADR 0002).
 *
 * Creates 3 procurements in different states so you can immediately click
 * through the new UI and see how each state renders:
 *
 *  1. PR/<branch>/<date>/01 — Draft (just created, BA can edit/submit)
 *  2. PR/<branch>/<date>/02 — UnderReview (CA can review)
 *  3. PR/<branch>/<date>/03 — Finished (full flow, "Lunas")
 *
 * Run with: pnpm tsx src/lib/seed/scm-procurements-seed.ts
 *
 * Requires:
 *  - DATABASE_URL set
 *  - At least one Central branch and one Outlet branch in `branches`
 *  - At least one user per role: branch_admin, admin_pusat
 *  - At least a few ingredients in `ingredients`
 */
import { db } from "../server/db";
import { branches, ingredients, users, scmProcurements, scmProcurementItems } from "#/db/schema";
import { eq } from "drizzle-orm";
import { transition, updateItem } from "../server/scm-fsm";

async function pickBranch(type: "Central" | "Outlet") {
  const [branch] = await db.select().from(branches).where(eq(branches.type, type)).limit(1);
  if (!branch) throw new Error(`No ${type} branch found. Run npm run db:seed first.`);
  return branch;
}

async function pickUserByRole(role: string) {
  // SAFETY: roles passed in come from the seed data, which only uses the five
  // literal roles in the users table enum; eq() accepts the narrowed union.
  const [u] = await db
    .select()
    .from(users)
    .where(
      eq(
        users.role,
        role as "branch_admin" | "admin_pusat" | "super_admin" | "area_manager" | "central_kitchen",
      ),
    )
    .limit(1);
  if (!u) throw new Error(`No user with role ${role} found. Run npm run db:seed first.`);
  return u;
}

async function pickIngredients(n: number) {
  const rows = await db.select().from(ingredients).limit(n);
  if (rows.length < n)
    throw new Error(`Need at least ${n} ingredients in DB. Found ${rows.length}.`);
  return rows;
}

async function main() {
  console.log("Seeding SCM procurements (ADR 0002)...");

  const outlet = await pickBranch("Outlet");
  const central = await pickBranch("Central");
  const ba = await pickUserByRole("branch_admin");
  const ca = await pickUserByRole("admin_pusat");
  const superAdmin = await pickUserByRole("super_admin");
  const ings = await pickIngredients(5);
  const actor = (user: typeof ba) => ({ id: user.id, role: user.role });

  // Document codes use format: PR/<branch_code>/ddmmyy/serial
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear()).slice(-2);
  const dateStr = `${day}${month}${year}`;
  const bc = outlet.code; // branch code for the outlet

  // -----------------------------------------------------------------------
  // 1. Draft
  // -----------------------------------------------------------------------
  console.log("\n[1/3] Creating Draft procurement...");
  const [draft] = await db
    .insert(scmProcurements)
    .values({
      code: `PR/${bc}/${dateStr}/01`,
      branchId: outlet.id,
      status: "Draft",
      requestedById: ba.id,
      notes: "Draft untuk testing — silakan submit lewat UI.",
    })
    .returning();
  if (!draft) throw new Error("Failed to insert draft");
  await db.insert(scmProcurementItems).values(
    ings.slice(0, 3).map((it, idx) => ({
      scmProcurementId: draft.id,
      ingredientId: it.id,
      quantity: 10 + idx * 5,
      sortOrder: idx,
      unitPrice: it.averageCost,
    })),
  );
  console.log(`  -> ${draft.code} (status: ${draft.status})`);

  // -----------------------------------------------------------------------
  // 2. UnderReview
  // -----------------------------------------------------------------------
  console.log("\n[2/3] Creating UnderReview procurement...");
  const [underReview] = await db
    .insert(scmProcurements)
    .values({
      code: `PR/${bc}/${dateStr}/02`,
      branchId: outlet.id,
      status: "Draft",
      requestedById: ba.id,
      notes: "UnderReview untuk testing — CA bisa approve/reject lewat UI.",
    })
    .returning();
  if (!underReview) throw new Error("Failed to insert underReview");
  await db.insert(scmProcurementItems).values(
    ings.slice(0, 4).map((it, idx) => ({
      scmProcurementId: underReview.id,
      ingredientId: it.id,
      quantity: 5 + idx * 3,
      sortOrder: idx,
      unitPrice: it.averageCost,
    })),
  );
  await transition(underReview.id, "submit", {}, actor(ba));
  await transition(underReview.id, "open-review", {}, actor(ca));
  console.log(`  -> ${underReview.code} (status: UnderReview, reviewer: ${ca.name})`);

  // -----------------------------------------------------------------------
  // 3. Finished (full flow)
  // -----------------------------------------------------------------------
  console.log("\n[3/3] Creating Finished procurement (full flow)...");
  const [finished] = await db
    .insert(scmProcurements)
    .values({
      code: `PR/${bc}/${dateStr}/03`,
      branchId: outlet.id,
      status: "Draft",
      requestedById: ba.id,
      notes: "Full flow untuk testing — invoice lunas.",
    })
    .returning();
  if (!finished) throw new Error("Failed to insert finished");
  await db.insert(scmProcurementItems).values(
    ings.map((it, idx) => ({
      scmProcurementId: finished.id,
      ingredientId: it.id,
      quantity: 20 + idx * 5,
      sortOrder: idx,
      unitPrice: it.averageCost,
    })),
  );
  await transition(finished.id, "submit", {}, actor(ba));
  await transition(finished.id, "open-review", {}, actor(ca));
  // CA approves all items, sets readyQuantity
  const items = await db
    .select()
    .from(scmProcurementItems)
    .where(eq(scmProcurementItems.scmProcurementId, finished.id));
  for (const it of items) {
    await updateItem(
      finished.id,
      it.id,
      { caDecision: "approved", readyQuantity: it.quantity },
      actor(ca),
    );
  }
  // Accept and ship (decrements Central inventory, writes in_transit)
  await transition(finished.id, "accept-and-ship", {}, actor(ca));
  // Mark delivered (moves to pending_review) — BA confirms receipt at the branch
  await transition(finished.id, "mark-delivered", {}, actor(ba));
  // BA opens receive
  await transition(finished.id, "open-receive", {}, actor(ba));
  // BA fills received/rejected qty
  const itemsAfterShip = await db
    .select()
    .from(scmProcurementItems)
    .where(eq(scmProcurementItems.scmProcurementId, finished.id));
  for (let i = 0; i < itemsAfterShip.length; i++) {
    const it = itemsAfterShip[i];
    const shipQty = it.pickedQuantity ?? 0;
    // Reject 1 of every 10 units to simulate damage
    const rejected = Math.floor(shipQty / 10);
    const received = shipQty - rejected;
    await updateItem(
      finished.id,
      it.id,
      {
        receivedQuantity: received,
        rejectedQuantity: rejected,
        reason: rejected > 0 ? "Sebagian rusak saat pengiriman" : undefined,
      },
      actor(ba),
    );
  }
  // BA finishes receive
  await transition(
    finished.id,
    "finish-receive",
    {
      items: itemsAfterShip.map((it) => ({
        id: it.id,
        receivedQuantity: it.receivedQuantity ?? 0,
        rejectedQuantity: it.rejectedQuantity ?? 0,
        reason: it.reason ?? undefined,
      })),
    },
    actor(ba),
  );
  // CA marks paid
  await transition(finished.id, "mark-paid", {}, actor(ca));
  console.log(`  -> ${finished.code} (status: Finished, lunas)`);

  // -----------------------------------------------------------------------
  // Suppress unused warning
  // -----------------------------------------------------------------------
  void central;
  void superAdmin;

  console.log("\nDone. Open http://localhost:3000/scm-procurements");
  console.log(`  - PR/${bc}/${dateStr}/01: Draft (BA submits)`);
  console.log(`  - PR/${bc}/${dateStr}/02: UnderReview (CA reviews)`);
  console.log(`  - PR/${bc}/${dateStr}/03: Finished (lunas, dengan rejected qty)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
