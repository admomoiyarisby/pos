import { createServerFn } from "@tanstack/react-start";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import {
  orders,
  orderItems,
  inventory,
  recipes,
  recipeIngredients,
  recipeChildRecipes,
  recipeBrands,
  ingredients,
  branches,
  brands,
  stockOpnames,
  stockOpnameItems,
  wasteEntries,
  manualRevenues,
  manualRevenueBrandBreakdowns,
  yieldConversions,
  yieldConversionItems,
} from "#/db/schema";
import { db } from "#/lib/server/db";
import { requireAuth } from "./auth";
import type { AppUser } from "./auth";
import { scopedBranchIds } from "./branch-scope";
import {
  shiftIsoDay,
  trendBucketLabel,
  trendBucketStarts,
  trendGranularityFor,
  type TrendGranularity,
} from "#/lib/dashboard-range";
import { toDateInputValue } from "#/lib/utils";
import { z } from "zod";

export interface DashboardQuery {
  /** Inclusive Jakarta day, `YYYY-MM-DD`. Absent means unbounded. */
  from?: string;
  /** Inclusive Jakarta day, `YYYY-MM-DD`. Absent means unbounded. */
  to?: string;
  branchId?: string;
}

const dashboardQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  branchId: z.string().uuid().optional(),
});

const DETAIL_ROW_LIMIT = 500;
const SO_ROW_LIMIT = 200;

/**
 * Repair a half-specified range. The UI always sends both ends for presets and
 * custom ranges; this keeps direct callers and one-ended ranges meaningful.
 */
