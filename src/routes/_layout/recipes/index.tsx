import { createFileRoute, Link, useSearch, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { lookupLabel } from "#/lib/label-lookup";
import { useTableSearch } from "#/hooks/useTableSearch";
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
import { getBrands } from "#/lib/server/brands";
import { getBranches } from "#/lib/server/branches";
import { getModifierGroups } from "#/lib/server/modifier-groups";
import { useAuth } from "#/lib/auth-context";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { ArrowRight, RefreshCw, Zap, Package, Image as ImageIcon } from "lucide-react";

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
  status: "Active" | "Inactive" | "Deleted";
  brands: { id: string; name: string | null }[];
  imageUrl?: string | null;
}

const catLabels = {
  makanan: "Makanan",
  minuman: "Minuman",
  snack: "Snack",
  add_ons: "Add-on",
  paket_bundle: "Paket Bundle",
} satisfies Record<string, string>;

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
  const [search, setSearch] = useTableSearch();
  // Status Filter (ADR 0008): read loosely from the URL like useTableSearch does,
  // so we never declare a route-level search schema (which would force every
  // /recipes Link to pass it). Absent = "All".
  const urlSearch = useSearch({ strict: false });
  const statusParam = urlSearch.status;
  const statusFilter = z.enum(["Active", "Inactive", "All"]).catch("All").parse(statusParam);
  const navigate = useNavigate();
  const setStatusFilter = (next: string) => {
    // SAFETY: the updater merges the existing search object with the new
    // `status` key; navigate accepts the widened shape.
    void navigate({
      search: (prev) => ({ ...prev, status: next === "All" ? undefined : next }) as never,
      replace: true,
    });
  };
  const { recipes: initial, brands, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const user = useAuth().user;

  const { data: recipes } = useQuery({
    queryKey: ["recipes", statusFilter],
    queryFn: () =>
      getRecipes({ data: { status: statusFilter === "All" ? undefined : statusFilter } }),
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
    {
      key: "image",
      header: "",
      width: "w-9",
      align: "center",
      cellClassName: "!p-0 !min-w-0",
      render: (r) =>
        r.imageUrl ? (
          <img
            src={r.imageUrl}
            alt={r.name}
            loading="lazy"
            decoding="async"
            className="h-8 w-8 rounded-lg border bg-muted object-cover"
          />
        ) : (
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg border bg-muted">
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          </div>
        ),
    },
    { key: "code", header: "Kode", width: "w-24", sortable: true },
    { key: "name", header: "Nama Menu", sortable: true },
    {
      key: "category",
      header: "Kategori",
      sortable: true,
      render: (r) => (
        <Badge variant="secondary">{lookupLabel(catLabels, r.category) ?? r.category}</Badge>
      ),
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
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PageHeader action={{ label: "Tambah Menu", onClick: () => setModalOpen(true) }} />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="All">Semua Status</option>
            <option value="Active">Aktif</option>
            <option value="Inactive">Nonaktif</option>
          </select>
        </div>
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

      <DataTable
        columns={columns}
        data={recipes}
        keyExtractor={(r) => r.id}
        search={search}
        onSearchChange={setSearch}
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Tambah Menu" size="3xl">
        <RecipeWizard
          brands={brands}
          branches={branches}
          modifierGroups={allModifierGroups ?? []}
          recipes={recipes ?? []}
          onSubmit={async (data) => {
            await createMutation.mutateAsync({ data });
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
