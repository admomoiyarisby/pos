import { db } from "#/lib/server/db";
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
  recipeModifierExclusions as recipeModifierExclusionsTable,
  purchaseRequisitions as purchaseRequisitionsTable,
  purchaseRequisitionItems as purchaseRequisitionItemsTable,
  purchaseOrders as purchaseOrdersTable,
  purchaseOrderItems as purchaseOrderItemsTable,
  deliveryNotes as deliveryNotesTable,
  deliveryNoteItems as deliveryNoteItemsTable,
  scmInvoices as scmInvoicesTable,
  stockOpnames as stockOpnamesTable,
  stockOpnameItems as stockOpnameItemsTable,
  periodLogs as periodLogsTable,
  systemNotifications as systemNotificationsTable,
  cancelRequests as cancelRequestsTable,
  printRequests as printRequestsTable,
  manualRevenues as manualRevenuesTable,
  channelRevenues as channelRevenuesTable,
  yieldConversions as yieldConversionsTable,
  operationalExpenses as operationalExpensesTable,
  inTransitInventory as inTransitInventoryTable,
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
  RECIPE_MODIFIER_EXCLUSIONS,
  PURCHASE_REQUISITIONS_DATA,
  PURCHASE_ORDERS_DATA,
  DELIVERY_NOTES_DATA,
  SCM_INVOICES_DATA,
  STOCK_OPNAME_DATA,
  PERIOD_LOGS_DATA,
  SYSTEM_NOTIFICATIONS_DATA,
  CANCEL_REQUESTS_DATA,
  PRINT_REQUESTS_DATA,
  MANUAL_REVENUES_DATA,
  CHANNEL_REVENUES_DATA,
  YIELD_CONVERSIONS_DATA,
  WASTE_ENTRIES_DATA,
  OPERATIONAL_EXPENSES_DATA,
  STOCK_TRANSFERS_DATA,
  SUPPLIER_DELIVERIES_DATA,
  STOCK_LEDGER_DATA,
  SYSTEM_LOGS_DATA,
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
        idMap.modifierGroup.set(mg.protoId, mgId!);
      }
    }
    if (!mgId) continue;

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
          idMap.modifier.set(mod.protoId, modId!);
        }
      }
      if (!modId) continue;

      if ("ingredients" in mod && mod.ingredients) {
        for (const mi of mod.ingredients) {
          const ingId = idMap.ingredient.get(mi.ingredientProtoId);
          if (!ingId) continue;
          const existingMi = await db
            .select()
            .from(modifierIngredientsTable)
            .where(
              and(
                eq(modifierIngredientsTable.modifierId, modId!),
                eq(modifierIngredientsTable.ingredientId, ingId),
              ),
            )
            .limit(1);
          if (!existingMi[0]) {
            await db
              .insert(modifierIngredientsTable)
              .values({ modifierId: modId!, ingredientId: ingId, quantity: mi.quantity });
          }
        }
      }
    }
  }
}

// ──────────────────────────────────────────
// Seed: Recipes (Pass 1)
// ──────────────────────────────────────────

