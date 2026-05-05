# Dashboard Page Implementation Plan

## Goal

Port the prototype's `DashboardView` into `src/routes/_layout/dashboard.tsx`. The dashboard is a rich analytics overview page that conditionally renders sections based on user role (`super_admin` vs `branch_admin`).

## Current State

`src/routes/_layout/dashboard.tsx` is a skeleton:

```tsx
function DashboardPage() {
  usePageTitle("Dashboard", "Analytics & overview akan ditampilkan di sini.");
  return (
    <RoleGuard allowedRoles={["super_admin"]}">
      <div>Dashboard content will appear here.</div>
    </RoleGuard>
  );
}
```

## Prototype Reference

The prototype's `DashboardView` (lines ~2410–3350 in `../omoiyari_pos/src/App.tsx`) renders the following sections top-to-bottom:

### 1. Stats Cards (all roles)

A 4-column grid (3 visible cards in prototype):

| Card                   | Value                  | Style                                 |
| ---------------------- | ---------------------- | ------------------------------------- |
| **Penjualan Hari Ini** | `stats.totalSales`     | `bg-emerald-600 text-white`           |
| **Pesanan Selesai**    | `stats.completedCount` | White card, blue icon, random % badge |
| **Pesanan Dibatalkan** | `stats.voidCount`      | White card, rose icon, void badge     |

**Logic**: Filter orders by `profile.role === 'branch_admin'` → `branchId`. Also include `manualRevenues` for today. Anomaly detection:

- Void rate > 10% → warning
- Any inventory item qty < 100 → stock alert error

### 2. COGS Analysis Table (`super_admin` only)

Full-width table: Menu Item | Harga Jual | COGS Est. | Margin | Food Cost % | Status

**COGS calculation per recipe**:

```
for each recipe.ingredient:
  ingredient = find by ingredientId
  costPerStockUnit = ingredient.averageCost / ingredient.conversionFactor
  cogs += ri.quantity * costPerStockUnit
margin = basePrice - cogs
cogsPercentage = (cogs / basePrice) * 100
alert = cogsPercentage > 70
```

Render a progress bar for food cost %, color-coded:

- `> 70%` → rose (HIGH COGS alert with pulse animation)
- `> 50%` → amber
- else → emerald (HEALTHY)

### 3. Anomaly Alerts (all roles, conditional)

Grid of alert cards. Types:

- **Void Anomaly**: `voidCount > todayOrders.length * 0.1 && todayOrders.length > 5`
- **Stock Alert**: Any inventory item qty < 100

Style: `bg-amber-50` for warning, `bg-rose-50` for error.

### 4. ROP/ROQ Recommendations (`branch_admin` only)

Table: Bahan Baku | Avg Daily Usage | ROP | Stok Saat Ini | Saran Order (ROQ) | Status

**Algorithm**:

1. Filter completed orders for last 7 days in this branch
2. For each order item, resolve recipe → ingredients, accumulate usage by ingredientId
3. `avgDailyUsage = totalUsed / 7`
4. `rop = avgDailyUsage * 5`
5. `targetStock = avgDailyUsage * 10`
6. `roq = currentStock < rop ? max(0, targetStock - currentStock) : 0`
7. Show items where `rop > 0 || currentStock < 100`

Status: REORDER NOW (rose badge) or SAFE (emerald badge).

### 5. Charts Row 1 (2-column)

#### 5a. Sales Trend (7 Days) — AreaChart

- X: day names (`Sen`, `Sel`, `Rab`, ...)
- Y: sales in thousands (Rp)
- Fill gradient from emerald `#10b981`
- Tooltip + CartesianGrid

#### 5b. Channel Distribution — PieChart

- Donut chart (`innerRadius={60}, outerRadius={100}`)
- Data from `platformFees` channels
- `CHANNEL_COLORS` array for segments
- Legend below with dot + name + count

### 6. Charts Row 2 (2-column) — `super_admin` only

#### 6a. Penjualan per Cabang — BarChart

