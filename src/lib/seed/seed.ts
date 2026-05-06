import { db } from "#/db/index";
import { eq, and } from "drizzle-orm";
import { auth } from "#/lib/auth";

import {
  branches as branchesTable,
  brands as brandsTable,
  suppliers as suppliersTable,
  users as usersTable,
  areaManagerBranches as areaManagerBranchesTable,
  ingredients as ingredientsTable,
  modifierGroups as modifierGroupsTable,
  modifiers as modifiersTable,
  modifierIngredients as modifierIngredientsTable,
  recipes as recipesTable,
  recipeBrands as recipeBrandsTable,
  recipeIngredients as recipeIngredientsTable,
  recipeModifierGroups as recipeModifierGroupsTable,
  recipeChildRecipes as recipeChildRecipesTable,
  platformFees as platformFeesTable,
  vouchers as vouchersTable,
  inventory as inventoryTable,
  shifts as shiftsTable,
  orders as ordersTable,
  orderItems as orderItemsTable,
  stockLedger as stockLedgerTable,
  supplierDeliveries as supplierDeliveriesTable,
  stockTransfers as stockTransfersTable,
  wasteEntries as wasteEntriesTable,
  systemLogs as systemLogsTable,
  appSettings as appSettingsTable,
} from "#/db/schema";

import {
  BRANCHES,
  BRANDS,
  SUPPLIERS,
  USERS_TO_CREATE,
  AREA_MANAGER_BRANCHES,
  INGREDIENTS,
  MODIFIER_GROUPS_DATA,
  RECIPES_DATA,
  ORDERS_DATA,
} from "./seed-data";
import type { IdMap } from "./index";
import { createIdMap } from "./index";

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

async function findExisting<T extends { id: string }>(
  table: any,
  field: any,
  value: string,
): Promise<T | undefined> {
  const rows = await db.select().from(table).where(eq(field, value)).limit(1);
  return rows[0] as T | undefined;
}

async function createUserViaAuth(
  email: string,
  password: string,
  name: string,
  role: string,
  branchCode?: string,
  branchIdMap?: IdMap["branch"],
  pin?: string,
) {
  try {
    const body: any = { email, password, name, role, status: "Active" };
    if (branchCode && branchIdMap) {
      body.branchId = branchIdMap.get(branchCode);
    }
    if (pin) {
      body.pin = pin;
    }
    await auth.api.signUpEmail({ body: body as never });
  } catch {
    // Already exists — update fields
    const updateData: any = { name, role, status: "Active" };
    if (branchCode && branchIdMap) {
      updateData.branchId = branchIdMap.get(branchCode);
    }
    if (pin) {
      updateData.pin = pin;
    }
    await db.update(usersTable).set(updateData).where(eq(usersTable.email, email));
  }
}

async function getUserIdByEmail(email: string): Promise<string> {
  const user = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  return user[0]!.id;
}

// ──────────────────────────────────────────
// Seed: Branches
// ──────────────────────────────────────────

export async function seedBranches(idMap: IdMap) {
  for (const b of BRANCHES) {
    const existing = await findExisting<{ id: string }>(branchesTable, branchesTable.code, b.code);
    if (existing) {
      idMap.branch.set(b.protoId, existing.id);
    } else {
      const [inserted] = await db
        .insert(branchesTable)
        .values({
          code: b.code,
          name: b.name,
          location: b.location,
          type: b.type,
          active: b.active,
          isOnline: b.isOnline,
        })
        .returning({ id: branchesTable.id });
      idMap.branch.set(b.protoId, inserted.id);
    }
  }
}

// ──────────────────────────────────────────
// Seed: Brands
// ──────────────────────────────────────────

export async function seedBrands(idMap: IdMap) {
  for (const b of BRANDS) {
    const existing = await findExisting<{ id: string }>(brandsTable, brandsTable.code, b.code);
    if (existing) {
      idMap.brand.set(b.code, existing.id);
    } else {
      const [inserted] = await db
        .insert(brandsTable)
        .values({ code: b.code, name: b.name })
        .returning({ id: brandsTable.id });
      idMap.brand.set(b.code, inserted.id);
    }
  }
}

