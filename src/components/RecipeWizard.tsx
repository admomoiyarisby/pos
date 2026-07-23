import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Badge } from "#/components/ui/badge";
import MoneyInput from "#/components/MoneyInput";
import { getIngredients } from "#/lib/server/ingredients";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Search,
  Trash2,
  X,
  Plus,
  Package,
  Zap,
} from "lucide-react";

// Types
export interface WizardData {
  code: string;
  name: string;
  category: string;
  basePrice: number;
  brandIds: string[];
  ingredients: { ingredientId: string; quantity: number }[];
  branchIds: string[];
  isBOGO: boolean;
  modifierGroupIds: string[];
  isBundling: boolean;
  childRecipes: { recipeId: string; quantity: number }[];
}

interface IngredientOption {
  id: string;
  code: string;
  name: string;
  category: "Fresh" | "Dry" | "Packaging";
  skuType: "RM" | "SFG" | "FG";
  purchaseUnit: string;
  stockUnit: string;
  conversionFactor: number;
  averageCost: number;
}

interface SelectedIngredient {
  ingredient: IngredientOption;
  quantity: number;
  ingredientId?: string; // For edit mode when ingredient data isn't loaded yet
}

interface RecipeOption {
  id: string;
  name: string;
  isSubRecipe: boolean;
}

interface BrandOption {
  id: string;
  name: string | null;
}

interface BranchOption {
  id: string;
  name: string;
}

interface ModifierGroupOption {
  id: string;
  name: string;
  minSelection: number;
  modifiers?: { id: string; name: string; price: number; isExclusion: boolean }[];
}

interface RecipeWizardProps {
  // Initial data for edit mode
  initialData?: Partial<WizardData>;
  // Available options
  brands: BrandOption[];
  branches: BranchOption[];
  modifierGroups: ModifierGroupOption[];
  recipes: RecipeOption[];
  // Callbacks
  onSubmit: (data: WizardData) => void;
  /** Edit-mode only: persist just the current step's fields (partial update), staying in the wizard. */
  onSavePage?: (partial: Partial<WizardData>) => void;
  /** When true (edit mode), every step shows a per-page "Simpan" button instead of the final submit. */
  isEditMode?: boolean;
  onCancel: () => void;
  isPending?: boolean;
  submitLabel?: string;
}

const steps = [
  { label: "Info Dasar", description: "Kode, nama, kategori, harga" },
  { label: "Bahan Baku", description: "Pilih bahan dan takaran" },
  { label: "Ketersediaan", description: "Pilihan cabang" },
  { label: "Opsi Lanjutan", description: "Bundling, BOGO, modifier" },
];