function normalizeQuery(query: DashboardQuery, now: Date): DashboardQuery {
  let from = query.from;
  let to = query.to;
  if (from && !to) to = toDateInputValue(now);
  if (!from && to) from = shiftIsoDay(to, -29);
  if (from && to && from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  return { ...query, from, to };
}

function jakartaDayClauses(column: SQLWrapper, from?: string, to?: string): SQL[] {
  const clauses: SQL[] = [];
  if (from) {
    clauses.push(sql`DATE((${column} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${from}`);
  }
  if (to) {
    clauses.push(sql`DATE((${column} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${to}`);
  }
  return clauses;
}

function textDayClauses(column: SQLWrapper, from?: string, to?: string): SQL[] {
  const clauses: SQL[] = [];
  if (from) clauses.push(sql`${column} >= ${from}`);
  if (to) clauses.push(sql`${column} <= ${to}`);
  return clauses;
}

function trendGranularity(from?: string, to?: string): TrendGranularity {
  return trendGranularityFor({ period: "custom", from, to, label: "", dateLabel: "" });
}

function trendBucketSql(granularity: TrendGranularity): SQL<string> {
  const local = sql`((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')`;
  if (granularity === "day") return sql<string>`to_char(${local}, 'YYYY-MM-DD')`;
  return sql<string>`to_char(date_trunc(${granularity}, ${local}), 'YYYY-MM-DD')`;
}

export interface DashboardStats {
  totalSales: number;
  completedCount: number;
  voidCount: number;
  orderCount: number;
  manualRevenue: number;
}

export interface DashboardTrendPoint {
  bucket: string;
  label: string;
  revenue: number;
}

export interface DashboardChannelRow {
  channel: string;
  count: number;
  revenue: number;
}

export interface DashboardBranchSales {
  branchId: string;
  name: string;
  revenue: number;
  count: number;
}

export interface DashboardBrandSales {
  brandId: string;
  name: string;
  revenue: number;
  count: number;
}

export interface DashboardLowStock {
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  rop: number;
  stockUnit: string;
}

export interface DashboardOverview {
  stats: DashboardStats;
  salesTrend: DashboardTrendPoint[];
  channelData: DashboardChannelRow[];
  branchSales: DashboardBranchSales[];
  brandSales: DashboardBrandSales[];
  lowStock: DashboardLowStock[];
  branches: { id: string; name: string }[];
}

/**
 * Aggregates for the overview, finance, and inventory charts.
 *
 * Everything is computed in SQL over the full filtered set — not a client-side
 * roll-up of the newest N rows. Dead rows (`deleted_at`) and voids are excluded
 * from sales; the void count is a separate number so the anomaly card still
 * sees them. Dates are Jakarta calendar days on both ends.
 */
export async function getDashboardOverviewCore(
  user: AppUser,
  query: DashboardQuery,
  now: Date = new Date(),
): Promise<DashboardOverview> {
  const branchIds = await scopedBranchIds(user, query.branchId);
  if (branchIds && branchIds.length === 0) {
    return {
      stats: {
        totalSales: 0,
        completedCount: 0,
        voidCount: 0,
        orderCount: 0,
        manualRevenue: 0,
      },
      salesTrend: [],
      channelData: [],
      branchSales: [],
      brandSales: [],
      lowStock: [],
      branches: [],
    };
  }

  const normalized = normalizeQuery(query, now);
  const { from, to } = normalized;
  const branchClause = branchIds ? inArray(orders.branchId, branchIds) : undefined;
  const baseClauses: (SQL | undefined)[] = [
    isNull(orders.deletedAt),
    branchClause,
    ...jakartaDayClauses(orders.createdAt, from, to),
  ];
  const saleClauses: (SQL | undefined)[] = [...baseClauses, ne(orders.status, "Void")];
  const granularity = trendGranularity(from, to);

  const [
    [salesAgg],
    [voidAgg],
    trendRows,
    channelRows,
    branchOrderRows,
    brandOrderRows,
    branchesRows,
    lowStockRows,
    manualRevRows,
    manualBrandRows,
  ] = await Promise.all([
    db
      .select({
        totalSales: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)::int`,
        completedCount: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'Completed')::int`,
        orderCount: sql<number>`COUNT(*)::int`,
      })
      .from(orders)
      .where(and(...saleClauses)),

    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(orders)
      .where(and(...baseClauses, eq(orders.status, "Void"))),

    db
      .select({
        bucket: trendBucketSql(granularity),
        revenue: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)::int`,
      })
      .from(orders)
      .where(and(...saleClauses))
      .groupBy(trendBucketSql(granularity))
      .orderBy(trendBucketSql(granularity)),

    db
      .select({
        channel: orders.channel,
        count: sql<number>`COUNT(*)::int`,
        revenue: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)::int`,
      })
      .from(orders)
      .where(and(...saleClauses))
      .groupBy(orders.channel),

    db
      .select({
        branchId: orders.branchId,
        revenue: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)::int`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(orders)
      .where(and(...saleClauses))
      .groupBy(orders.branchId),

    db
      .select({
        brandId: brands.id,
        name: brands.name,
        revenue: sql<number>`COALESCE(SUM(${orderItems.price} * ${orderItems.quantity}), 0)::int`,
        count: sql<number>`COUNT(DISTINCT ${orders.id})::int`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(brands, eq(orderItems.brandId, brands.id))
      .where(and(...saleClauses))
      .groupBy(brands.id, brands.name),

    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(branchIds ? inArray(branches.id, branchIds) : undefined)
      .orderBy(branches.name),

    db
      .select({
        branchId: inventory.branchId,
        ingredientId: inventory.ingredientId,
        quantity: inventory.quantity,
        ingredientName: ingredients.name,
        rop: ingredients.rop,
        stockUnit: ingredients.stockUnit,
      })
      .from(inventory)
      .innerJoin(ingredients, eq(inventory.ingredientId, ingredients.id))
      .where(
        and(
          lt(inventory.quantity, 100),
          branchIds ? inArray(inventory.branchId, branchIds) : undefined,
        ),
      )
      .orderBy(inventory.quantity)
      .limit(200),

    user.role === "super_admin"
      ? db
          .select({
            id: manualRevenues.id,
            branchId: manualRevenues.branchId,
            amount: manualRevenues.amount,
          })
          .from(manualRevenues)
          .where(
            and(
              branchIds ? inArray(manualRevenues.branchId, branchIds) : undefined,
              ...textDayClauses(manualRevenues.date, from, to),
            ),
          )
      : Promise.resolve([]),

    user.role === "super_admin"
      ? db
          .select({
            brandId: brands.id,
            name: brands.name,
            revenue: sql<number>`COALESCE(SUM(${manualRevenueBrandBreakdowns.amount}), 0)::int`,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(manualRevenueBrandBreakdowns)
          .innerJoin(
            manualRevenues,
            eq(manualRevenueBrandBreakdowns.manualRevenueId, manualRevenues.id),
          )
          .innerJoin(brands, eq(manualRevenueBrandBreakdowns.brandId, brands.id))
          .where(
            and(
              branchIds ? inArray(manualRevenues.branchId, branchIds) : undefined,
              ...textDayClauses(manualRevenues.date, from, to),
            ),
          )
          .groupBy(brands.id, brands.name)
      : Promise.resolve([]),
  ]);

  const manualRevenue = manualRevRows.reduce(function (sum, row) {
    return sum + row.amount;
  }, 0);

  // Trend: fill every bucket in the range so a quiet day reads as zero rather
  // than a line jumping over it.
  const trendMap = new Map<string, number>();
  for (const row of trendRows) {
    trendMap.set(row.bucket, row.revenue);
  }
  const firstDataBucket = trendRows[0]?.bucket;
  const lastDataBucket = trendRows[trendRows.length - 1]?.bucket;
  // All-time has no range ends, so anchor the fill to the data's first and
  // last buckets. Explicit ranges already carry both ends.
  const bucketStarts = trendBucketStarts(
    {
      period: "custom",
      from: from ?? firstDataBucket,
      to: to ?? lastDataBucket,
      label: "",
      dateLabel: "",
    },
    granularity,
  );
  const salesTrend: DashboardTrendPoint[] = bucketStarts.map(function (bucket) {
    return {
      bucket,
      label: trendBucketLabel(bucket, granularity),
      revenue: trendMap.get(bucket) ?? 0,
    };
  });

  const orderByBranch = new Map(
    branchOrderRows.map(function (row) {
      return [row.branchId, row];
    }),
  );
  const manualByBranch = new Map<string, { revenue: number; count: number }>();
  for (const row of manualRevRows) {
    const existing = manualByBranch.get(row.branchId) ?? { revenue: 0, count: 0 };
    existing.revenue += row.amount;
    existing.count += 1;
    manualByBranch.set(row.branchId, existing);
  }
  const branchSales: DashboardBranchSales[] = branchesRows
    .map(function (branch) {
      const order = orderByBranch.get(branch.id);
      const manual = manualByBranch.get(branch.id);
      return {
        branchId: branch.id,
        name: branch.name,
        revenue: (order?.revenue ?? 0) + (manual?.revenue ?? 0),
        count: (order?.count ?? 0) + (manual?.count ?? 0),
      };
    })
    .filter(function (row) {
      return row.revenue > 0;
    });

  const brandMap = new Map<string, DashboardBrandSales>();
  for (const row of brandOrderRows) {
    brandMap.set(row.brandId, {
      brandId: row.brandId,
      name: row.name,
      revenue: row.revenue,
      count: row.count,
    });
  }
  for (const row of manualBrandRows) {
    const existing = brandMap.get(row.brandId) ?? {
      brandId: row.brandId,
      name: row.name,
      revenue: 0,
      count: 0,
    };
    existing.revenue += row.revenue;
    existing.count += row.count;
    brandMap.set(row.brandId, existing);
  }
  const brandSales = [...brandMap.values()]
    .filter(function (row) {
      return row.revenue > 0;
    })
    .sort(function (a, b) {
      return b.revenue - a.revenue;
    });

  // Inventory is a current-state read: the date filter intentionally does not
  // apply. Collapse branches to the worst-case row per ingredient so the table
  // shows where an item is most at risk.
  const lowStockByIngredient = new Map<string, DashboardLowStock>();
  for (const row of lowStockRows) {
    const existing = lowStockByIngredient.get(row.ingredientId);
    if (existing && existing.quantity <= row.quantity) continue;
    lowStockByIngredient.set(row.ingredientId, {
      ingredientId: row.ingredientId,
      ingredientName: row.ingredientName,
      quantity: row.quantity,
      rop: row.rop,
      stockUnit: row.stockUnit,
    });
  }
  const lowStock = [...lowStockByIngredient.values()]
    .sort(function (a, b) {
      return a.quantity - b.quantity;
    })
    .slice(0, 10);

  return {
    stats: {
      totalSales: (salesAgg?.totalSales ?? 0) + manualRevenue,
      completedCount: salesAgg?.completedCount ?? 0,
      voidCount: voidAgg?.count ?? 0,
      orderCount: salesAgg?.orderCount ?? 0,
      manualRevenue,
    },
    salesTrend,
    channelData: channelRows,
    branchSales,
    brandSales,
    lowStock,
    branches: branchesRows,
  };
}

export interface DashboardOrderRow {
  id: string;
  branchId: string;
  channel: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  totalCogs: number;
  mdrFee: number;
  netSales: number;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  orderCode: string | null;
  customerName: string | null;
}

export interface DashboardDetails {
  /** True when a row cap hid records; the UI says so instead of implying completeness. */
  truncated: {
    orders: boolean;
    stockOpnames: boolean;
    production: boolean;
    waste: boolean;
  };
  orders: DashboardOrderRow[];
  orderItems: {
    id: string;
    orderId: string;
    recipeId: string;
    quantity: number;
    price: number;
    cogsAtTransaction: number;
  }[];
  recipes: (typeof recipes.$inferSelect & {
    ingredients: (typeof recipeIngredients.$inferSelect)[];
    childRecipes: (typeof recipeChildRecipes.$inferSelect)[];
    brands: (typeof recipeBrands.$inferSelect)[];
  })[];
  ingredients: (typeof ingredients.$inferSelect)[];
  stockOpnames: (typeof stockOpnames.$inferSelect & {
    items: (typeof stockOpnameItems.$inferSelect)[];
  })[];
  production: {
    id: string;
    branchId: string;
    branchName: string | null;
    notes: string | null;
    productionDate: Date;
    createdAt: Date;
    status: "Active" | "Cancelled";
    out: {
      ingredientId: string;
      ingredientName: string | null;
      stockUnit: string | null;
      quantity: number;
    }[];
    produced: {
      ingredientId: string;
      ingredientName: string | null;
      stockUnit: string | null;
      quantity: number;
    }[];
  }[];
  wasteEntries: {
    id: string;
    branchId: string;
    branchName: string | null;
    ingredientId: string | null;
    ingredientName: string | null;
    ingredientUnit: string | null;
    recipeId: string | null;
    recipeName: string | null;
    quantity: number;
    category: "Beban Makan" | "Biaya Operasional" | "Spoiled" | "Denda";
    staffName: string | null;
    notes: string | null;
    valuation: number;
    createdAt: Date;
    status: "Active" | "Cancelled";
  }[];
}

/** Row sets behind the Operations, Production & Waste, Finance, and Inventory tabs. */
export async function getDashboardDetailsCore(
  user: AppUser,
  query: DashboardQuery,
  now: Date = new Date(),
): Promise<DashboardDetails> {
  const branchIds = await scopedBranchIds(user, query.branchId);
  if (branchIds && branchIds.length === 0) {
    return {
      truncated: { orders: false, stockOpnames: false, production: false, waste: false },
      orders: [],
      orderItems: [],
      recipes: [],
      ingredients: [],
      stockOpnames: [],
      production: [],
      wasteEntries: [],
    };
  }

  const normalized = normalizeQuery(query, now);
  const { from, to } = normalized;
  const [orderRows, recipeRows, ingredientRows, soRows, productionRows, wasteRows] =
    await Promise.all([
      db
        .select({
          id: orders.id,
          branchId: orders.branchId,
          channel: orders.channel,
          subtotal: orders.subtotal,
          taxAmount: orders.taxAmount,
          totalAmount: orders.totalAmount,
          totalCogs: orders.totalCogs,
          mdrFee: orders.mdrFee,
          netSales: orders.netSales,
          status: orders.status,
          createdAt: orders.createdAt,
          completedAt: orders.completedAt,
          orderCode: orders.orderCode,
          customerName: orders.customerName,
        })
        .from(orders)
        .where(
          and(
            isNull(orders.deletedAt),
            branchIds ? inArray(orders.branchId, branchIds) : undefined,
            ...jakartaDayClauses(orders.createdAt, from, to),
          ),
        )
        .orderBy(desc(orders.createdAt))
        .limit(DETAIL_ROW_LIMIT),

      db.select().from(recipes).where(ne(recipes.status, "Deleted")).orderBy(recipes.name),

      db.select().from(ingredients).orderBy(ingredients.name),

      db
        .select()
        .from(stockOpnames)
        .where(
          and(
            isNull(stockOpnames.deletedAt),
            branchIds ? inArray(stockOpnames.branchId, branchIds) : undefined,
            ...textDayClauses(stockOpnames.date, from, to),
          ),
        )
        .orderBy(desc(stockOpnames.date))
        .limit(SO_ROW_LIMIT),

      db
        .select({
          id: yieldConversions.id,
          branchId: yieldConversions.branchId,
          branchName: branches.name,
          notes: yieldConversions.notes,
          productionDate: yieldConversions.productionDate,
          createdAt: yieldConversions.createdAt,
          status: yieldConversions.status,
        })
        .from(yieldConversions)
        .leftJoin(branches, eq(yieldConversions.branchId, branches.id))
        .where(
          and(
            eq(yieldConversions.status, "Active"),
            isNull(yieldConversions.deletedAt),
            branchIds ? inArray(yieldConversions.branchId, branchIds) : undefined,
            ...jakartaDayClauses(yieldConversions.productionDate, from, to),
          ),
        )
        .orderBy(desc(yieldConversions.productionDate))
        .limit(DETAIL_ROW_LIMIT),

      db
        .select({
          id: wasteEntries.id,
          branchId: wasteEntries.branchId,
          branchName: branches.name,
          ingredientId: wasteEntries.ingredientId,
          ingredientName: ingredients.name,
          ingredientUnit: ingredients.stockUnit,
          recipeId: wasteEntries.recipeId,
          recipeName: recipes.name,
          quantity: wasteEntries.quantity,
          category: wasteEntries.category,
          staffName: wasteEntries.staffName,
          notes: wasteEntries.notes,
          valuation: wasteEntries.valuation,
          createdAt: wasteEntries.createdAt,
          status: wasteEntries.status,
        })
        .from(wasteEntries)
        .leftJoin(ingredients, eq(wasteEntries.ingredientId, ingredients.id))
        .leftJoin(recipes, eq(wasteEntries.recipeId, recipes.id))
        .leftJoin(branches, eq(wasteEntries.branchId, branches.id))
        .where(
          and(
            isNull(wasteEntries.deletedAt),
            eq(wasteEntries.status, "Active"),
            branchIds ? inArray(wasteEntries.branchId, branchIds) : undefined,
            ...jakartaDayClauses(wasteEntries.createdAt, from, to),
          ),
        )
        .orderBy(desc(wasteEntries.createdAt))
        .limit(DETAIL_ROW_LIMIT),
    ]);

  const orderIds = orderRows.map(function (row) {
    return row.id;
  });
  const recipeIds = recipeRows.map(function (row) {
    return row.id;
  });
  const soIds = soRows.map(function (row) {
    return row.id;
  });
  const productionIds = productionRows.map(function (row) {
    return row.id;
  });

  const [
    orderItemRows,
    recipeIngredientRows,
    childRecipeRows,
    recipeBrandRows,
    soItemRows,
    productionItemRows,
  ] = await Promise.all([
    orderIds.length > 0
      ? db
          .select({
            id: orderItems.id,
            orderId: orderItems.orderId,
            recipeId: orderItems.recipeId,
            quantity: orderItems.quantity,
            price: orderItems.price,
            cogsAtTransaction: orderItems.cogsAtTransaction,
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, orderIds))
      : Promise.resolve([]),

    recipeIds.length > 0
      ? db.select().from(recipeIngredients).where(inArray(recipeIngredients.recipeId, recipeIds))
      : Promise.resolve([]),

    recipeIds.length > 0
      ? db
          .select()
          .from(recipeChildRecipes)
          .where(inArray(recipeChildRecipes.parentRecipeId, recipeIds))
      : Promise.resolve([]),

    recipeIds.length > 0
      ? db.select().from(recipeBrands).where(inArray(recipeBrands.recipeId, recipeIds))
      : Promise.resolve([]),

    soIds.length > 0
      ? db.select().from(stockOpnameItems).where(inArray(stockOpnameItems.stockOpnameId, soIds))
      : Promise.resolve([]),

    productionIds.length > 0
      ? db
          .select({
            conversionId: yieldConversionItems.conversionId,
            ingredientId: yieldConversionItems.ingredientId,
            ingredientName: ingredients.name,
            stockUnit: ingredients.stockUnit,
            quantity: yieldConversionItems.quantity,
            direction: yieldConversionItems.direction,
          })
          .from(yieldConversionItems)
          .leftJoin(ingredients, eq(yieldConversionItems.ingredientId, ingredients.id))
          .where(inArray(yieldConversionItems.conversionId, productionIds))
      : Promise.resolve([]),
  ]);

  return {
    truncated: {
      orders: orderRows.length >= DETAIL_ROW_LIMIT,
      stockOpnames: soRows.length >= SO_ROW_LIMIT,
      production: productionRows.length >= DETAIL_ROW_LIMIT,
      waste: wasteRows.length >= DETAIL_ROW_LIMIT,
    },
    orders: orderRows,
    orderItems: orderItemRows,
    recipes: recipeRows.map(function (recipe) {
      return {
        ...recipe,
        ingredients: recipeIngredientRows.filter(function (row) {
          return row.recipeId === recipe.id;
        }),
        childRecipes: childRecipeRows.filter(function (row) {
          return row.parentRecipeId === recipe.id;
        }),
        brands: recipeBrandRows.filter(function (row) {
          return row.recipeId === recipe.id;
        }),
      };
    }),
    ingredients: ingredientRows,
    stockOpnames: soRows.map(function (row) {
      return {
        ...row,
        items: soItemRows.filter(function (item) {
          return item.stockOpnameId === row.id;
        }),
      };
    }),
    production: productionRows.map(function (record) {
      const recordItems = productionItemRows.filter(function (item) {
        return item.conversionId === record.id;
      });
      return {
        ...record,
        out: recordItems
          .filter(function (item) {
            return item.direction === "OUT";
          })
          .map(function (item) {
            return {
              ingredientId: item.ingredientId,
              ingredientName: item.ingredientName,
              stockUnit: item.stockUnit,
              quantity: item.quantity,
            };
          }),
        produced: recordItems
          .filter(function (item) {
            return item.direction === "PRODUCED";
          })
          .map(function (item) {
            return {
              ingredientId: item.ingredientId,
              ingredientName: item.ingredientName,
              stockUnit: item.stockUnit,
              quantity: item.quantity,
            };
          }),
      };
    }),
    wasteEntries: wasteRows,
  };
}

export const getDashboardOverview = createServerFn({ method: "GET" })
  .validator((data: DashboardQuery) => dashboardQuerySchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    return getDashboardOverviewCore(user, data);
  });

export const getDashboardDetails = createServerFn({ method: "GET" })
  .validator((data: DashboardQuery) => dashboardQuerySchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    return getDashboardDetailsCore(user, data);
  });
