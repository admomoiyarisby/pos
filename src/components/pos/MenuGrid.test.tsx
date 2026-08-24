// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MenuGrid from "#/components/pos/MenuGrid";
import type { MenuItem } from "#/lib/pos-types";

vi.mock("#/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const item = (overrides: Partial<MenuItem> = {}): MenuItem => ({
  id: "recipe-1",
  code: "REC-1",
  name: "Nasi Goreng",
  imageUrl: null,
  categoryName: "Makanan",
  categoryId: "cat-food",
  basePrice: 15000,
  isBOGO: false,
  isStaffMeal: false,
  isBundle: false,
  brands: [],
  modifierGroups: [],
  ingredientIds: [],
  ...overrides,
});

function renderMenu(menuItems: MenuItem[] = [item()]) {
  const onAddToCart = vi.fn();
  const onSearchChange = vi.fn();
  const onCategoryChange = vi.fn();
  const onBrandChange = vi.fn();
  render(
    <MenuGrid
      menuItems={menuItems}
      onAddToCart={onAddToCart}
      getStockQuantity={() => 5}
      cart={[]}
      selectedBrandId=""
      selectedCategory=""
      searchQuery=""
      onSearchChange={onSearchChange}
      onCategoryChange={onCategoryChange}
      onBrandChange={onBrandChange}
      categories={[
        { key: "", label: "Semua" },
        { key: "cat-food", label: "Makanan" },
        { key: "cat-drink", label: "Minuman" },
      ]}
      brands={[{ id: "brand-1", name: "Omoiyari" }]}
      cartTotal={0}
      voucherDiscount={0}
      taxAmount={0}
      finalTotal={0}
      ppnEnabled={false}
      pb1Rate={11}
      channel="Dine-in"
      isDineIn
    />,
  );
  return { onAddToCart, onSearchChange, onCategoryChange, onBrandChange };
}

afterEach(cleanup);

describe("MenuGrid", () => {
  it("renders recipes in category order and sorts recipes within a category", () => {
    renderMenu([
      item({ id: "recipe-2", name: "Zest", categoryId: "cat-food" }),
      item({ id: "recipe-3", name: "Aroma", categoryId: "cat-food" }),
      item({ id: "recipe-4", name: "Tea", categoryId: "cat-drink", categoryName: "Minuman" }),
    ]);

    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual(["Makanan(2)", "Minuman(1)"]);
    const buttons = screen.getAllByRole("button", { name: /Aroma|Zest|Tea/ });
    expect(buttons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Aroma"),
      expect.stringContaining("Zest"),
      expect.stringContaining("Tea"),
    ]);
  });

  it("disables a recipe when its stock is fully in the cart", () => {
    const menuItem = item({
      ingredientIds: [{ ingredientId: "ing-1", quantity: 1 }],
    });
    render(
      <MenuGrid
        menuItems={[menuItem]}
        onAddToCart={vi.fn()}
        getStockQuantity={() => 2}
        cart={[{ recipeId: menuItem.id, quantity: 2 }]}
        selectedBrandId=""
        selectedCategory=""
        searchQuery=""
        onSearchChange={vi.fn()}
        onCategoryChange={vi.fn()}
        onBrandChange={vi.fn()}
        categories={[{ key: "cat-food", label: "Makanan" }]}
        brands={[]}
        cartTotal={0}
        voucherDiscount={0}
        taxAmount={0}
        finalTotal={0}
        ppnEnabled={false}
        pb1Rate={11}
        channel="Dine-in"
        isDineIn
      />,
    );
    expect(screen.getByRole("button", { name: /Nasi Goreng/ })).toHaveProperty("disabled", true);
    expect(screen.getByText("HABIS")).toBeTruthy();
  });

  it("sends search, category, and brand changes to their callbacks", () => {
    const { onSearchChange, onCategoryChange, onBrandChange } = renderMenu();

    fireEvent.change(screen.getByRole("textbox", { name: "Cari menu" }), {
      target: { value: "nasi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kategori: Makanan" }));
    fireEvent.click(screen.getByRole("button", { name: "Filter brand: Omoiyari" }));

    expect(onSearchChange).toHaveBeenCalledWith("nasi");
    expect(onCategoryChange).toHaveBeenCalledWith("cat-food");
    expect(onBrandChange).toHaveBeenCalledWith("brand-1");
  });
});
