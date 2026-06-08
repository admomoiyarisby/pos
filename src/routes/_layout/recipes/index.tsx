import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import { Card } from "#/components/ui/card";
import { Separator } from "#/components/ui/separator";
import { Label } from "#/components/ui/label";
import { ArrowRight, RefreshCw, Zap, Package, X, Plus } from "lucide-react";

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
            className="text-[10px] gap-0.5 border-blue-200 text-blue-600 bg-blue-50"
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
  const [isBundling, setIsBundling] = useState(false);
  const [childRecipes, setChildRecipes] = useState<ChildRecipeInput[]>([]);
  const [isBOGO, setIsBOGO] = useState(false);
  const [linkedModifierGroupIds, setLinkedModifierGroupIds] = useState<string[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const user = useAuth().user;

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

  const resetForm = () => {
    setIsBundling(false);
    setChildRecipes([]);
    setIsBOGO(false);
    setLinkedModifierGroupIds([]);
    setSelectedBranchIds([]);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const brandIds = fd.getAll("brandIds").map(String);
    const data = {
      code: fd.get("code") as string,
      name: fd.get("name") as string,
      category: fd.get("category") as "makanan" | "minuman" | "snack" | "add_ons" | "paket_bundle",
      basePrice: Number(fd.get("basePrice")),
      isBOGO,
      brandIds,
      ingredients: [],
      childRecipes: isBundling && childRecipes.length > 0 ? childRecipes : undefined,
      modifierGroupIds: linkedModifierGroupIds.length > 0 ? linkedModifierGroupIds : undefined,
      branchIds: selectedBranchIds,
    };
    void createMutation.mutateAsync({ data });
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
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Kode</label>
              <input
                name="code"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Nama</label>
              <input
                name="name"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Kategori</Label>
              <select
                name="category"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="makanan">Makanan</option>
                <option value="minuman">Minuman</option>
                <option value="snack">Snack</option>
                <option value="add_ons">Add-on</option>
                <option value="paket_bundle">Paket Bundle</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Harga Dasar</Label>
              <Input name="basePrice" type="number" min={0} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Brand</Label>
            <div className="flex flex-wrap gap-2">
              {brands.map((b) => (
                <label
                  key={b.id}
                  className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    name="brandIds"
                    value={b.id}
                    className="rounded border-gray-300"
                  />
                  {b.name}
                </label>
              ))}
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Ketersediaan Cabang</Label>
            <div className="flex items-center gap-2">
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
              <label htmlFor="createAllBranches" className="text-sm font-medium">
                Tersedia di semua cabang (default)
              </label>
            </div>
            {selectedBranchIds.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-sm font-medium">Pilih cabang spesifik:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {branches.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-sm">
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

          <Separator />

          <p className="text-sm font-semibold">Opsi Tambahan</p>

          {/* Group 1 — Bundling */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isBundling}
                onChange={(e) => {
                  setIsBundling(e.target.checked);
                  if (!e.target.checked) setChildRecipes([]);
                }}
                className="h-4 w-4 rounded border-gray-300"
              />
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Package className="h-4 w-4" />
                Bundling (Menu Paket)
              </div>
            </label>
            {isBundling && (
              <Card className="ml-6 p-3 space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setChildRecipes([...childRecipes, { recipeId: "", quantity: 1 }])}
                >
                  <Plus className="h-3 w-3 mr-1" /> Tambah Anak
                </Button>
                {childRecipes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Pilih menu yang menjadi bagian paket.
                  </p>
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
                          className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-xs"
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
                          className="w-20 h-8"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setChildRecipes(childRecipes.filter((_, j) => j !== i))}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </div>

          <Separator />

          {/* Group 2 — BOGO */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isBOGO}
              onChange={(e) => setIsBOGO(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Zap className="h-4 w-4" />
                BOGO (Beli 1 Gratis 1)
              </div>
              <p className="text-xs text-muted-foreground">
                Harga pelanggan tetap 1x, stok terpotong 2x.
              </p>
            </div>
          </label>

          <Separator />

          {/* Group 3 — Modifier Groups */}
          <div className="space-y-3">
            {(allModifierGroups ?? []).length > 0 && (
              <p className="text-sm font-medium">Grup Modifier</p>
            )}
            {(allModifierGroups ?? []).map((g: any) => {
              const checked = linkedModifierGroupIds.includes(g.id);
              return (
                <div key={g.id}>
                  <label className="flex items-center gap-2 cursor-pointer">
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
                  {checked && g.modifiers?.length > 0 && (
                    <Card className="ml-6 mt-2 p-3 space-y-1">
                      {g.modifiers.map((m: any) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between text-sm py-0.5"
                        >
                          <span>
                            {m.name}
                            {m.isExclusion && (
                              <Badge variant="destructive" className="ml-2 text-[10px]">
                                Exclusion
                              </Badge>
                            )}
                          </span>
                          <span className="text-muted-foreground">
                            {m.price > 0 ? `+Rp ${m.price.toLocaleString("id-ID")}` : "—"}
                          </span>
                        </div>
                      ))}
                    </Card>
                  )}
                  {checked && (!g.modifiers || g.modifiers.length === 0) && (
                    <Card className="ml-6 mt-2 p-3">
                      <p className="text-sm text-muted-foreground">Tidak ada opsi</p>
                    </Card>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 pt-2">
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
            <Button type="submit">Tambah</Button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