// ──────────────────────────────────────────
// Seed: Suppliers
// ──────────────────────────────────────────

export async function seedSuppliers(idMap: IdMap) {
  for (const s of SUPPLIERS) {
    const existing = await findExisting<{ id: string }>(
      suppliersTable,
      suppliersTable.code,
      s.code,
    );
    if (existing) {
      idMap.supplier.set(s.code, existing.id);
    } else {
      const [inserted] = await db
        .insert(suppliersTable)
        .values({ code: s.code, name: s.name, contactPerson: s.contactPerson, phone: s.phone })
        .returning({ id: suppliersTable.id });
      idMap.supplier.set(s.code, inserted.id);
    }
  }
}

// ──────────────────────────────────────────
// Seed: Users
// ──────────────────────────────────────────

export async function seedUsers(idMap: IdMap) {
  for (const u of USERS_TO_CREATE) {
    await createUserViaAuth(u.email, u.password, u.name, u.role, u.branchCode, idMap.branch, u.pin);
    const userId = await getUserIdByEmail(u.email);
    idMap.user.set(u.email, userId);
  }

  // Area manager branches
  const areaUser = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, "manager.east@omoiyari.net"))
    .limit(1);
  if (areaUser[0]) {
    for (const bc of AREA_MANAGER_BRANCHES) {
      const branchId = idMap.branch.get(bc);
      if (!branchId) continue;
      const existing = await db
        .select()
        .from(areaManagerBranchesTable)
        .where(
          and(
            eq(areaManagerBranchesTable.userId, areaUser[0].id),
            eq(areaManagerBranchesTable.branchId, branchId),
          ),
        )
        .limit(1);
      if (!existing[0]) {
        await db.insert(areaManagerBranchesTable).values({ userId: areaUser[0].id, branchId });
      }
    }
  }
}

// ──────────────────────────────────────────
// Seed: Ingredients
// ──────────────────────────────────────────

export async function seedIngredients(idMap: IdMap) {
  for (const ing of INGREDIENTS) {
    const existing = await findExisting<{ id: string }>(
      ingredientsTable,
      ingredientsTable.code,
      ing.code,
    );
    if (existing) {
      idMap.ingredient.set(ing.protoId, existing.id);
    } else {
      const [inserted] = await db
        .insert(ingredientsTable)
        .values({
          code: ing.code,
          name: ing.name,
          category: ing.category,
          skuType: ing.skuType,
          purchaseUnit: ing.purchaseUnit,
          stockUnit: ing.stockUnit,
          conversionFactor: ing.conversionFactor,
          averageCost: ing.averageCost,
          rop: ing.rop,
          moq: ing.moq,
          countable: ing.countable,
        })
        .returning({ id: ingredientsTable.id });
      idMap.ingredient.set(ing.protoId, inserted.id);
    }
  }
}

// ──────────────────────────────────────────
// Seed: Modifier Groups + Modifiers + Modifier Ingredients
// ──────────────────────────────────────────