export async function seedRecipesPass1(idMap: IdMap) {
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
        idMap.recipe.set(r.protoId, recId!);
      }
    }
    if (!recId) continue;

    for (const bpId of (r as any).brandProtoIds || []) {
      const brandId = idMap.brand.get(bpId);
      if (!brandId) continue;
      const existingRb = await db
        .select()
        .from(recipeBrandsTable)
        .where(and(eq(recipeBrandsTable.recipeId, recId!), eq(recipeBrandsTable.brandId, brandId)))
        .limit(1);
      if (!existingRb[0]) {
        await db.insert(recipeBrandsTable).values({ recipeId: recId!, brandId });
      }
    }

    for (const ri of r.ingredients ?? []) {
      const ingId = idMap.ingredient.get(ri.ingredientProtoId);
      if (!ingId) continue;
      const existingRi = await db
        .select()
        .from(recipeIngredientsTable)
        .where(
          and(
            eq(recipeIngredientsTable.recipeId, recId!),
            eq(recipeIngredientsTable.ingredientId, ingId),
          ),
        )
        .limit(1);
      if (!existingRi[0]) {
        await db
          .insert(recipeIngredientsTable)
          .values({ recipeId: recId!, ingredientId: ingId, quantity: ri.quantity });
      }
    }

    if ("modifierGroupProtoIds" in r && r.modifierGroupProtoIds) {
      for (const mgpId of r.modifierGroupProtoIds) {
        const mgId = idMap.modifierGroup.get(mgpId);
        if (!mgId) continue;
        const existingRmg = await db
          .select()
          .from(recipeModifierGroupsTable)
          .where(
            and(
              eq(recipeModifierGroupsTable.recipeId, recId!),
              eq(recipeModifierGroupsTable.modifierGroupId, mgId),
            ),
          )
          .limit(1);
        if (!existingRmg[0]) {
          await db
            .insert(recipeModifierGroupsTable)
            .values({ recipeId: recId!, modifierGroupId: mgId });
        }
      }
    }
  }

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
    channel: "Gofood" | "Grabfood" | "ShopeeFood" | "Dine-in" | "TikTok";
    feePercentage: number;
    fixedFee: number;
  }> = [
    { channel: "Gofood", feePercentage: 20, fixedFee: 0 },
    { channel: "Grabfood", feePercentage: 20, fixedFee: 0 },
    { channel: "ShopeeFood", feePercentage: 20, fixedFee: 0 },
    { channel: "Dine-in", feePercentage: 0, fixedFee: 0 },
    { channel: "TikTok", feePercentage: 20, fixedFee: 0 },
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
// Seed: Inventory (all branches, all countable ingredients)
// ──────────────────────────────────────────

export async function seedInventory(idMap: IdMap) {
  const branchCodes = [
    "CENTRAL",
    "SBY-01",
    "SBY-02",
    "SBY-03",
    "SBY-04",
    "MLG-01",
    "GRS-01",
    "JKT-01",
    "JKT-02",
    "BDG-01",
  ];
  const ingredientProtoIds = [
    "ing001",
    "ing002",
    "ing003",
    "ing004",
    "ing005",
    "ing006",
    "ing007",
    "ing008",
    "ing009",
    "ing010",
    "ing011",
    "ing012",
    "ing013",
    "ing014",
    "ing015",
    "ing019",
    "ing021",
    "ing022",
    "ing023",
    "ing024",
    "ing025",
    "ing026",
    "ing027",
    "ing028",
    "ing029",
    "ing030",
    "ing016",
    "ing017",
    "ing018",
    "ing020",
    "ing031",
    "ing032",
    "ing-sfg-001",
    "ing-sfg-002",
    "ing-sfg-003",
    "ing-sfg-004",
    "ing-sfg-005",
    "ing-sfg-006",
    "ing-sfg-007",
    "ing-sfg-008",
    "ing-sfg-009",
    "ing-sfg-010",
    "ing-sfg-011",
    "ing-sfg-012",
    "ing-sfg-013",
    "ing-sfg-014",
    "ing-sfg-015",
    "ing-sfg-016",
    "ing-sfg-017",
  ];
  for (const bc of branchCodes) {
    const bid = idMap.branch.get(
      bc === "CENTRAL" ? "br-central" : `br-${bc.toLowerCase().replace("-", "-")}`,
    );
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
        // Vary quantities by branch type
        const baseQty = bc === "CENTRAL" ? 500000 : 10000 + Math.random() * 50000;
        await db
          .insert(inventoryTable)
          .values({ branchId: bid, ingredientId: iid, quantity: Math.round(baseQty) });
      }
    }
  }
}

// ──────────────────────────────────────────
// Seed: Shifts
// ──────────────────────────────────────────

export async function seedShifts(idMap: IdMap) {
  const shiftData = [
    { email: "hans@omoiyari.net", branchCode: "SBY-01" },
    { email: "siti@omoiyari.net", branchCode: "SBY-02" },
    { email: "budi@omoiyari.net", branchCode: "SBY-03" },
    { email: "rina@omoiyari.net", branchCode: "SBY-04" },
    { email: "dewi@omoiyari.net", branchCode: "MLG-01" },
  ];
  for (const sd of shiftData) {
    const userId = idMap.user.get(sd.email);
    const branchId = idMap.branch.get(`br-${sd.branchCode.toLowerCase().replace("-", "-")}`);
    if (!userId || !branchId) continue;
    const existing = await db
      .select()
      .from(shiftsTable)
      .where(and(eq(shiftsTable.userId, userId), eq(shiftsTable.branchId, branchId)))
      .limit(1);
    if (!existing[0]) {
      await db.insert(shiftsTable).values({
        branchId: branchId,
        userId: userId,
        startTime: new Date(Date.now() - (shiftData.indexOf(sd) + 1) * 86400000),
        cashFloat: 500000,
        status: "Open",
        notes: `Shift demo ${sd.branchCode}`,
      });
    }
  }
}

