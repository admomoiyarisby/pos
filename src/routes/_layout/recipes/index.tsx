import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { toast } from "sonner";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getRecipes, createRecipe, recalculateAllRecipeCosts } from "#/lib/server/recipes";
import { getBrands } from "#/lib/server/brands";
import { getBranches } from "#/lib/server/branches";
import { getModifierGroups } from "#/lib/server/modifier-groups";
import { useAuth } from "#/lib/auth-context";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";

import { Label } from "#/components/ui/label";
import {
  ArrowRight,
  RefreshCw,
  Zap,
  Package,
  X,
  Plus,
  ChevronLeft,
  ChevronRight,
  Check,
} from "lucide-react";

interface RecipeRow {
  id: string;
  code: string;
  name: string;
  category: string;
  isSubRecipe: boolean;
  basePrice: number;
  totalCogs: number;
  isBOGO: boolean;
  hasChildren: boolean;
  status: "Active" | "Inactive";
  brands: { id: string; name: string | null }[];
}

interface ChildRecipeInput {
  recipeId: string;
  quantity: number;
}

const catLabels: Record<string, string> = {
  makanan: "Makanan",
  minuman: "Minuman",
  snack: "Snack",
  add_ons: "Add-on",
  paket_bundle: "Paket Bundle",
};