export async function seedModifiers(idMap: IdMap) {
  for (const mg of MODIFIER_GROUPS_DATA) {
    let mgId = idMap.modifierGroup.get(mg.protoId);
    if (!mgId) {
      const existing = await findExisting<{ id: string }>(
        modifierGroupsTable,
        modifierGroupsTable.code,
        mg.code,
      );
      if (existing) {
        mgId = existing.id;
        idMap.modifierGroup.set(mg.protoId, mgId);
      } else {
        const [inserted] = await db
          .insert(modifierGroupsTable)
          .values({
            code: mg.code,
            name: mg.name,
            minSelection: mg.minSelection,
            maxSelection: mg.maxSelection,
          })
          .returning({ id: modifierGroupsTable.id });
        mgId = inserted.id;
        idMap.modifierGroup.set(mg.protoId, mgId);
      }
    }

    for (const mod of mg.modifiers) {
      let modId = idMap.modifier.get(mod.protoId);
      if (!modId) {
        const existing = await findExisting<{ id: string }>(
          modifiersTable,
          modifiersTable.code,
          mod.code,
        );
        if (existing) {
          modId = existing.id;
          idMap.modifier.set(mod.protoId, modId);
        } else {
          const [inserted] = await db
            .insert(modifiersTable)
            .values({
              code: mod.code,
              name: mod.name,
              price: mod.price,
              modifierGroupId: mgId,
              isExclusion: mod.isExclusion,
            })
            .returning({ id: modifiersTable.id });
          modId = inserted.id;
          idMap.modifier.set(mod.protoId, modId);
        }
      }

      // Modifier ingredients
      if ("ingredients" in mod && mod.ingredients) {
        for (const mi of mod.ingredients) {
          const ingId = idMap.ingredient.get(mi.ingredientProtoId);
          if (!ingId) continue;
          const existingMi = await db
            .select()
            .from(modifierIngredientsTable)
            .where(
              and(
                eq(modifierIngredientsTable.modifierId, modId),
                eq(modifierIngredientsTable.ingredientId, ingId),
              ),
            )
            .limit(1);
          if (!existingMi[0]) {
            await db
              .insert(modifierIngredientsTable)
              .values({ modifierId: modId, ingredientId: ingId, quantity: mi.quantity });
          }
        }
      }
    }
  }
}

// ──────────────────────────────────────────
// Seed: Recipes (Pass 1 — tables, brands, ingredients, modifier groups)
// ──────────────────────────────────────────

export async function seedRecipesPass1(idMap: IdMap) {
  // Remap modifier proto IDs to DB IDs for recipeModifierGroups
  // We need to do this after mods are seeded

  for (const r of RECIPES_DATA) {
    let recId = idMap.recipe.get(r.protoId);
    if (!recId) {
      const existing = await findExisting<{ id: string }>(recipesTable, recipesTable.code, r.code);
      if (existing) {
        recId = existing.id;
        idMap.recipe.set(r.protoId, recId);
      } else {
        const [inserted] = await db
          .insert(recipesTable)
          .values({
            code: r.code,
            name: r.name,
            category: r.category,
            isSubRecipe: r.isSubRecipe,
            basePrice: r.basePrice,
            isBOGO: r.isBOGO,
          })
          .returning({ id: recipesTable.id });
        recId = inserted.id;
        idMap.recipe.set(r.protoId, recId);
      }
    }

    // Recipe brands
    for (const bpId of (r as any).brandProtoIds || []) {
      const brandId = idMap.brand.get(bpId);
      if (!brandId) continue;
      const existingRb = await db
        .select()
        .from(recipeBrandsTable)
        .where(and(eq(recipeBrandsTable.recipeId, recId), eq(recipeBrandsTable.brandId, brandId)))
        .limit(1);
      if (!existingRb[0]) {
        await db.insert(recipeBrandsTable).values({ recipeId: recId, brandId });
      }
    }

    // Recipe ingredients
    for (const ri of r.ingredients) {
      const ingId = idMap.ingredient.get(ri.ingredientProtoId);
      if (!ingId) continue;
      const existingRi = await db
        .select()
        .from(recipeIngredientsTable)
        .where(
          and(
            eq(recipeIngredientsTable.recipeId, recId),
            eq(recipeIngredientsTable.ingredientId, ingId),
          ),
        )
        .limit(1);
      if (!existingRi[0]) {
        await db
          .insert(recipeIngredientsTable)
          .values({ recipeId: recId, ingredientId: ingId, quantity: ri.quantity });
      }
    }

    // Recipe modifier groups
    if ("modifierGroupProtoIds" in r && r.modifierGroupProtoIds) {
      for (const mgpId of r.modifierGroupProtoIds) {
        const mgId = idMap.modifierGroup.get(mgpId);
        if (!mgId) continue;
        const existingRmg = await db
          .select()
          .from(recipeModifierGroupsTable)
          .where(
            and(
              eq(recipeModifierGroupsTable.recipeId, recId),
              eq(recipeModifierGroupsTable.modifierGroupId, mgId),
            ),
          )
          .limit(1);
        if (!existingRmg[0]) {
          await db
            .insert(recipeModifierGroupsTable)
            .values({ recipeId: recId, modifierGroupId: mgId });
        }
      }
    }
  }

  // Pass 2: Recipe child recipes
  for (const r of RECIPES_DATA) {
    if (!("childRecipes" in r) || !r.childRecipes) continue;
    const parentId = idMap.recipe.get(r.protoId);
    if (!parentId) continue;
    for (const cr of r.childRecipes) {
      const childId = idMap.recipe.get(cr.recipeProtoId);
      if (!childId) continue;
      const existingCr = await db
        .select()
        .from(recipeChildRecipesTable)
        .where(
          and(
            eq(recipeChildRecipesTable.parentRecipeId, parentId),
            eq(recipeChildRecipesTable.childRecipeId, childId),
          ),
        )
        .limit(1);
      if (!existingCr[0]) {
        await db
          .insert(recipeChildRecipesTable)
          .values({ parentRecipeId: parentId, childRecipeId: childId, quantity: cr.quantity });
      }
    }
  }
}