// ──────────────────────────────────────────
// Seed: Orders
// ──────────────────────────────────────────

export async function seedOrders(idMap: IdMap, _allSuccess: boolean) {
  for (const o of ORDERS_DATA) {
    const bid = idMap.branch.get(`br-${o.branchCode.toLowerCase().replace("-", "-")}`);
    if (!bid) continue;
    const brandId = idMap.brand.get("BRAND-1");
    if (!brandId) continue;

    const existingOrder = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.orderCode, o.orderCode))
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
        orderCode: o.orderCode,
        status: o.status,
        createdAt: o.createdAt,
        voucherCode: o.voucherCode,
        voucherDiscount: o.voucherDiscount,
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
  const balanceMap: Record<string, number> = {};
  for (const e of STOCK_LEDGER_DATA) {
    const bid = idMap.branch.get(`br-${e.branchCode.toLowerCase().replace("-", "-")}`);
    const iid = idMap.ingredient.get(e.ingredientProtoId);
    if (!bid || !iid) continue;

    const key = `${bid}-${iid}`;
    const currentBalance = balanceMap[key] || 50000;
    const newBalance = e.type === "IN" ? currentBalance + e.quantity : currentBalance - e.quantity;
    balanceMap[key] = newBalance;

    const existing = await db
      .select()
      .from(stockLedgerTable)
      .where(
        and(
          eq(stockLedgerTable.branchId, bid),
          eq(stockLedgerTable.ingredientId, iid),
          eq(stockLedgerTable.reference, e.reference),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      await db.insert(stockLedgerTable).values({
        branchId: bid,
        ingredientId: iid,
        type: e.type,
        quantity: e.quantity,
        balance: newBalance,
        reference: e.reference,
        notes: e.notes,
        createdAt: new Date(Date.now() - e.dayAgo * 86400000),
      });
    }
  }
}

// ──────────────────────────────────────────
// Seed: Stock Transfers
// ──────────────────────────────────────────

export async function seedStockTransfers(idMap: IdMap) {
  for (const t of STOCK_TRANSFERS_DATA) {
    const fromBid = idMap.branch.get(
      t.fromBranchCode === "CENTRAL"
        ? "br-central"
        : `br-${t.fromBranchCode.toLowerCase().replace("-", "-")}`,
    );
    const toBid = idMap.branch.get(
      t.toBranchCode === "CENTRAL"
        ? "br-central"
        : `br-${t.toBranchCode.toLowerCase().replace("-", "-")}`,
    );
    const iid = idMap.ingredient.get(t.ingredientProtoId);
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
        quantity: t.quantity,
        status: t.status,
        requestedBy: reqUid,
        approvedBy: t.approvedByEmail ? idMap.user.get(t.approvedByEmail) : undefined,
        rejectionReason: t.rejectionReason,
        createdAt: t.createdAt,
      });
    }
  }
}

// ──────────────────────────────────────────
// Seed: Supplier Deliveries
// ──────────────────────────────────────────

