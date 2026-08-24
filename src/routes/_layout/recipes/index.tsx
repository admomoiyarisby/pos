import { createFileRoute, Link } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
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
import { getCategories } from "#/lib/server/categories";
import { getModifierGroups } from "#/lib/server/modifier-groups";
import { useAuth } from "#/lib/auth-context";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { ArrowRight, RefreshCw, Zap, Package, Image as ImageIcon } from "lucide-react";

interface RecipeRow {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  categoryName: string | null;
  isSubRecipe: boolean;
  basePrice: number;
  totalCogs: number;
  isBOGO: boolean;
  hasChildren: boolean;
  status: "Active" | "Inactive" | "Deleted";
  brands: { id: string; name: string | null }[];
  imageUrl?: string | null;
}

export const Route = createFileRoute("/_layout/recipes/")({
  component: RecipesPage,
  loader: async () => {
    const [recipes, brands, branches, categories] = await Promise.all([
      getRecipes({ data: {} }),
      getBrands({ data: {} }),
      getBranches({ data: {} }),
      getCategories({}),
    ]);
    return { recipes, brands, branches, categories };
  },
});

function RecipesPage() {
  const [search, setSearch] = useTableSearch();
  // URL-persisted table state (page/sort/status/category) so returning from a
  // recipe detail page restores exactly where the operator left off.
  const { page, setPage, sort, setSort, filters, setFilter } = useTableUrlState<{
    status?: string;
    category?: string;
  }>(["status", "category"]);
  const statusParam = filters.status;
  const statusFilter = statusParam === "Active" || statusParam === "Inactive" ? statusParam : "All";
  const setStatusFilter = (next: string) => {
    setFilter("status", next === "All" ? undefined : next);
    setPage(0);
  };
  const categoryFilter = filters.category ?? "all";
  const setCategoryFilter = (next: string) => {
    setFilter("category", next === "all" ? undefined : next);
    setPage(0);
  };
  const {
    recipes: initial,
    brands,
    branches,
    categories: initialCategories,
  } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const user = useAuth().user;

  const { data: recipes } = useQuery({
    queryKey: ["recipes", statusFilter],
    queryFn: () =>
      getRecipes({ data: { status: statusFilter === "All" ? undefined : statusFilter } }),
    initialData: initial,
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories({}),
    initialData: initialCategories,
  });

  const filteredRecipes =
    categoryFilter === "all" ? recipes : recipes.filter((r) => r.categoryId === categoryFilter);

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
      key: "categoryName",
      header: "Kategori",
      sortable: true,
      render: (r) => <Badge variant="secondary">{r.categoryName ?? "—"}</Badge>,
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
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
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
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm max-w-[180px]"
            aria-label="Filter kategori"
          >
            <option value="all">Semua Kategori</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
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
        data={filteredRecipes}
        keyExtractor={(r) => r.id}
        search={search}
        onSearchChange={setSearch}
        page={page}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
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