// ──────────────────────────────────────────
// Seed: Platform Fees
// ──────────────────────────────────────────

export async function seedPlatformFees() {
  const channels: Array<{
    channel: "Gofood" | "Grabfood" | "ShopeeFood" | "Dine-in";
    feePercentage: number;
    fixedFee: number;
  }> = [
    { channel: "Gofood", feePercentage: 20, fixedFee: 0 },
    { channel: "Grabfood", feePercentage: 20, fixedFee: 0 },
    { channel: "ShopeeFood", feePercentage: 20, fixedFee: 0 },
    { channel: "Dine-in", feePercentage: 0, fixedFee: 0 },
  ];
  for (const pf of channels) {
    const existing = await db
      .select()
      .from(platformFeesTable)
      .where(eq(platformFeesTable.channel, pf.channel))
      .limit(1);
    if (!existing[0]) {
      await db.insert(platformFeesTable).values(pf);
    }
  }
}

// ──────────────────────────────────────────
// Seed: Vouchers
// ──────────────────────────────────────────

export async function seedVouchers(idMap: IdMap) {
  const adminId = idMap.user.get("superadmin@omoiyari.net");
  if (!adminId) return;
  const vouchers = [
    {
      code: "PROMO10",
      description: "Diskon 10% untuk semua menu",
      discountType: "percentage" as const,
      discountValue: 10,
      minOrder: 50000,
      validUntil: new Date("2026-12-31"),
      createdBy: adminId,
    },
    {
      code: "FREESHIP",
      description: "Gratis ongkir minimal 100rb",
      discountType: "fixed" as const,
      discountValue: 20000,
      minOrder: 100000,
      validUntil: new Date("2026-12-31"),
      createdBy: adminId,
    },
  ];
  for (const v of vouchers) {
    const existing = await db
      .select()
      .from(vouchersTable)
      .where(eq(vouchersTable.code, v.code))
      .limit(1);
    if (!existing[0]) {
      await db.insert(vouchersTable).values(v);
    }
  }
}

// ──────────────────────────────────────────
// Seed: Inventory
// ──────────────────────────────────────────