export async function seedSupplierDeliveries(idMap: IdMap) {
  for (const d of SUPPLIER_DELIVERIES_DATA) {
    const iid = idMap.ingredient.get(d.ingredientProtoId);
    const supId = d.supplierCode ? idMap.supplier.get(d.supplierCode) : null;
    const receivedById = idMap.user.get(d.receivedByEmail);
    if (!iid || !receivedById) continue;
    const existing = await db
      .select()
      .from(supplierDeliveriesTable)
      .where(
        and(
          eq(supplierDeliveriesTable.supplierName, d.supplierName),
          eq(supplierDeliveriesTable.ingredientId, iid),
          eq(supplierDeliveriesTable.quantity, d.quantity),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      await db.insert(supplierDeliveriesTable).values({
        supplierId: supId,
        supplierName: d.supplierName,
        ingredientId: iid,
        quantity: d.quantity,
        price: d.price,
        deliveryDate: d.deliveryDate,
        receivedBy: receivedById,
        status: d.status,
      });
    }
  }
}

// ──────────────────────────────────────────
// Seed: Recipe Modifier Exclusions
// ──────────────────────────────────────────

export async function seedRecipeModifierExclusions(idMap: IdMap) {
  for (const excl of RECIPE_MODIFIER_EXCLUSIONS) {
    const recipeId = idMap.recipe.get(excl.recipeProtoId);
    const modifierId = idMap.modifier.get(excl.modifierProtoId);
    const ingredientId = idMap.ingredient.get(excl.ingredientProtoId);
    if (!recipeId || !modifierId || !ingredientId) continue;

    const existing = await db
      .select()
      .from(recipeModifierExclusionsTable)
      .where(
        and(
          eq(recipeModifierExclusionsTable.recipeId, recipeId),
          eq(recipeModifierExclusionsTable.modifierId, modifierId),
          eq(recipeModifierExclusionsTable.ingredientId, ingredientId),
        ),
      )
      .limit(1);

    if (!existing[0]) {
      await db.insert(recipeModifierExclusionsTable).values({
        recipeId,
        modifierId,
        ingredientId,
        quantity: 1,
      });
    }
  }
}

// ──────────────────────────────────────────
// Seed: Waste Entries
// ──────────────────────────────────────────

export async function seedWasteEntries(idMap: IdMap) {
  for (const w of WASTE_ENTRIES_DATA) {
    const branchId = idMap.branch.get(`br-${w.branchCode.toLowerCase().replace("-", "-")}`);
    const ingId = idMap.ingredient.get(w.ingredientProtoId);
    const userId = idMap.user.get(w.submittedByEmail);
    if (!branchId || !ingId || !userId) continue;
    const existing = await db
      .select()
      .from(wasteEntriesTable)
      .where(
        and(
          eq(wasteEntriesTable.branchId, branchId),
          eq(wasteEntriesTable.ingredientId, ingId),
          eq(wasteEntriesTable.quantity, w.quantity),
          eq(wasteEntriesTable.category, w.category),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      await db.insert(wasteEntriesTable).values({
        branchId,
        ingredientId: ingId,
        quantity: w.quantity,
        category: w.category,
        notes: w.notes,
        investigationNote: w.investigationNote,
        submittedBy: userId,
        createdAt: w.createdAt,
      });
    }
  }
}

// ──────────────────────────────────────────
// Seed: Operational Expenses
// ──────────────────────────────────────────

export async function seedOperationalExpenses(idMap: IdMap) {
  for (const oe of OPERATIONAL_EXPENSES_DATA) {
    const branchId = idMap.branch.get(`br-${oe.branchCode.toLowerCase().replace("-", "-")}`);
    const userId = idMap.user.get(oe.submittedByEmail);
    if (!branchId || !userId) continue;
    const existing = await db
      .select()
      .from(operationalExpensesTable)
      .where(
        and(
          eq(operationalExpensesTable.branchId, branchId),
          eq(operationalExpensesTable.category, oe.category),
          eq(operationalExpensesTable.date, oe.date),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      await db.insert(operationalExpensesTable).values({
        branchId,
        category: oe.category,
        amount: oe.amount,
        date: oe.date,
        notes: oe.notes,
        submittedBy: userId,
      });
    }
  }
}

// ──────────────────────────────────────────
// Seed: System Logs
// ──────────────────────────────────────────

export async function seedSystemLogs() {
  for (const l of SYSTEM_LOGS_DATA) {
    const existing = await db
      .select()
      .from(systemLogsTable)
      .where(and(eq(systemLogsTable.action, l.action), eq(systemLogsTable.detail, l.detail)))
      .limit(1);
    if (!existing[0]) {
      await db.insert(systemLogsTable).values({
        action: l.action,
        detail: l.detail,
        userName: l.userName,
        status: l.status,
        createdAt: l.createdAt,
      });
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
// Seed: Purchase Requisitions
// ──────────────────────────────────────────

export async function seedPurchaseRequisitions(idMap: IdMap) {
  for (const pr of PURCHASE_REQUISITIONS_DATA) {
    const branchId = idMap.branch.get(`br-${pr.branchCode.toLowerCase().replace("-", "-")}`);
    const reqById = idMap.user.get(pr.requestedByEmail);
    if (!branchId || !reqById) continue;

    const existing = await db
      .select()
      .from(purchaseRequisitionsTable)
      .where(eq(purchaseRequisitionsTable.code, pr.code))
      .limit(1);
    if (existing[0]) continue;

    const [inserted] = await db
      .insert(purchaseRequisitionsTable)
      .values({
        code: pr.code,
        branchId,
        status: pr.status,
        requestedBy: reqById,
        approvedBy: pr.approvedByEmail ? idMap.user.get(pr.approvedByEmail) : undefined,
        notes: pr.notes,
        rejectionReason: pr.rejectionReason,
        isAutoGenerated: pr.isAutoGenerated,
        createdAt: pr.createdAt,
      })
      .returning({ id: purchaseRequisitionsTable.id });

    for (const item of pr.items) {
      const ingId = idMap.ingredient.get(item.ingredientProtoId);
      if (!ingId) continue;
      await db.insert(purchaseRequisitionItemsTable).values({
        purchaseRequisitionId: inserted.id,
        ingredientId: ingId,
        quantity: item.quantity,
      });
    }
  }
}

// ──────────────────────────────────────────
// Seed: Purchase Orders
// ──────────────────────────────────────────

export async function seedPurchaseOrders(idMap: IdMap) {
  for (const po of PURCHASE_ORDERS_DATA) {
    const fromBranchId = idMap.branch.get(
      po.fromBranchCode === "CENTRAL"
        ? "br-central"
        : `br-${po.fromBranchCode.toLowerCase().replace("-", "-")}`,
    );
    const toBranchId = idMap.branch.get(
      po.toBranchCode === "CENTRAL"
        ? "br-central"
        : `br-${po.toBranchCode.toLowerCase().replace("-", "-")}`,
    );
    const createdById = idMap.user.get(po.createdByEmail);
    const supplierId = idMap.supplier.get(po.supplierCode);
    if (!fromBranchId || !toBranchId || !createdById) continue;

    const existing = await db
      .select()
      .from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.code, po.code))
      .limit(1);
    if (existing[0]) continue;

    const [inserted] = await db
      .insert(purchaseOrdersTable)
      .values({
        code: po.code,
        fromBranchId,
        toBranchId,
        supplierId: supplierId || null,
        status: po.status,
        notes: po.notes,
        createdBy: createdById,
        createdAt: po.createdAt,
      })
      .returning({ id: purchaseOrdersTable.id });

    for (const item of po.items) {
      const ingId = idMap.ingredient.get(item.ingredientProtoId);
      if (!ingId) continue;
      await db.insert(purchaseOrderItemsTable).values({
        purchaseOrderId: inserted.id,
        ingredientId: ingId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      });
    }
  }
}

// ──────────────────────────────────────────
// Seed: Delivery Notes
// ──────────────────────────────────────────

export async function seedDeliveryNotes(idMap: IdMap) {
  for (const dn of DELIVERY_NOTES_DATA) {
    const fromBranchId = idMap.branch.get(
      dn.fromBranchCode === "CENTRAL"
        ? "br-central"
        : `br-${dn.fromBranchCode.toLowerCase().replace("-", "-")}`,
    );
    const toBranchId = idMap.branch.get(
      dn.toBranchCode === "CENTRAL"
        ? "br-central"
        : `br-${dn.toBranchCode.toLowerCase().replace("-", "-")}`,
    );
    if (!fromBranchId || !toBranchId) continue;

    const existing = await db
      .select()
      .from(deliveryNotesTable)
      .where(eq(deliveryNotesTable.code, dn.code))
      .limit(1);
    if (existing[0]) continue;

    const [inserted] = await db
      .insert(deliveryNotesTable)
      .values({
        code: dn.code,
        fromBranchId,
        toBranchId,
        status: dn.status,
        driverName: dn.driverName,
        vehicleNumber: dn.vehicleNumber,
        createdAt: dn.createdAt,
      })
      .returning({ id: deliveryNotesTable.id });

    for (const item of dn.items) {
      const ingId = idMap.ingredient.get(item.ingredientProtoId);
      if (!ingId) continue;
      await db.insert(deliveryNoteItemsTable).values({
        deliveryNoteId: inserted.id,
        ingredientId: ingId,
        quantity: item.quantity,
        readyQuantity: item.readyQuantity ?? null,
        pickedQuantity: item.pickedQuantity ?? null,
        receivedQuantity: item.receivedQuantity ?? null,
        rejectedQuantity: item.rejectedQuantity ?? 0,
      });
    }

    // Create in-transit inventory for non-draft, non-cancelled DNs
    if (dn.status !== "Draft" && dn.status !== "Cancelled") {
      for (const item of dn.items) {
        const ingId = idMap.ingredient.get(item.ingredientProtoId);
        if (!ingId) continue;
        const existingIti = await db
          .select()
          .from(inTransitInventoryTable)
          .where(
            and(
              eq(inTransitInventoryTable.deliveryNoteId, inserted.id),
              eq(inTransitInventoryTable.ingredientId, ingId),
            ),
          )
          .limit(1);
        if (!existingIti[0]) {
          await db.insert(inTransitInventoryTable).values({
            deliveryNoteId: inserted.id,
            branchId: toBranchId,
            ingredientId: ingId,
            quantity: item.quantity,
          });
        }
      }
    }
  }
}

// ──────────────────────────────────────────
// Seed: SCM Invoices
// ──────────────────────────────────────────

export async function seedScmInvoices(idMap: IdMap) {
  for (const inv of SCM_INVOICES_DATA) {
    const fromBranchId = idMap.branch.get(
      inv.fromBranchCode === "CENTRAL"
        ? "br-central"
        : `br-${inv.fromBranchCode.toLowerCase().replace("-", "-")}`,
    );
    const toBranchId = idMap.branch.get(
      inv.toBranchCode === "CENTRAL"
        ? "br-central"
        : `br-${inv.toBranchCode.toLowerCase().replace("-", "-")}`,
    );
    if (!fromBranchId || !toBranchId) continue;

    const dnExisting = await db
      .select()
      .from(deliveryNotesTable)
      .where(eq(deliveryNotesTable.code, inv.dnCode))
      .limit(1);
    if (!dnExisting[0]) continue;

    const existing = await db
      .select()
      .from(scmInvoicesTable)
      .where(eq(scmInvoicesTable.code, inv.code))
      .limit(1);
    if (existing[0]) continue;

    await db.insert(scmInvoicesTable).values({
      code: inv.code,
      deliveryNoteId: dnExisting[0].id,
      fromBranchId,
      toBranchId,
      totalAmount: inv.totalAmount,
      status: inv.status,
      dueDate: inv.dueDate,
      paidAt: inv.paidAt,
    });
  }
}

// ──────────────────────────────────────────
// Seed: Stock Opnames
// ──────────────────────────────────────────

export async function seedStockOpnames(idMap: IdMap) {
  for (const so of STOCK_OPNAME_DATA) {
    const branchId = idMap.branch.get(`br-${so.branchCode.toLowerCase().replace("-", "-")}`);
    const triggeredById = idMap.user.get(so.triggeredByEmail);
    const submittedById = idMap.user.get(so.submittedByEmail);
    if (!branchId || !triggeredById || !submittedById) continue;

    const existing = await db
      .select()
      .from(stockOpnamesTable)
      .where(and(eq(stockOpnamesTable.branchId, branchId), eq(stockOpnamesTable.date, so.date)))
      .limit(1);
    if (existing[0]) continue;

    const [inserted] = await db
      .insert(stockOpnamesTable)
      .values({
        branchId,
        date: so.date,
        status: so.status,
        triggeredBy: triggeredById,
        submittedBy: submittedById,
        approvedBy: so.approvedByEmail ? idMap.user.get(so.approvedByEmail) : undefined,
        createdAt: so.createdAt,
      })
      .returning({ id: stockOpnamesTable.id });

    for (const item of so.items) {
      const ingId = idMap.ingredient.get(item.ingredientProtoId);
      if (!ingId) continue;
      await db.insert(stockOpnameItemsTable).values({
        stockOpnameId: inserted.id,
        ingredientId: ingId,
        systemStock: item.systemStock,
        physicalStock: item.physicalStock,
        variance: item.variance,
        investigationNote: item.investigationNote,
      });
    }
  }
}

// ──────────────────────────────────────────
// Seed: Period Logs
// ──────────────────────────────────────────

export async function seedPeriodLogs(idMap: IdMap) {
  for (const pl of PERIOD_LOGS_DATA) {
    const openedById = idMap.user.get(pl.openedByEmail);
    const closedById = pl.closedByEmail ? idMap.user.get(pl.closedByEmail) : undefined;
    if (!openedById) continue;

    const existing = await db
      .select()
      .from(periodLogsTable)
      .where(eq(periodLogsTable.periodName, pl.periodName))
      .limit(1);
    if (existing[0]) continue;

    await db.insert(periodLogsTable).values({
      periodName: pl.periodName,
      status: pl.status,
      openedAt: pl.openedAt,
      closedAt: pl.closedAt,
      openedBy: openedById,
      closedBy: closedById,
    });
  }
}

// ──────────────────────────────────────────
// Seed: System Notifications
// ──────────────────────────────────────────

export async function seedSystemNotifications(idMap: IdMap) {
  for (const n of SYSTEM_NOTIFICATIONS_DATA) {
    const userId = idMap.user.get(n.userEmail);
    if (!userId) continue;

    const existing = await db
      .select()
      .from(systemNotificationsTable)
      .where(
        and(
          eq(systemNotificationsTable.userId, userId),
          eq(systemNotificationsTable.title, n.title),
          eq(systemNotificationsTable.message, n.message),
        ),
      )
      .limit(1);
    if (existing[0]) continue;

    await db.insert(systemNotificationsTable).values({
      userId,
      title: n.title,
      message: n.message,
      type: n.type,
      isRead: n.isRead,
      createdAt: n.createdAt,
    });
  }
}

// ──────────────────────────────────────────
// Seed: Cancel Requests
// ──────────────────────────────────────────

export async function seedCancelRequests(idMap: IdMap) {
  for (const cr of CANCEL_REQUESTS_DATA) {
    // Find order by index in the orders table
    const orderCode = `GF-${20250000 + cr.orderIdx}`;
    const order = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.orderCode, orderCode))
      .limit(1);
    if (!order[0]) continue;

    const reqById = idMap.user.get(cr.requestedByEmail);
    if (!reqById) continue;

    const existing = await db
      .select()
      .from(cancelRequestsTable)
      .where(eq(cancelRequestsTable.orderId, order[0].id))
      .limit(1);
    if (existing[0]) continue;

    await db.insert(cancelRequestsTable).values({
      orderId: order[0].id,
      reason: cr.reason,
      detail: cr.detail,
      requestedBy: reqById,
      approvedBy: cr.approvedByEmail ? idMap.user.get(cr.approvedByEmail) : undefined,
      status: cr.status,
      createdAt: cr.createdAt,
    });
  }
}

// ──────────────────────────────────────────
// Seed: Print Requests
// ──────────────────────────────────────────

export async function seedPrintRequests(idMap: IdMap) {
  for (const pr of PRINT_REQUESTS_DATA) {
    const orderCode = `GF-${20250000 + pr.orderIdx}`;
    const order = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.orderCode, orderCode))
      .limit(1);
    if (!order[0]) continue;

    const reqById = idMap.user.get(pr.requestedByEmail);
    if (!reqById) continue;

    const existing = await db
      .select()
      .from(printRequestsTable)
      .where(
        and(
          eq(printRequestsTable.orderId, order[0].id),
          eq(printRequestsTable.requestType, pr.requestType),
        ),
      )
      .limit(1);
    if (existing[0]) continue;

    await db.insert(printRequestsTable).values({
      orderId: order[0].id,
      requestType: pr.requestType,
      requestedBy: reqById,
      approvedBy: pr.approvedByEmail ? idMap.user.get(pr.approvedByEmail) : undefined,
      status: pr.status,
      createdAt: pr.createdAt,
    });
  }
}