const columns: Column<RecipeRow>[] = [
  { key: "code", header: "Kode", width: "w-24", sortable: true },
  { key: "name", header: "Nama Menu", sortable: true },
  {
    key: "category",
    header: "Kategori",
    sortable: true,
    render: (r) => <Badge variant="secondary">{catLabels[r.category] ?? r.category}</Badge>,
  },
  {
    key: "type",
    header: "Tipe",
    width: "w-28",
    render: (r) => (
      <div className="flex gap-1">
        {r.isBOGO && (
          <Badge variant="warning" className="text-[10px] gap-0.5">
            <Zap className="h-3 w-3" /> BOGO
          </Badge>
        )}
        {r.hasChildren && (
          <Badge
            variant="outline"
            className="text-[10px] gap-0.5 border-info text-info-foreground bg-info/10"
          >
            <Package className="h-3 w-3" /> Paket
          </Badge>
        )}
      </div>
    ),
  },
  {
    key: "basePrice",
    header: "Harga Dasar",
    align: "right",
    sortable: true,
    render: (r) => `Rp ${r.basePrice.toLocaleString("id-ID")}`,
  },
  {
    key: "totalCogs",
    header: "HPP Total",
    align: "right",
    sortable: true,
    render: (r) => {
      const pct = r.totalCogs > 0 && r.basePrice > 0 ? (r.totalCogs / r.basePrice) * 100 : 0;
      return (
        <div className="flex items-center gap-1.5 justify-end">
          <span>Rp {r.totalCogs.toLocaleString("id-ID")}</span>
          {pct > 40 && (
            <Badge variant="destructive" className="text-[10px]">
              &gt;40%
            </Badge>
          )}
        </div>
      );
    },
  },
  {
    key: "status",
    header: "Status",
    sortable: true,
    render: (r) => (
      <Badge variant={r.status === "Active" ? "success" : "secondary"}>
        {r.status === "Active" ? "Aktif" : "Nonaktif"}
      </Badge>
    ),
  },
  {
    key: "id",
    header: "",
    width: "w-12",
    render: (r) => (
      <Link
        to="/recipes/$recipeId"
        params={{ recipeId: r.id }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <ArrowRight className="h-4 w-4" />
      </Link>
    ),
  },
];

export const Route = createFileRoute("/_layout/recipes/")({
  component: RecipesPage,
  loader: async () => {
    const recipes = await getRecipes({ data: {} });
    const brands = await getBrands({ data: {} });
    const branches = await getBranches({ data: {} });
    return { recipes, brands, branches };
  },
});

function RecipesPage() {
  const { recipes: initial, brands, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("makanan");
  const [basePrice, setBasePrice] = useState(0);
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);
  const [isBundling, setIsBundling] = useState(false);
  const [childRecipes, setChildRecipes] = useState<ChildRecipeInput[]>([]);
  const [isBOGO, setIsBOGO] = useState(false);
  const [linkedModifierGroupIds, setLinkedModifierGroupIds] = useState<string[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const user = useAuth().user;
  const formRef = useRef<HTMLFormElement>(null);

  const { data: recipes } = useQuery({
    queryKey: ["recipes"],
    queryFn: () => getRecipes({ data: {} }),
    initialData: initial,
  });

  const { data: allModifierGroups } = useQuery({
    queryKey: ["modifier-groups"],
    queryFn: () => getModifierGroups({ data: {} }),
  });

  const createMutation = useMutation({
    mutationFn: createRecipe,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setModalOpen(false);
      resetForm();
      toast.success("Menu berhasil ditambahkan");
    },
    onError: (err) => {
      toast.error("Gagal menambah menu", { description: err.message });
    },
  });

  const recalcMutation = useMutation({
    mutationFn: recalculateAllRecipeCosts,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
  });

  const steps = [
    { label: "Info Dasar", description: "Kode, nama, kategori, harga" },
    { label: "Ketersediaan", description: "Pilihan cabang" },
    { label: "Opsi Lanjutan", description: "Bundling, BOGO, modifier" },
  ];

  const resetForm = () => {
    setCurrentStep(0);
    setCode("");
    setName("");
    setCategory("makanan");
    setBasePrice(0);
    setSelectedBrandIds([]);
    setIsBundling(false);
    setChildRecipes([]);
    setIsBOGO(false);
    setLinkedModifierGroupIds([]);
    setSelectedBranchIds([]);
  };

  const handleNext = () => {
    // Validate current step
    if (currentStep === 0) {
      if (!code.trim()) {
        toast.error("Kode wajib diisi");
        return;
      }
      if (!name.trim()) {
        toast.error("Nama wajib diisi");
        return;
      }
      if (basePrice <= 0) {
        toast.error("Harga dasar harus lebih dari 0");
        return;
      }
    }
    setCurrentStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const handleBack = () => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  };

  const handleSubmit = () => {
    const data = {
      code,
      name,
      category: category as "makanan" | "minuman" | "snack" | "add_ons" | "paket_bundle",
      basePrice,
      isBOGO,
      brandIds: selectedBrandIds,
      ingredients: [],
      childRecipes: isBundling && childRecipes.length > 0 ? childRecipes : undefined,
      modifierGroupIds: linkedModifierGroupIds.length > 0 ? linkedModifierGroupIds : undefined,
      branchIds: selectedBranchIds,
    };
    void createMutation.mutateAsync({ data });
  };

  // Prevent Enter key from submitting the form
  const handleKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
    }
  };
  usePageTitle("Menu / Resep", "Kelola master menu, BOM, dan bundling");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <div className="flex items-center justify-between">
        <PageHeader action={{ label: "Tambah Menu", onClick: () => setModalOpen(true) }} />
        {user?.role === "super_admin" && (
          <button
            onClick={() => recalcMutation.mutateAsync({})}
            disabled={recalcMutation.isPending}
            className="h-9 px-3 rounded-md border text-sm flex items-center gap-2 hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={"h-4 w-4 " + (recalcMutation.isPending ? "animate-spin" : "")} />
            {recalcMutation.isPending ? "Menghitung..." : "Hitung Ulang HPP"}
          </button>
        )}
      </div>

      <DataTable columns={columns} data={recipes} keyExtractor={(r) => r.id} />

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          resetForm();
        }}
        title="Tambah Menu"
        size="2xl"
      >
        {/* Step Indicator */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            {steps.map((step, idx) => (
              <div key={idx} className="flex items-center flex-1 last:flex-none">
                <div className="flex items-center gap-2">
                  <div
                    className={
                      "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors " +
                      (idx < currentStep
                        ? "bg-primary text-primary-foreground"
                        : idx === currentStep
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground")
                    }
                  >
                    {idx < currentStep ? <Check className="h-4 w-4" /> : idx + 1}
                  </div>
                  <div className="hidden sm:block">
                    <p className="text-sm font-medium leading-tight">{step.label}</p>
                    <p className="text-xs text-muted-foreground">{step.description}</p>
                  </div>
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={
                      "mx-3 h-px flex-1 transition-colors " +
                      (idx < currentStep ? "bg-primary" : "bg-muted")
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
                  <Input
                    name="basePrice"
                    type="number"
                    min={0}
                    required
                    value={basePrice}
                    onChange={(e) => setBasePrice(Number(e.target.value))}
                    className="h-10 md:h-9"
                    placeholder="0"
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

          {/* Step 2: Ketersediaan */}
          {currentStep === 1 && (
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
                    id="createAllBranches"
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

          {/* Step 3: Opsi Lanjutan */}
          {currentStep === 2 && (
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
                              onClick={() =>
                                setChildRecipes(childRecipes.filter((_, j) => j !== i))
                              }
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
              {(allModifierGroups ?? []).length > 0 && (
                <div className="rounded-lg border p-4 space-y-3">
                  <div>
                    <Label>Grup Modifier</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Pilih opsi tambahan yang tersedia untuk menu ini
                    </p>
                  </div>
                  <div className="space-y-2">
                    {(allModifierGroups ?? []).map((g: any) => {
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
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setModalOpen(false);
                resetForm();
              }}
            >
              Batal
            </Button>
            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <Button type="button" variant="outline" onClick={handleBack}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Kembali
                </Button>
              )}
              {currentStep < steps.length - 1 ? (
                <Button type="button" onClick={handleNext}>
                  Selanjutnya
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button type="button" onClick={handleSubmit}>
                  <Check className="h-4 w-4 mr-1" />
                  Tambah Menu
                </Button>
              )}
            </div>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