export async function seedInventory(idMap: IdMap) {
  // Create inventory for key ingredients in major branches
  const branchesToSeed = ["SBY-01", "SBY-02", "SBY-03", "SBY-04"];
  const ingredientProtoIds = [
    "ing-01",
    "ing-02",
    "ing-03",
    "ing-04",
    "ing-05",
    "ing-07",
    "ing-12",
    "ing-sfg-01",
    "ing-sfg-02",
    "ing-sfg-03",
    "ing-16",
    "ing-17",
    "ing-18",
    "ing-20",
  ];
  const baseQty: Record<string, number> = {
    "ing-01": 50000,
    "ing-02": 10000,
    "ing-03": 5000,
    "ing-04": 25000,
    "ing-05": 25000,
    "ing-07": 300,
    "ing-12": 20000,
    "ing-sfg-01": 30000,
    "ing-sfg-02": 10000,
    "ing-sfg-03": 5000,
    "ing-16": 500,
    "ing-17": 1000,
    "ing-18": 500,
    "ing-20": 500,
  };
  for (const bc of branchesToSeed) {
    const bid = idMap.branch.get(bc);
    if (!bid) continue;
    for (const ipid of ingredientProtoIds) {
      const iid = idMap.ingredient.get(ipid);
      if (!iid) continue;
      const existing = await db
        .select()
        .from(inventoryTable)
        .where(and(eq(inventoryTable.branchId, bid), eq(inventoryTable.ingredientId, iid)))
        .limit(1);
      if (!existing[0]) {
        await db
          .insert(inventoryTable)
          .values({ branchId: bid, ingredientId: iid, quantity: baseQty[ipid] || 1000 });
      }
    }
  }
}

// ──────────────────────────────────────────
// Seed: Shifts
// ──────────────────────────────────────────

export async function seedShifts(idMap: IdMap) {
  const hansId = idMap.user.get("hans@omoiyari.net");
  const sb01 = idMap.branch.get("SBY-01");
  if (!hansId || !sb01) return;
  const existing = await db
    .select()
    .from(shiftsTable)
    .where(eq(shiftsTable.userId, hansId))
    .limit(1);
  if (!existing[0]) {
    await db.insert(shiftsTable).values({
      branchId: sb01,
      userId: hansId,
      startTime: new Date("2026-05-01T08:00:00Z"),
      cashFloat: 500000,
      status: "Open",
      notes: "Shift demo",
    });
  }
}

// ──────────────────────────────────────────
// Seed: Orders
// ──────────────────────────────────────────

export async function seedOrders(idMap: IdMap, _allSuccess: boolean) {
  for (const o of ORDERS_DATA) {
    const bid = idMap.branch.get(o.branchCode);
    if (!bid) continue;
    const brandId = idMap.brand.get("BRAND-1");
    if (!brandId) continue;

    const orderCodeVal = o.status === "New" ? undefined : o.orderCode;

    const existingOrder = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.orderCode, orderCodeVal || ""))
      .limit(1);

    if (existingOrder[0]) continue;

    const [insertedOrder] = await db
      .insert(ordersTable)
      .values({
        branchId: bid,
        channel: o.channel,
        subtotal: o.subtotal,
        merchantDiscount: o.merchantDiscount,
        platformDiscount: o.platformDiscount,
        taxAmount: o.taxAmount,
        totalAmount: o.totalAmount,
        totalCogs: o.totalCogs,
        mdrFee: o.mdrFee,
        netSales: o.netSales,
        orderCode: orderCodeVal,
        status: o.status,
        createdAt: o.createdAt,
      })
      .returning({ id: ordersTable.id });

    for (const item of o.items) {
      const recipeId = idMap.recipe.get(item.recipeProtoId);
      if (!recipeId) continue;

      await db.insert(orderItemsTable).values({
        orderId: insertedOrder.id,
        recipeId,
        brandId,
        quantity: item.quantity,
        price: item.price,
        cogsAtTransaction: item.cogsAtTransaction,
      });
    }
  }
}

// ──────────────────────────────────────────
// Seed: Stock Ledger
// ──────────────────────────────────────────