// ──────────────────────────────────────────
// Seed: Manual Revenues
// ──────────────────────────────────────────

export async function seedManualRevenues(idMap: IdMap) {
  for (const mr of MANUAL_REVENUES_DATA) {
    const branchId = idMap.branch.get(`br-${mr.branchCode.toLowerCase().replace("-", "-")}`);
    const userId = idMap.user.get(mr.submittedByEmail);
    if (!branchId || !userId) continue;

    const existing = await db
      .select()
      .from(manualRevenuesTable)
      .where(
        and(
          eq(manualRevenuesTable.branchId, branchId),
          eq(manualRevenuesTable.date, mr.date),
          eq(manualRevenuesTable.amount, mr.amount),
        ),
      )
      .limit(1);
    if (existing[0]) continue;

    await db.insert(manualRevenuesTable).values({
      branchId,
      date: mr.date,
      amount: mr.amount,
      notes: mr.notes,
      submittedBy: userId,
      createdAt: mr.createdAt,
    });
  }
}

// ──────────────────────────────────────────
// Seed: Channel Revenues
// ──────────────────────────────────────────

export async function seedChannelRevenues(idMap: IdMap) {
  for (const cr of CHANNEL_REVENUES_DATA) {
    const branchId = idMap.branch.get(`br-${cr.branchCode.toLowerCase().replace("-", "-")}`);
    const userId = idMap.user.get(cr.submittedByEmail);
    if (!branchId || !userId) continue;

    const existing = await db
      .select()
      .from(channelRevenuesTable)
      .where(
        and(
          eq(channelRevenuesTable.branchId, branchId),
          eq(channelRevenuesTable.date, cr.date),
          eq(channelRevenuesTable.channel, cr.channel),
        ),
      )
      .limit(1);
    if (existing[0]) continue;

    await db.insert(channelRevenuesTable).values({
      branchId,
      date: cr.date,
      channel: cr.channel,
      amount: cr.amount,
      notes: cr.notes,
      submittedBy: userId,
    });
  }
}