- Data: `salesByBranch` = for each branch, sum of completed order totals + manual revenues
- X: branch name, Y: revenue
- Bar fill `#059669`

#### 6b. Brand Performance — BarChart

- Data: `salesByBrand` = aggregate by brandId from completed orders + manual revenue brandBreakdowns
- X: brand name, Y: revenue
- Bar fill `#3b82f6`

### 7. HPP Monitoring Alert (`super_admin` only)

Card showing recipes with `hppPercentage < 40%` (high margin). Each card:

- Recipe name + HPP % badge
- COGS vs Price in small text

If none: "Tidak ada menu dengan HPP < 40%."

### 8. Discrepancy Report (`super_admin` only)

Table from `stockOpnames` items where `|variancePercentage| > 3%`.
Columns: Bahan Baku | Cabang | Variance %

Filtered by role:

- `branch_admin`: only their branch
- `area_manager`: only assigned branches

### 9. Waste Loss Report (`super_admin` only)

Table: Bahan Baku | Qty Waste | Estimasi Rugi
Loss = `waste.quantity * (ingredient.averageCost / ingredient.conversionFactor)`
Sorted by lossAmount desc, top 10.

### 10. Order History (all roles)

Full-width table: ID Pesanan | Waktu | Cabang (super_admin) | Channel | Menu | Total | Status

**Cancel actions** (conditional):

- Non-Void/Completed/Cancel-Requested orders + `isWriteAllowed` → "Request Cancel" button → opens reason modal
- `Cancel Requested` orders + `area_manager`/`super_admin` + `isWriteAllowed` → "Tolak" / "Setujui" buttons

**Approve cancel logic** (complex — see prototype lines ~3070–3170):
On approve, return all recipe ingredients (recursive for child recipes) to inventory, create stock ledger IN entries, and also return modifier ingredients. This requires:

- Recursive `returnRecipeIngredientsRecursive(recipe, orderQuantity, currentInv, parentName?)`
- Handle BOGO multiplier (`recipe.isBOGO && !childRecipes` → qty \* 2)
- Create ledger entries with `type: 'IN'`
- Call `onOrderCancelApproved(order.id, updatedInventory, newLedgerEntries)`

---

## Data Requirements

### Already available via existing server functions

| Data            | Server Function     | Notes                             |
| --------------- | ------------------- | --------------------------------- |
| Orders          | `getOrders`         | Returns orders with items         |
| Inventory       | `getInventory`      | Returns inventory records         |
| Recipes         | `getRecipes`        | Returns recipes with ingredients  |
| Ingredients     | `getIngredients`    | Returns ingredient master         |
| Branches        | `getBranches`       | Returns branch list               |
| Brands          | `getBrands`         | Returns brand list                |
| Platform Fees   | `getPlatformFees`   | Returns fee config per channel    |
| Stock Opnames   | `getStockOpnames`   | Returns SO with items             |
| Waste Entries   | `getWasteEntries`   | Returns waste records             |
| Manual Revenues | `getManualRevenues` | Returns revenue + brandBreakdowns |

### Potentially missing — verify before implementing

| Data                        | Check                             | Action if missing                                                        |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `getManualRevenues`         | Check `src/lib/server/finance.ts` | Add if missing                                                           |
| `getWasteEntries`           | Check `src/lib/server/waste.ts`   | Add if missing                                                           |
| Order cancel server actions | Check `src/lib/server/pos.ts`     | May need `requestOrderCancel`, `approveOrderCancel`, `rejectOrderCancel` |

---

## Component Breakdown

The dashboard is large. Break it into sub-components in `src/components/dashboard/`:

| Component               | Props                                                                        | Responsibility                                    |
| ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| `StatsCards`            | `orders`, `inventory`, `manualRevenues`, `user`                              | Today's sales, completed, void, anomaly detection |
| `CogsAnalysisTable`     | `recipes`, `ingredients`                                                     | COGS per recipe with progress bars                |
| `AnomalyAlerts`         | `anomalies: Anomaly[]`                                                       | Render alert cards                                |
| `RopRoqTable`           | `orders`, `recipes`, `ingredients`, `inventory`, `branchId`                  | ROP/ROQ recommendations                           |
| `SalesTrendChart`       | `orders`                                                                     | 7-day area chart                                  |
| `ChannelPieChart`       | `orders`, `platformFees`                                                     | Donut chart by channel                            |
| `SalesByBranchChart`    | `orders`, `branches`, `manualRevenues`                                       | Bar chart                                         |
| `BrandPerformanceChart` | `orders`, `brands`, `manualRevenues`                                         | Bar chart                                         |
| `HppAlertCards`         | `recipes`, `ingredients`                                                     | High-margin recipe cards                          |
| `DiscrepancyTable`      | `stockOpnames`, `ingredients`, `branches`, `user`                            | SO variance > 3%                                  |
| `WasteLossTable`        | `wasteEntries`, `ingredients`                                                | Top 10 waste losses                               |
| `OrderHistoryTable`     | `orders`, `recipes`, `branches`, `user`, `onCancel`, `onApprove`, `onReject` | Full order list with cancel actions               |
| `CancelOrderModal`      | `orderId`, `onSubmit`, `onClose`                                             | Reason selection modal                            |

---

## Styling Guide

Use the project's existing Tailwind + shadcn design system. Do NOT import the prototype's custom `Card` or `Badge`. Use:

- **Cards**: `rounded-lg border bg-card p-4 shadow-sm`
- **Tables**: `w-full text-left border-collapse` with `border-b` rows
- **Badges**: Use existing `Badge` component from `#/components/ui/badge` — map prototype's `variant="success"`/`"error"`/`"warning"` to your variant names
- **Icons**: `lucide-react` — `DollarSign`, `TrendingUp`, `ShoppingCart`, `XCircle`, `AlertTriangle`, `CheckCircle2`, `RefreshCw`
- **Charts**: `recharts` — `AreaChart`, `PieChart`, `BarChart`, `ResponsiveContainer`, etc. (already in dependencies)
- **Colors**: Use Tailwind semantic colors (`emerald-*`, `rose-*`, `amber-*`, `blue-*`, `slate-*`) not CSS variables from prototype

---

## Implementation Order

1. **Verify data layer** — Ensure `getManualRevenues`, `getWasteEntries`, and order cancel actions exist. Add missing server functions.
2. **Create `src/components/dashboard/`** directory
3. **Build components bottom-up**:
   - `StatsCards` (simplest, no charts)
   - `CogsAnalysisTable`
   - `AnomalyAlerts`
   - `RopRoqTable`
   - Chart components (SalesTrend, ChannelPie, SalesByBranch, BrandPerformance)
   - `HppAlertCards`
   - `DiscrepancyTable`
   - `WasteLossTable`
   - `OrderHistoryTable` + `CancelOrderModal`
4. **Compose in `dashboard.tsx`** — Assemble all sections with role guards
5. **Test** — Verify with seeded data, check both super_admin and branch_admin views

---

## Notes

- **Role gating**: The prototype uses `profile.role === 'super_admin'` and `profile.role === 'branch_admin'`. The current auth context exposes `user.role` as `UserRole` enum. Use `useAuth()` hook.
- **Date filtering**: The prototype uses `date-fns` (`subDays`, `startOfDay`, `isSameDay`, `format`). This project does not have `date-fns`. Implement equivalents with native `Date` or add `date-fns` as a dependency (prefer native to avoid adding deps).
- **Cancel logic complexity**: The recursive ingredient return on cancel approval is the most complex part. It requires traversing `recipe.childRecipes` recursively. Consider extracting this into `src/lib/server/pos.ts` as a server function rather than doing it client-side.
- **Performance**: The dashboard computes many `useMemo` values. Keep this pattern. Use React Query's `useQuery` for data fetching with appropriate `staleTime`.