export async function seedStockLedger(idMap: IdMap) {
  const branches = ["SBY-01"];
  const entries = [
    { ing: "ing-01", qty: 5000, day: 1, ref: "POS-001" },
    { ing: "ing-01", qty: 4800, day: 2, ref: "POS-002" },
    { ing: "ing-01", qty: 5200, day: 3, ref: "POS-003" },
    { ing: "ing-01", qty: 5000, day: 4, ref: "POS-004" },
    { ing: "ing-01", qty: 5000, day: 5, ref: "POS-005" },
    { ing: "ing-02", qty: 2000, day: 1, ref: "POS-001" },
    { ing: "ing-02", qty: 2100, day: 2, ref: "POS-002" },
    { ing: "ing-02", qty: 1900, day: 3, ref: "POS-003" },
    { ing: "ing-02", qty: 2000, day: 4, ref: "POS-004" },
    { ing: "ing-02", qty: 2000, day: 5, ref: "POS-005" },
  ];
  let balanceAccum: Record<string, number> = {};
  for (const branchCode of branches) {
    const bid = idMap.branch.get(branchCode);
    if (!bid) continue;
    balanceAccum = {};
    for (const e of entries) {
      const iid = idMap.ingredient.get(e.ing);
      if (!iid) continue;
      balanceAccum[e.ing] = (balanceAccum[e.ing] || 50000) - e.qty;
      const createdAt = new Date(Date.now() - e.day * 86400000);
      const existing = await db
        .select()
        .from(stockLedgerTable)
        .where(
          and(
            eq(stockLedgerTable.branchId, bid),
            eq(stockLedgerTable.ingredientId, iid),
            eq(stockLedgerTable.reference, e.ref),
          ),
        )
        .limit(1);
      if (!existing[0]) {
        await db.insert(stockLedgerTable).values({
          branchId: bid,
          ingredientId: iid,
          type: "OUT",
          quantity: e.qty,
          balance: balanceAccum[e.ing],
          reference: e.ref,
          notes: "Penjualan Daily",
          createdAt,
        });
      }
    }
  }
}

// ──────────────────────────────────────────
// Seed: Stock Transfers
// ──────────────────────────────────────────

export async function seedStockTransfers(idMap: IdMap) {
  const transfersData = [
    {
      protoId: "tr-001",
      code: "TR-001",
      from: "br-central",
      to: "br-sub-01",
      ing: "ing-01",
      qty: 50000,
      status: "Completed" as const,
      requestedByEmail: "superadmin@omoiyari.net",
    },
    {
      protoId: "tr-002",
      code: "TR-002",
      from: "br-central",
      to: "br-sub-02",
      ing: "ing-02",
      qty: 20000,
      status: "Completed" as const,
      requestedByEmail: "hans@omoiyari.net",
    },
    {
      protoId: "tr-003",
      code: "TR-003",
      from: "br-central",
      to: "br-sub-03",
      ing: "ing-03",
      qty: 10000,
      status: "Completed" as const,
      requestedByEmail: "hans@omoiyari.net",
    },
    {
      protoId: "tr-004",
      code: "TR-004",
      from: "br-central",
      to: "br-sub-04",
      ing: "ing-04",
      qty: 5000,
      status: "In Transit" as const,
      requestedByEmail: "hans@omoiyari.net",
    },
    {
      protoId: "tr-005",
      code: "TR-005",
      from: "br-central",
      to: "br-mlg-01",
      ing: "ing-01",
      qty: 25000,
      status: "Pending Approval" as const,
      requestedByEmail: "hans@omoiyari.net",
    },
  ];
  for (const t of transfersData) {
    const fromBid = idMap.branch.get(t.from);
    const toBid = idMap.branch.get(t.to);
    const iid = idMap.ingredient.get(t.ing);
    const reqUid = idMap.user.get(t.requestedByEmail);
    if (!fromBid || !toBid || !iid || !reqUid) continue;
    const existing = await db
      .select()
      .from(stockTransfersTable)
      .where(eq(stockTransfersTable.code, t.code))
      .limit(1);
    if (!existing[0]) {
      await db.insert(stockTransfersTable).values({
        code: t.code,
        fromBranchId: fromBid,
        toBranchId: toBid,
        ingredientId: iid,
        quantity: t.qty,
        status: t.status,
        requestedBy: reqUid,
        createdAt: new Date(Date.now() - transfersData.indexOf(t) * 86400000),
      });
    }
  }
}

// ──────────────────────────────────────────
// Seed: Supplier Deliveries
// ──────────────────────────────────────────

