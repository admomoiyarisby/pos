// @vitest-environment jsdom
// Regression probe: do BOM quantity edits reach the onSavePage payload?
// Client report: "the item on the BOM page cannot be edited / unchanged when edited".
import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { RecipeWizard } from "#/components/RecipeWizard";

const { mockIngs, useQueryMock } = vi.hoisted(() => {
  const mockIngs = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      code: "ING-1",
      name: "Air",
      category: "Fresh",
      skuType: "RM",
      purchaseUnit: "gr",
      stockUnit: "gr",
      conversionFactor: 1,
      averageCost: 100,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      code: "ING-2",
      name: "Beras",
      category: "Dry",
      skuType: "RM",
      purchaseUnit: "gr",
      stockUnit: "gr",
      conversionFactor: 1,
      averageCost: 200,
    },
  ];
  const useQueryMock = vi.fn();
  return { mockIngs, useQueryMock };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("#/lib/server/ingredients", () => ({
  getIngredients: vi.fn(async () => mockIngs),
}));

afterEach(() => {
  cleanup();
  useQueryMock.mockReset();
});

function renderWizard(
  onSavePage = vi.fn(),
  opts: { isEditMode?: boolean; onCancel?: () => void } = {},
) {
  useQueryMock.mockReturnValue({ data: mockIngs });
  render(
    <RecipeWizard
      initialData={{
        code: "REC-TEST",
        name: "Test Menu",
        categoryId: "cat-makanan",
        basePrice: 10000,
        brandIds: [],
        ingredients: [{ ingredientId: mockIngs[0].id, quantity: 2 }],
        branchIds: [],
        isBOGO: false,
        modifierGroupIds: [],
        isBundling: false,
        childRecipes: [],
      }}
      brands={[]}
      branches={[]}
      modifierGroups={[]}
      recipes={[]}
      onSubmit={vi.fn()}
      onSavePage={onSavePage}
      isEditMode={opts.isEditMode ?? true}
      onCancel={opts.onCancel ?? vi.fn()}
    />,
  );
}

// Clicks that trigger an async save flow must flush microtasks (the save
// resolves before navigation happens), so wrap them in act.
async function click(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
}

const stepZeroPatch = {
  code: "REC-TEST",
  name: "Test Menu",
  alias: null,
  categoryId: "cat-makanan",
  basePrice: 10000,
  brandIds: [],
};

describe("RecipeWizard BOM save (edit mode)", () => {
  it("sends the edited quantity in the onSavePage payload", async () => {
    const onSavePage = vi.fn();
    renderWizard(onSavePage);

    // Step 0 → step 1 (Bahan Baku). In edit mode this also saves step 0 first.
    await click(screen.getByRole("button", { name: /selanjutnya/i }));
    expect(onSavePage).toHaveBeenNthCalledWith(1, stepZeroPatch);

    // The selected ingredient's quantity input starts at 2
    const qtyInput = screen.getByRole<HTMLInputElement>("spinbutton");
    expect(qtyInput.value).toBe("2");

    // Edit quantity 2 → 5
    fireEvent.change(qtyInput, { target: { value: "5" } });
    expect(screen.getByRole<HTMLInputElement>("spinbutton").value).toBe("5");

    // Save the page
    await click(screen.getByRole("button", { name: /simpan/i }));

    expect(onSavePage).toHaveBeenCalledTimes(2);
    expect(onSavePage).toHaveBeenLastCalledWith({
      ingredients: [{ ingredientId: mockIngs[0].id, quantity: 5 }],
    });
  });

  it("sends an empty ingredients array when nothing is selected", async () => {
    const onSavePage = vi.fn();
    useQueryMock.mockReturnValue({ data: mockIngs });
    render(
      <RecipeWizard
        initialData={{
          code: "REC-TEST",
          name: "Test Menu",
          categoryId: "cat-makanan",
          basePrice: 10000,
          brandIds: [],
          ingredients: [],
          branchIds: [],
          isBOGO: false,
          modifierGroupIds: [],
          isBundling: false,
          childRecipes: [],
        }}
        brands={[]}
        branches={[]}
        modifierGroups={[]}
        recipes={[]}
        onSubmit={vi.fn()}
        onSavePage={onSavePage}
        isEditMode
        onCancel={vi.fn()}
      />,
    );
    await click(screen.getByRole("button", { name: /selanjutnya/i }));
    await click(screen.getByRole("button", { name: /simpan/i }));
    expect(onSavePage).toHaveBeenLastCalledWith({ ingredients: [] });
  });

  it("persists the current step before advancing via Selanjutnya", async () => {
    const onSavePage = vi.fn();
    renderWizard(onSavePage);

    // Change the name on step 0, then click Selanjutnya
    fireEvent.change(screen.getByPlaceholderText(/contoh: nasi goreng spesial/i), {
      target: { value: "Nama Baru" },
    });
    await click(screen.getByRole("button", { name: /selanjutnya/i }));

    expect(onSavePage).toHaveBeenCalledWith({
      ...stepZeroPatch,
      name: "Nama Baru",
    });
    // Advanced to step 1 (Bahan Baku)
    expect(screen.getByRole("spinbutton")).toBeTruthy();
  });

  it("persists the current step before exiting via Batal", async () => {
    const onSavePage = vi.fn();
    const onCancel = vi.fn();
    renderWizard(onSavePage, { onCancel });

    await click(screen.getByRole("button", { name: /selanjutnya/i }));

    // Edit the quantity, then click Batal
    fireEvent.change(screen.getByRole<HTMLInputElement>("spinbutton"), {
      target: { value: "9" },
    });
    await click(screen.getByRole("button", { name: /batal/i }));

    expect(onSavePage).toHaveBeenLastCalledWith({
      ingredients: [{ ingredientId: mockIngs[0].id, quantity: 9 }],
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not advance when the step save fails", async () => {
    const onSavePage = vi.fn().mockRejectedValue(new Error("server rejected"));
    const onCancel = vi.fn();
    renderWizard(onSavePage, { onCancel });

    await click(screen.getByRole("button", { name: /selanjutnya/i }));

    // Still on step 0: the name input is present, no BOM quantity input yet,
    // and cancel was not called.
    expect(screen.getByPlaceholderText(/contoh: nasi goreng spesial/i)).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("RecipeWizard create mode (no per-step save)", () => {
  it("does not call onSavePage when navigating", async () => {
    const onSavePage = vi.fn();
    renderWizard(onSavePage, { isEditMode: false });

    await click(screen.getByRole("button", { name: /selanjutnya/i }));

    expect(onSavePage).not.toHaveBeenCalled();
    expect(screen.getByRole("spinbutton")).toBeTruthy();
  });
});
