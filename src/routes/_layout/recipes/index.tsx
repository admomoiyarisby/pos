import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getRecipes, createRecipe, recalculateAllRecipeCosts } from "#/lib/server/recipes";
import { getBrands } from "#/lib/server/brands";
import { getModifierGroups } from "#/lib/server/modifier-groups";
import { useAuth } from "#/lib/auth-context";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Card } from "#/components/ui/card";
import { Separator } from "#/components/ui/separator";
import { Switch } from "#/components/ui/switch";
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
    key: "id",
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
    return { recipes, brands };
  },
});

function RecipesPage() {
  const { recipes: initial, brands } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [childRecipes, setChildRecipes] = useState<ChildRecipeInput[]>([]);
  const [isBOGO, setIsBOGO] = useState(false);
  const [menuType, setMenuType] = useState<"biasa" | "paket" | "bogo">("biasa");
  const [selectedModifierGroupIds, setSelectedModifierGroupIds] = useState<string[]>([]);
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
    },
  });

  const recalcMutation = useMutation({
    mutationFn: recalculateAllRecipeCosts,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
  });

  const resetForm = () => {
    setChildRecipes([]);
    setIsBOGO(false);
    setMenuType("biasa");
    setSelectedModifierGroupIds([]);
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
      childRecipes: childRecipes.length > 0 ? childRecipes : undefined,
      modifierGroupIds: selectedModifierGroupIds.length > 0 ? selectedModifierGroupIds : undefined,
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
            <Label>Jenis Menu</Label>
            <select
              value={menuType}
              onChange={(e) => {
                setMenuType(e.target.value as "biasa" | "paket" | "bogo");
                if (e.target.value !== "bogo") setIsBOGO(false);
                if (e.target.value !== "paket") setChildRecipes([]);
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="biasa">Menu Biasa</option>
              <option value="paket">Menu Paket (Bundling)</option>
              <option value="bogo">Promo BOGO</option>
            </select>
          </div>

          {menuType === "paket" && (
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <Package className="h-4 w-4" />
                  Bundling (Menu Paket)
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setChildRecipes([...childRecipes, { recipeId: "", quantity: 1 }])}
                >
                  <Plus className="h-3 w-3 mr-1" /> Tambah
                </Button>
              </div>
              {childRecipes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Bukan paket bundling.</p>
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

          {menuType === "bogo" && (
            <Card className="p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Zap className="h-4 w-4" />
                Promo BOGO
              </div>
              <p className="text-sm text-muted-foreground">
                Aktifkan jika menu ini adalah promo beli 1 gratis 1.
              </p>
              <div className="flex items-center gap-3">
                <Switch checked={isBOGO} onCheckedChange={setIsBOGO} id="bogo-switch" />
                <Label htmlFor="bogo-switch">{isBOGO ? "Aktif" : "Nonaktif"}</Label>
              </div>
            </Card>
          )}

          <Separator />

          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">Grup Modifier</Label>
              <Badge variant="outline">{selectedModifierGroupIds.length}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedModifierGroupIds.map((mgId) => {
                const mg = allModifierGroups?.find((g: any) => g.id === mgId);
                return (
                  <Badge key={mgId} variant="outline" className="gap-1 pr-1">
                    {mg?.name ?? mgId}
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedModifierGroupIds(
                          selectedModifierGroupIds.filter((id) => id !== mgId),
                        )
                      }
                      className="ml-0.5 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                if (!selectedModifierGroupIds.includes(e.target.value)) {
                  setSelectedModifierGroupIds([...selectedModifierGroupIds, e.target.value]);
                }
              }}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">-- Pilih Grup Modifier --</option>
              {(allModifierGroups ?? []).map((g: any) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Card>

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