export async function seedSupplierDeliveries(idMap: IdMap) {
  const adminId = idMap.user.get("superadmin@omoiyari.net");
  if (!adminId) return;
  const deliveries = [
    {
      supCode: "SUP-001",
      ing: "ing-01",
      qty: 500000,
      price: 7000000,
      day: 5,
      supName: "PT Beras Makmur",
    },
    {
      supCode: "SUP-002",
      ing: "ing-02",
      qty: 50000,
      price: 2250000,
      day: 4,
      supName: "CV Ayam Segar",
    },
    {
      supCode: "SUP-003",
      ing: "ing-03",
      qty: 30000,
      price: 3450000,
      day: 3,
      supName: "Importir Sapi Jaya",
    },
    {
      supCode: "SUP-004",
      ing: "ing-04",
      qty: 25000,
      price: 600000,
      day: 2,
      supName: "PT Saus Nusantara",
    },
    {
      supCode: "SUP-004",
      ing: "ing-05",
      qty: 25000,
      price: 675000,
      day: 1,
      supName: "PT Saus Nusantara",
    },
  ];
  for (const d of deliveries) {
    const iid = idMap.ingredient.get(d.ing);
    const supId = idMap.supplier.get(d.supCode);
    if (!iid) continue;
    const existing = await db
      .select()
      .from(supplierDeliveriesTable)
      .where(
        and(
          eq(supplierDeliveriesTable.supplierName, d.supName),
          eq(supplierDeliveriesTable.ingredientId, iid),
          eq(supplierDeliveriesTable.quantity, d.qty),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      await db.insert(supplierDeliveriesTable).values({
        supplierId: supId || null,
        supplierName: d.supName,
        ingredientId: iid,
        quantity: d.qty,
        price: d.price,
        deliveryDate: new Date(Date.now() - d.day * 86400000),
        receivedBy: adminId,
        status: "Completed",
      });
    }
  }
}

// ──────────────────────────────────────────
// Seed: Waste Entries
// ──────────────────────────────────────────

export async function seedWasteEntries(idMap: IdMap) {
  const hansId = idMap.user.get("hans@omoiyari.net");
  const sb01 = idMap.branch.get("SBY-01");
  const ing02 = idMap.ingredient.get("ing-02");
  if (!hansId || !sb01 || !ing02) return;
  const existing = await db
    .select()
    .from(wasteEntriesTable)
    .where(and(eq(wasteEntriesTable.branchId, sb01), eq(wasteEntriesTable.ingredientId, ing02)))
    .limit(1);
  if (!existing[0]) {
    await db.insert(wasteEntriesTable).values({
      branchId: sb01,
      ingredientId: ing02,
      quantity: 500,
      category: "Spoiled",
      notes: "Kedaluwarsa",
      submittedBy: hansId,
      createdAt: new Date(Date.now() - 2 * 86400000),
    });
  }
}

// ──────────────────────────────────────────
// Seed: System Logs
// ──────────────────────────────────────────

export async function seedSystemLogs() {
  const logs = [
    {
      action: "Reset Database",
      detail: "Super Admin mereset seluruh data ke kondisi awal",
      userName: "Super Admin",
      status: "Success" as const,
    },
    {
      action: "Pembaruan Resep",
      detail: "Resep Chicken Teriyaki Bowl diperbarui harganya",
      userName: "Super Admin",
      status: "Success" as const,
    },
    {
      action: "Penambahan Cabang",
      detail: "Cabang baru Omoiyari Malang ditambahkan",
      userName: "Super Admin",
      status: "Success" as const,
    },
    {
      action: "Penerimaan Barang",
      detail: "Penerimaan Beras Premium 500kg dari PT Beras Makmur",
      userName: "Super Admin",
      status: "Success" as const,
    },
    {
      action: "Gagal Login",
      detail: "Percobaan login gagal dengan email tidak dikenal",
      userName: "unknown",
      status: "Warning" as const,
    },
    {
      action: "Buka Periode",
      detail: "Periode April 2026 dibuka oleh Super Admin",
      userName: "Super Admin",
      status: "Success" as const,
    },
    {
      action: "Tutup Periode",
      detail: "Periode Maret 2026 ditutup oleh Super Admin",
      userName: "Super Admin",
      status: "Success" as const,
    },
    {
      action: "Penyesuaian Stok",
      detail: "Stock Opname br-sub-01 disetujui",
      userName: "Super Admin",
      status: "Success" as const,
    },
    {
      action: "Transfer Stok",
      detail: "Transfer 50kg Beras ke br-sub-01 selesai",
      userName: "Super Admin",
      status: "Success" as const,
    },
    {
      action: "Input Pendapatan",
      detail: "Pendapatan manual br-sub-01 diinput",
      userName: "Hans",
      status: "Success" as const,
    },
  ];
  for (const l of logs) {
    const existing = await db
      .select()
      .from(systemLogsTable)
      .where(and(eq(systemLogsTable.action, l.action), eq(systemLogsTable.detail, l.detail)))
      .limit(1);
    if (!existing[0]) {
      await db.insert(systemLogsTable).values(l);
    }
  }
}

// ──────────────────────────────────────────
// Seed: App Settings
// ──────────────────────────────────────────

export async function seedAppSettings(idMap: IdMap) {
  const adminId = idMap.user.get("superadmin@omoiyari.net");
  const settings = [
    { key: "store_name", value: "Omoiyari Japanese Restaurant", description: "Nama toko" },
    { key: "store_address", value: "Tegalsari, Surabaya", description: "Alamat toko" },
    { key: "tax_rate", value: "10", description: "Pajak (%)" },
    { key: "currency", value: "IDR", description: "Mata uang" },
  ];
  for (const s of settings) {
    const existing = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, s.key))
      .limit(1);
    if (!existing[0]) {
      await db.insert(appSettingsTable).values({ ...s, updatedBy: adminId || null });
    }
  }
}

