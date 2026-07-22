import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { toast } from "sonner";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { RecipeWizard } from "#/components/RecipeWizard";
import { getRecipes, createRecipe, recalculateAllRecipeCosts } from "#/lib/server/recipes";
import { uploadRecipeImage } from "#/lib/server/recipe-images";
import { getBrands } from "#/lib/server/brands";
import { getBranches } from "#/lib/server/branches";
import { getModifierGroups } from "#/lib/server/modifier-groups";
import { useAuth } from "#/lib/auth-context";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { ArrowRight, RefreshCw, Zap, Package } from "lucide-react";

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

const catLabels: Record<string, string> = {
  makanan: "Makanan",
  minuman: "Minuman",
  snack: "Snack",
  add_ons: "Add-on",
  paket_bundle: "Paket Bundle",
};

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

  usePageTitle("Menu / Resep", "Kelola master menu, BOM, dan bundling");

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
            <Badge variant="warning" className="text-xs gap-0.5">
              <Zap className="h-3 w-3" /> BOGO
            </Badge>
          )}
          {r.hasChildren && (
            <Badge
              variant="outline"
              className="text-xs gap-0.5 border-info text-info-foreground bg-info/10"
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
              <Badge variant="destructive" className="text-xs">
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Tambah Menu" size="3xl">
        <RecipeWizard
          brands={brands}
          branches={branches}
          modifierGroups={allModifierGroups ?? []}
          recipes={recipes ?? []}
          onSubmit={async (data) => {
            const { pendingFile, removeImage, imageUrl, ...recipeData } = data;
            const created = await createMutation.mutateAsync({ data: recipeData });
            if (pendingFile && created?.id) {
              await uploadRecipeImage({ data: { recipeId: created.id, file: pendingFile } });
            }
            void queryClient.invalidateQueries({ queryKey: ["recipes"] });
          }}
          onCancel={() => setModalOpen(false)}
          isPending={createMutation.isPending}
          submitLabel="Tambah"
        />
      </Modal>
    </RoleGuard>
  );
}
