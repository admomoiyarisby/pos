import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getRecipes, createRecipe } from "#/lib/server/recipes";
import { getBrands } from "#/lib/server/brands";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { ArrowRight } from "lucide-react";

interface RecipeRow {
  id: string;
  code: string;
  name: string;
  category: string;
  isSubRecipe: boolean;
  basePrice: number;
  status: "Active" | "Inactive";
  brands: { id: string; name: string | null }[];
}

const catLabels: Record<string, string> = {
  makanan: "Makanan",
  minuman: "Minuman",
  snack: "Snack",
  add_ons: "Add-on",
};

const columns: Column<RecipeRow>[] = [
  { key: "code", header: "Kode", width: "w-24" },
  { key: "name", header: "Nama Menu" },
  {
    key: "category",
    header: "Kategori",
    render: (r) => <Badge variant="secondary">{catLabels[r.category] ?? r.category}</Badge>,
  },
  {
    key: "basePrice",
    header: "Harga Dasar",
    align: "right",
    render: (r) => `Rp ${r.basePrice.toLocaleString("id-ID")}`,
  },
  {
    key: "status",
    header: "Status",
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

  const { data: recipes } = useQuery({
    queryKey: ["recipes"],
    queryFn: () => getRecipes({ data: {} }),
    initialData: initial,
  });

  const createMutation = useMutation({
    mutationFn: createRecipe,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setModalOpen(false);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const brandIds = fd.getAll("brandIds").map(String);
    const data = {
      code: fd.get("code") as string,
      name: fd.get("name") as string,
      category: fd.get("category") as "makanan" | "minuman" | "snack" | "add_ons",
      basePrice: Number(fd.get("basePrice")),
      brandIds,
      ingredients: [],
    };
    void createMutation.mutateAsync({ data });
  };
  usePageTitle("Menu / Resep", "Kelola master menu, BOM, dan bundling");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <PageHeader action={{ label: "Tambah Menu", onClick: () => setModalOpen(true) }} />

      <DataTable columns={columns} data={recipes} keyExtractor={(r) => r.id} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Tambah Menu" size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Kategori</label>
              <select
                name="category"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="makanan">Makanan</option>
                <option value="minuman">Minuman</option>
                <option value="snack">Snack</option>
                <option value="add_ons">Add-on</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Harga Dasar</label>
              <input
                name="basePrice"
                type="number"
                min={0}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Brand</label>
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
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
            >
              Tambah
            </button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