export function RecipeWizard({
  initialData,
  brands,
  branches,
  modifierGroups,
  recipes,
  onSubmit,
  onSavePage,
  isEditMode = false,
  onCancel,
  isPending = false,
  submitLabel = "Tambah",
}: RecipeWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [code, setCode] = useState(initialData?.code ?? "");
  const [name, setName] = useState(initialData?.name ?? "");
  const [category, setCategory] = useState(initialData?.category ?? "makanan");
  const [basePrice, setBasePrice] = useState(initialData?.basePrice ?? 0);
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>(initialData?.brandIds ?? []);
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [selectedIngredients, setSelectedIngredients] = useState<SelectedIngredient[]>(
    initialData?.ingredients?.map((si) => ({
      ingredient: {} as IngredientOption, // Will be populated from query
      quantity: si.quantity,
      ingredientId: si.ingredientId,
    })) ?? [],
  );
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>(
    initialData?.branchIds ?? [],
  );
  const [isBOGO, setIsBOGO] = useState(initialData?.isBOGO ?? false);
  const [linkedModifierGroupIds, setLinkedModifierGroupIds] = useState<string[]>(
    initialData?.modifierGroupIds ?? [],
  );
  const [isBundling, setIsBundling] = useState(initialData?.isBundling ?? false);
  const [childRecipes, setChildRecipes] = useState<{ recipeId: string; quantity: number }[]>(
    initialData?.childRecipes ?? [],
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Fetch ingredients
  const { data: allIngredients } = useQuery({
    queryKey: ["ingredients"],
    queryFn: () => getIngredients({ data: {} }),
  });

  // Filter ingredients based on search
  const filteredIngredients = (allIngredients ?? []).filter((ing: IngredientOption) => {
    const searchLower = ingredientSearch.toLowerCase();
    return (
      ing.name.toLowerCase().includes(searchLower) || ing.code.toLowerCase().includes(searchLower)
    );
  });

  // Populate selected ingredients with full data when available
  const enrichedSelectedIngredients = selectedIngredients.map((si) => {
    if (si.ingredient?.id) return si;
    const ingId = si.ingredientId ?? (si.ingredient as any)?.id;
    const fullIng = allIngredients?.find((i: IngredientOption) => i.id === ingId);
    return fullIng ? { ...si, ingredient: fullIng, ingredientId: ingId } : si;
  });

  const handleNext = () => {
    if (currentStep === 0) {
      if (!code.trim()) {
        // Simple validation - could add toast here
        return;
      }
      if (!name.trim()) return;
    }
    setCurrentStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const handleBack = () => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  };

  const handleSubmit = () => {
    const data: WizardData = {
      code,
      name,
      category,
      basePrice,
      brandIds: selectedBrandIds,
      ingredients: enrichedSelectedIngredients.map((si) => ({
        ingredientId: si.ingredient?.id ?? si.ingredientId,
        quantity: si.quantity,
      })),
      branchIds: selectedBranchIds,
      isBOGO,
      modifierGroupIds: linkedModifierGroupIds,
      isBundling,
      childRecipes,
    };
    onSubmit(data);
  };

  const handleSavePage = () => {
    if (!onSavePage) return;
    const patch: Partial<WizardData> =
      currentStep === 0
        ? { code, name, category, basePrice, brandIds: selectedBrandIds }
        : currentStep === 1
          ? {
              ingredients: enrichedSelectedIngredients.map((si) => ({
                ingredientId: si.ingredient?.id ?? si.ingredientId,
                quantity: si.quantity,
              })),
            }
          : currentStep === 2
            ? { branchIds: selectedBranchIds }
            : { isBOGO, modifierGroupIds: linkedModifierGroupIds, isBundling, childRecipes };
    onSavePage(patch);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
    }
  };

  const addIngredient = (ing: IngredientOption) => {
    if (selectedIngredients.some((si) => si.ingredient?.id === ing.id)) return;
    setSelectedIngredients([...selectedIngredients, { ingredient: ing, quantity: 1 }]);
  };

  const removeIngredient = (id: string) => {
    setSelectedIngredients(
      selectedIngredients.filter((si) => {
        const siId = si.ingredient?.id ?? si.ingredientId;
        return siId !== id;
      }),
    );
  };

  const updateIngredientQuantity = (id: string, quantity: number) => {
    setSelectedIngredients(
      selectedIngredients.map((si) => {
        const siId = si.ingredient?.id ?? si.ingredientId;
        return siId === id ? { ...si, quantity: Math.max(0, quantity) } : si;
      }),
    );
  };

  return (
    <div className="space-y-6">
      {/* Step Indicator */}
      <div className="mb-8">
        <div className="flex items-start justify-between">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-center flex-1 last:flex-none">
              <div className="flex items-center gap-3">
                <div
                  className={
                    "flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold transition-colors " +
                    (idx <= currentStep
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground")
                  }
                >
                  {idx < currentStep ? <Check className="h-5 w-5" /> : idx + 1}
                </div>
                <div className="hidden md:block">
                  <p className="text-sm font-semibold leading-tight">{step.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                </div>
              </div>
              {idx < steps.length - 1 && (
                <div
                  className={
                    "mx-4 h-0.5 flex-1 transition-colors mt-5 " +
                    (idx < currentStep ? "bg-primary" : "bg-border")
                  }
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <form ref={formRef} onKeyDown={handleKeyDown} className="space-y-5">
        {/* Step 1: Info Dasar */}
        {currentStep === 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Kode <span className="text-destructive">*</span>
                </label>
                <input
                  name="code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="Contoh: NGR-001"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Nama <span className="text-destructive">*</span>
                </label>
                <input
                  name="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="Contoh: Nasi Goreng Spesial"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  Kategori <span className="text-destructive">*</span>
                </Label>
                <select
                  name="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="makanan">Makanan</option>
                  <option value="minuman">Minuman</option>
                  <option value="snack">Snack</option>
                  <option value="add_ons">Add-on</option>
                  <option value="paket_bundle">Paket Bundle</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>
                  Harga Dasar <span className="text-destructive">*</span>
                </Label>
                <MoneyInput
                  value={basePrice}
                  onChange={(raw) => setBasePrice(raw ?? 0)}
                  required
                  className="h-10 md:h-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Brand</Label>
              <div className="flex flex-wrap gap-2">
                {brands.map((b) => (
                  <label
                    key={b.id}
                    className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedBrandIds.includes(b.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedBrandIds([...selectedBrandIds, b.id]);
                        } else {
                          setSelectedBrandIds(selectedBrandIds.filter((id) => id !== b.id));
                        }
                      }}
                      className="rounded border-gray-300"
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Bahan Baku */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <div>
              <Label>Bahan Baku</Label>
              <p className="text-sm text-muted-foreground mt-1">
                Pilih bahan dan tentukan takaran untuk resep ini.
              </p>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Cari bahan berdasarkan nama atau kode..."
                value={ingredientSearch}
                onChange={(e) => setIngredientSearch(e.target.value)}
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Available Ingredients List */}
              <div className="lg:col-span-2 space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  Bahan tersedia ({filteredIngredients.length})
                </p>
                <div className="rounded-lg border max-h-[320px] overflow-y-auto">
                  {filteredIngredients.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      {ingredientSearch ? "Bahan tidak ditemukan" : "Tidak ada bahan tersedia"}
                    </div>
                  ) : (
                    <div className="divide-y">
                      {filteredIngredients.map((ing: IngredientOption) => {
                        const isSelected = enrichedSelectedIngredients.some(
                          (si) => si.ingredient?.id === ing.id,
                        );
                        return (
                          <button
                            key={ing.id}
                            type="button"
                            onClick={() => addIngredient(ing)}
                            disabled={isSelected}
                            className={
                              "w-full flex items-center justify-between p-3 text-left text-sm transition-colors " +
                              (isSelected
                                ? "bg-muted/50 opacity-50 cursor-not-allowed"
                                : "hover:bg-muted/50 cursor-pointer")
                            }
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium truncate">{ing.name}</span>
                                <span className="text-xs text-muted-foreground">({ing.code})</span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-muted-foreground">
                                  {ing.purchaseUnit} → {ing.stockUnit} (x{ing.conversionFactor})
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  Rp {ing.averageCost.toLocaleString("id-ID")}/{ing.purchaseUnit}
                                </span>
                              </div>
                            </div>
                            {isSelected ? (
                              <Check className="h-4 w-4 text-primary shrink-0" />
                            ) : (
                              <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Selected Ingredients */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  Bahan dipilih ({enrichedSelectedIngredients.length})
                </p>
                <div className="rounded-lg border min-h-[100px] max-h-[320px] overflow-y-auto">
                  {enrichedSelectedIngredients.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      Klik bahan di sebelah kiri untuk menambahkan
                    </div>
                  ) : (
                    <div className="divide-y">
                      {enrichedSelectedIngredients.map((si) => (
                        <div key={si.ingredient?.id ?? si.ingredientId} className="p-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {si.ingredient?.name ?? "Loading..."}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {si.ingredient?.code} • {si.ingredient?.purchaseUnit}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeIngredient(si.ingredient?.id ?? si.ingredientId)}
                              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground whitespace-nowrap">
                              Takaran:
                            </Label>
                            <input
                              type="number"
                              min={0.1}
                              step={0.1}
                              value={si.quantity}
                              onChange={(e) =>
                                updateIngredientQuantity(
                                  si.ingredient?.id ?? si.ingredientId,
                                  Number(e.target.value),
                                )
                              }
                              className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
                            />
                            <span className="text-xs text-muted-foreground">
                              {si.ingredient?.stockUnit}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Summary */}
                {enrichedSelectedIngredients.length > 0 && (
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Ringkasan</p>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Total bahan</span>
                        <span className="font-medium">{enrichedSelectedIngredients.length}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Estimasi HPP</span>
                        <span className="font-medium">
                          Rp{" "}
                          {enrichedSelectedIngredients
                            .reduce(
                              (sum, si) => sum + (si.ingredient?.averageCost ?? 0) * si.quantity,
                              0,
                            )
                            .toLocaleString("id-ID")}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Ketersediaan */}
        {currentStep === 2 && (
          <div className="space-y-4">
            <div>
              <Label>Ketersediaan Cabang</Label>
              <p className="text-sm text-muted-foreground mt-1">
                Pilih di cabang mana menu ini tersedia.
              </p>
            </div>
            <div className="rounded-lg border p-4 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedBranchIds.length === 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedBranchIds([]);
                    } else {
                      setSelectedBranchIds(branches.map((b) => b.id));
                    }
                  }}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <div>
                  <span className="text-sm font-medium">Semua cabang</span>
                  <p className="text-xs text-muted-foreground">
                    Menu tersedia di semua cabang yang ada
                  </p>
                </div>
              </label>
            </div>
            {selectedBranchIds.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Pilih cabang:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {branches.map((b) => (
                    <label
                      key={b.id}
                      className="flex items-center gap-2 rounded-md border p-3 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedBranchIds.includes(b.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedBranchIds([...selectedBranchIds, b.id]);
                          } else {
                            setSelectedBranchIds(selectedBranchIds.filter((id) => id !== b.id));
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Opsi Lanjutan */}
        {currentStep === 3 && (
          <div className="space-y-4">
            {/* Bundling */}
            <div className="rounded-lg border p-4 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isBundling}
                  onChange={(e) => {
                    setIsBundling(e.target.checked);
                    if (!e.target.checked) setChildRecipes([]);
                  }}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <span className="text-sm font-medium">Bundling (Menu Paket)</span>
                    <p className="text-xs text-muted-foreground">
                      Gabungkan beberapa menu menjadi satu paket
                    </p>
                  </div>
                </div>
              </label>
              {isBundling && (
                <div className="ml-7 space-y-2 border-l-2 border-border pl-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setChildRecipes([...childRecipes, { recipeId: "", quantity: 1 }])
                    }
                  >
                    <Plus className="h-3 w-3 mr-1" /> Tambah Menu
                  </Button>
                  {childRecipes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Belum ada menu dalam paket.</p>
                  ) : (
                    <div className="space-y-2">
                      {childRecipes.map((cr, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <select
                            value={cr.recipeId}
                            onChange={(e) => {
                              const next = [...childRecipes];
                              next[i] = { ...next[i], recipeId: e.target.value };
                              setChildRecipes(next);
                            }}
                            className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                          >
                            <option value="">Pilih Menu</option>
                            {recipes
                              .filter((r) => !r.isSubRecipe)
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                          </select>
                          <Input
                            type="number"
                            min={1}
                            value={cr.quantity}
                            onChange={(e) => {
                              const next = [...childRecipes];
                              next[i] = { ...next[i], quantity: Number(e.target.value) };
                              setChildRecipes(next);
                            }}
                            className="w-20 h-9"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setChildRecipes(childRecipes.filter((_, j) => j !== i))}
                            className="min-h-[36px] min-w-[36px]"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* BOGO */}
            <div className="rounded-lg border p-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isBOGO}
                  onChange={(e) => setIsBOGO(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <span className="text-sm font-medium">BOGO (Beli 1 Gratis 1)</span>
                    <p className="text-xs text-muted-foreground">
                      Harga pelanggan tetap 1x, stok terpotong 2x
                    </p>
                  </div>
                </div>
              </label>
            </div>

            {/* Modifier Groups */}
            {modifierGroups.length > 0 && (
              <div className="rounded-lg border p-4 space-y-3">
                <div>
                  <Label>Grup Modifier</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Pilih opsi tambahan yang tersedia untuk menu ini
                  </p>
                </div>
                <div className="space-y-2">
                  {modifierGroups.map((g) => {
                    const checked = linkedModifierGroupIds.includes(g.id);
                    return (
                      <label
                        key={g.id}
                        className="flex items-center gap-3 cursor-pointer rounded-md border p-3 hover:bg-muted/50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setLinkedModifierGroupIds([...linkedModifierGroupIds, g.id]);
                            } else {
                              setLinkedModifierGroupIds(
                                linkedModifierGroupIds.filter((id) => id !== g.id),
                              );
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium">{g.name}</span>
                          <Badge variant={g.minSelection > 0 ? "default" : "secondary"}>
                            {g.minSelection > 0 ? "wajib" : "opsional"}
                          </Badge>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between pt-4 border-t">
          <Button type="button" variant="outline" onClick={onCancel}>
            Batal
          </Button>
          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <Button type="button" variant="outline" onClick={handleBack}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Kembali
              </Button>
            )}
            {isEditMode ? (
              <Button type="button" onClick={handleSavePage} disabled={isPending}>
                <Check className="h-4 w-4 mr-1" />
                {isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            ) : currentStep < steps.length - 1 ? (
              <Button type="button" onClick={handleNext}>
                Selanjutnya
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button type="button" onClick={handleSubmit} disabled={isPending}>
                <Check className="h-4 w-4 mr-1" />
                {isPending ? "Menyimpan..." : submitLabel}
              </Button>
            )}

            {isEditMode && currentStep < steps.length - 1 && (
              <Button type="button" onClick={handleNext}>
                Selanjutnya
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
