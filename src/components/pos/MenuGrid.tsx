// ============================================================
// Menu Grid Component
// ============================================================

import { Search, Plus, Zap, Package } from "lucide-react";
import { Badge } from "#/components/ui/badge";
import type { MenuItem } from "#/lib/pos-types";

interface MenuGridProps {
  menuItems: MenuItem[];
  onAddToCart: (item: MenuItem) => void;
  getStockQuantity: (item: MenuItem) => number;
  cart: { recipeId: string; quantity: number }[];
  selectedBrandId: string;
  selectedCategory: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onCategoryChange: (category: string) => void;
  onBrandChange: (brandId: string) => void;
  categories: { key: string; label: string }[];
  brands: { id: string; name: string }[];
  cartTotal: number;
  voucherDiscount: number;
  taxAmount: number;
  finalTotal: number;
  ppnEnabled: boolean;
  pb1Rate: number;
  channel: string;
  isDineIn: boolean;
}

// Sections are keyed by the categories-table FK (recipes.category_id), the same
// key the filter tabs use, so staff meals etc. group under their real category.
function groupByCategory(items: MenuItem[]): Map<string, MenuItem[]> {
  const groups = new Map<string, MenuItem[]>();
  for (const item of items) {
    const cat = item.categoryId || "other";
    const group = groups.get(cat) ?? [];
    group.push(item);
    groups.set(cat, group);
  }
  // Sort each group alphabetically
  for (const group of groups.values()) {
    group.sort((a, b) => a.name.localeCompare(b.name));
  }
  return groups;
}

// Order sections to match the filter-tab order (the categories prop, minus the
// empty-keyed "Semua" tab), then any categories not in the tabs (e.g. recipes
// with a null/dangling category_id) sorted by key.
function getOrderedCategories(
  groups: Map<string, MenuItem[]>,
  categoryTabs: { key: string; label: string }[],
): string[] {
  const keys = Array.from(groups.keys());
  const tabKeys = categoryTabs.map((c) => c.key).filter((k) => k !== "");
  const known = tabKeys.filter((k) => keys.includes(k));
  const unknown = keys.filter((k) => !known.includes(k)).sort();
  return [...known, ...unknown];
}

function MenuCard({
  item,
  onAddToCart,
  stockQty,
  inCartCount,
}: {
  item: MenuItem;
  onAddToCart: (item: MenuItem) => void;
  stockQty: number;
  inCartCount: number;
}) {
  let isOutOfStock = stockQty <= inCartCount;
  return (
    <button
      onClick={function () {
        onAddToCart(item);
      }}
      disabled={isOutOfStock && item.ingredientIds.length > 0}
      className="group relative rounded-lg border bg-card p-3 text-left transition-all hover:border-primary hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isOutOfStock && item.ingredientIds.length > 0 && (
        <div className="absolute inset-0 bg-neutral-950/40 rounded-lg flex items-center justify-center z-10">
          <span className="text-white text-xs font-bold tracking-wider">HABIS</span>
        </div>
      )}
      <div className="aspect-square mb-2 rounded-md bg-muted flex items-center justify-center relative overflow-hidden">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.name}
            className="h-full w-full object-cover rounded-md"
          />
        ) : (
          <span className="text-2xl" />
        )}
        {/* + button overlay — visible on hover (desktop) and always (touch) */}
        <div className="absolute bottom-1.5 right-1.5 h-7 w-7 sm:h-7 sm:w-7 md:h-8 md:w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity shadow-lg pointer-events-none md:opacity-0 md:group-hover:opacity-100 max-md:opacity-100">
          <Plus className="h-4 w-4" />
        </div>
      </div>
      <p className="text-sm font-medium leading-tight line-clamp-2">{item.name}</p>
      <div className="flex gap-1 mt-0.5 flex-wrap">
        {item.isBOGO && (
          <Badge variant="warning" className="text-[9px] gap-0.5 px-1 py-0">
            <Zap className="h-2.5 w-2.5" /> BOGO
          </Badge>
        )}
        {item.isBundle && (
          <Badge
            variant="outline"
            className="text-[9px] gap-0.5 px-1 py-0 border-info text-info-foreground bg-info/10"
          >
            <Package className="h-2.5 w-2.5" /> Paket
          </Badge>
        )}
      </div>
      <p className="text-sm font-semibold text-primary mt-1">
        Rp {item.basePrice.toLocaleString("id-ID")}
      </p>
      {item.modifierGroups.length > 0 && (
        <Badge variant="outline" className="mt-1 text-[10px]">
          + {item.modifierGroups.length} Modifiers
        </Badge>
      )}
    </button>
  );
}