// ──────────────────────────────────────────
// Main orchestrator
// ──────────────────────────────────────────

export async function seedAll(allSuccess = true) {
  const idMap = createIdMap();

  // Step 1: Branches
  console.log("[seed] Seeding branches...");
  await seedBranches(idMap);

  // Step 2: Brands
  console.log("[seed] Seeding brands...");
  await seedBrands(idMap);

  // Step 3: Suppliers
  console.log("[seed] Seeding suppliers...");
  await seedSuppliers(idMap);

  // Step 4: Users
  console.log("[seed] Seeding users...");
  await seedUsers(idMap);

  // Step 5: Ingredients
  console.log("[seed] Seeding ingredients...");
  await seedIngredients(idMap);

  // Step 6: Modifier groups + modifiers
  console.log("[seed] Seeding modifier groups & modifiers...");
  await seedModifiers(idMap);

  // Step 7: Recipes (Pass 1) + recipe joins
  console.log("[seed] Seeding recipes...");
  await seedRecipesPass1(idMap);

  // Step 8: Platform fees
  console.log("[seed] Seeding platform fees...");
  await seedPlatformFees();

  // Step 9: Vouchers
  console.log("[seed] Seeding vouchers...");
  await seedVouchers(idMap);

  // Step 10: Inventory
  console.log("[seed] Seeding inventory...");
  await seedInventory(idMap);

  // Step 11: Shifts
  console.log("[seed] Seeding shifts...");
  await seedShifts(idMap);

  // Step 12: Orders
  console.log("[seed] Seeding orders...");
  await seedOrders(idMap, allSuccess);

  // Step 13: Stock ledger
  console.log("[seed] Seeding stock ledger...");
  await seedStockLedger(idMap);

  // Step 14: Stock transfers
  console.log("[seed] Seeding stock transfers...");
  await seedStockTransfers(idMap);

  // Step 15: Supplier deliveries
  console.log("[seed] Seeding supplier deliveries...");
  await seedSupplierDeliveries(idMap);

  // Step 16: Waste entries
  console.log("[seed] Seeding waste entries...");
  await seedWasteEntries(idMap);

  // Step 17: System logs
  console.log("[seed] Seeding system logs...");
  await seedSystemLogs();

  // Step 18: App settings
  console.log("[seed] Seeding app settings...");
  await seedAppSettings(idMap);

  console.log("[seed] Done!");
  return { success: true, message: "All data seeded" };
}