// ──────────────────────────────────────────
// Seed: Yield Conversions
// ──────────────────────────────────────────

export async function seedYieldConversions(idMap: IdMap) {
  for (const yc of YIELD_CONVERSIONS_DATA) {
    const branchId = idMap.branch.get(`br-${yc.branchCode.toLowerCase().replace("-", "-")}`);
    const sourceId = idMap.ingredient.get(yc.sourceIngredientProtoId);
    const targetId = idMap.ingredient.get(yc.targetIngredientProtoId);
    const processedById = idMap.user.get(yc.processedByEmail);
    if (!branchId || !sourceId || !targetId || !processedById) continue;

    const existing = await db
      .select()
      .from(yieldConversionsTable)
      .where(
        and(
          eq(yieldConversionsTable.branchId, branchId),
          eq(yieldConversionsTable.sourceIngredientId, sourceId),
          eq(yieldConversionsTable.createdAt, yc.createdAt),
        ),
      )
      .limit(1);
    if (existing[0]) continue;

    await db.insert(yieldConversionsTable).values({
      branchId,
      sourceIngredientId: sourceId,
      sourceQuantity: yc.sourceQuantity,
      targetIngredientId: targetId,
      targetQuantity: yc.targetQuantity,
      yieldPercentage: yc.yieldPercentage,
      shrinkageQuantity: yc.shrinkageQuantity,
      notes: yc.notes,
      processedBy: processedById,
      createdAt: yc.createdAt,
    });
  }
}