export default function MenuGrid({
  menuItems,
  onAddToCart,
  getStockQuantity,
  cart,
  selectedBrandId,
  selectedCategory,
  searchQuery,
  onSearchChange,
  onCategoryChange,
  onBrandChange,
  categories,
  brands,
}: MenuGridProps) {
  const groups = groupByCategory(menuItems);
  const orderedCategories = getOrderedCategories(groups, categories);

  // Build a label lookup from the categories prop + fallbacks
  const labelLookup: Record<string, string> = {};
  for (const c of categories) {
    labelLookup[c.key] = c.label;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Brand Tabs */}
      <div className="flex gap-2 mb-3 shrink-0 overflow-x-auto">
        <button
          onClick={function () {
            onBrandChange("");
          }}
          aria-label="Tampilkan semua brand"
          className={
            "h-9 px-4 rounded-full text-sm font-medium whitespace-nowrap transition-colors " +
            (selectedBrandId === ""
              ? "bg-primary text-primary-foreground"
              : "border hover:bg-muted")
          }
        >
          Semua Brand
        </button>
        {brands.map(function (b) {
          return (
            <button
              key={b.id}
              onClick={function () {
                onBrandChange(b.id);
              }}
              aria-label={`Filter brand: ${b.name}`}
              className={
                "h-9 px-4 rounded-full text-sm font-medium whitespace-nowrap transition-colors " +
                (selectedBrandId === b.id
                  ? "bg-primary text-primary-foreground"
                  : "border hover:bg-muted")
              }
            >
              {b.name}
            </button>
          );
        })}
      </div>

      {/* Category + Search */}
      <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {categories.map(function (cat) {
            return (
              <button
                key={cat.key}
                onClick={function () {
                  onCategoryChange(cat.key);
                }}
                aria-label={`Kategori: ${cat.label}`}
                className={
                  "h-8 px-3 rounded-md text-xs font-medium transition-colors " +
                  (selectedCategory === cat.key
                    ? "bg-secondary text-secondary-foreground"
                    : "border hover:bg-muted")
                }
              >
                {cat.label}
              </button>
            );
          })}
        </div>
        <div className="relative flex-1 max-w-xs ml-auto">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Cari menu..."
            value={searchQuery}
            onChange={function (e) {
              onSearchChange(e.target.value);
            }}
            aria-label="Cari menu"
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm"
          />
        </div>
      </div>

      {/* Menu Sections by Category */}
      {menuItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
          <Search className="h-8 w-8 mb-2 opacity-50" />
          <p className="text-sm">Menu tidak ditemukan</p>
        </div>
      ) : (
        <div className="space-y-6">
          {orderedCategories.map(function (catKey) {
            const items = groups.get(catKey)!;
            const label = labelLookup[catKey] ?? (catKey === "other" ? "Lainnya" : catKey);
            return (
              <div key={catKey}>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {label}
                  <span className="ml-2 text-xs font-normal text-muted-foreground/60">
                    ({items.length})
                  </span>
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {items.map(function (item) {
                    let stockQty = getStockQuantity(item);
                    let inCartCount = cart
                      .filter(function (c) {
                        return c.recipeId === item.id;
                      })
                      .reduce(function (s, c) {
                        return s + c.quantity;
                      }, 0);
                    return (
                      <MenuCard
                        key={item.id}
                        item={item}
                        onAddToCart={onAddToCart}
                        stockQty={stockQty}
                        inCartCount={inCartCount}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