// ──────────────────────────────────────────
// Main orchestrator
// ──────────────────────────────────────────

export async function seedAll(allSuccess = true) {
  const idMap = createIdMap();

  console.log("[seed] Seeding branches...");
  await seedBranches(idMap);

  console.log("[seed] Seeding brands...");
  await seedBrands(idMap);

  console.log("[seed] Seeding suppliers...");
  await seedSuppliers(idMap);

  console.log("[seed] Seeding users...");
  await seedUsers(idMap);

  console.log("[seed] Seeding ingredients...");
  await seedIngredients(idMap);

  console.log("[seed] Seeding modifier groups & modifiers...");
  await seedModifiers(idMap);

  console.log("[seed] Seeding recipes...");
  await seedRecipesPass1(idMap);

  console.log("[seed] Seeding platform fees...");
  await seedPlatformFees();

  console.log("[seed] Seeding vouchers...");
  await seedVouchers(idMap);

  console.log("[seed] Seeding inventory...");
  await seedInventory(idMap);

  console.log("[seed] Seeding shifts...");
  await seedShifts(idMap);

  console.log("[seed] Seeding orders...");
  await seedOrders(idMap, allSuccess);

  console.log("[seed] Seeding stock ledger...");
  await seedStockLedger(idMap);

  console.log("[seed] Seeding stock transfers...");
  await seedStockTransfers(idMap);

  console.log("[seed] Seeding supplier deliveries...");
  await seedSupplierDeliveries(idMap);

  console.log("[seed] Seeding recipe modifier exclusions...");
  await seedRecipeModifierExclusions(idMap);

  console.log("[seed] Seeding waste entries...");
  await seedWasteEntries(idMap);

  console.log("[seed] Seeding operational expenses...");
  await seedOperationalExpenses(idMap);

  console.log("[seed] Seeding system logs...");
  await seedSystemLogs();

  console.log("[seed] Seeding app settings...");
  await seedAppSettings(idMap);

  console.log("[seed] Seeding purchase requisitions...");
  await seedPurchaseRequisitions(idMap);

  console.log("[seed] Seeding purchase orders...");
  await seedPurchaseOrders(idMap);

  console.log("[seed] Seeding delivery notes...");
  await seedDeliveryNotes(idMap);

  console.log("[seed] Seeding SCM invoices...");
  await seedScmInvoices(idMap);

  console.log("[seed] Seeding stock opnames...");
  await seedStockOpnames(idMap);

  console.log("[seed] Seeding period logs...");
  await seedPeriodLogs(idMap);

  console.log("[seed] Seeding system notifications...");
  await seedSystemNotifications(idMap);

  console.log("[seed] Seeding cancel requests...");
  await seedCancelRequests(idMap);

  console.log("[seed] Seeding print requests...");
  await seedPrintRequests(idMap);

  console.log("[seed] Seeding manual revenues...");
  await seedManualRevenues(idMap);

  console.log("[seed] Seeding channel revenues...");
  await seedChannelRevenues(idMap);

  console.log("[seed] Seeding yield conversions...");
  await seedYieldConversions(idMap);

  console.log("[seed] Done!");
  return { success: true, message: "All data seeded" };
}
