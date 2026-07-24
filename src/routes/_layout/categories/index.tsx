import { createFileRoute, Link } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import { getCategories, createCategory } from "#/lib/server/categories";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import Modal from "#/components/ui/Modal";
import { Label } from "#/components/ui/label";
import { Input } from "#/components/ui/input";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";

interface CategoryRow {
  id: string;
  code: string;
  name: string;
  recipeCount: number;
}

const columns: Column<CategoryRow>[] = [
  {
    key: "name",
    header: "Kategori",
    sortable: true,
    render: (r) => <span className="font-medium capitalize">{r.name}</span>,
  },
  {
    key: "recipeCount",
    header: "Menu Terkait",
    width: "w-28",
    align: "center",
    sortable: true,
    render: (r) => <Badge variant="outline">{r.recipeCount}</Badge>,
  },
  {
    key: "id",
    header: "",
    width: "w-12",
    render: (r) => (
      <Link
        to="/categories/$categoryId"
        params={{ categoryId: r.id }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <ArrowRight className="h-4 w-4" />
      </Link>
    ),
  },
];

export const Route = createFileRoute("/_layout/categories/")({
  component: CategoriesPage,
  loader: async () => {
    const cats = await getCategories({});
    return { categories: cats };
  },
});

function CategoriesPage() {
  const [search, setSearch] = useTableSearch();
  const { categories: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories({}),
    initialData: initial,
  });

  usePageTitle("Kategori Menu", "Kelola kategori menu & resep");

  const createMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      setCreateModalOpen(false);
      setNewName("");
      setNewCode("");
      toast.success("Kategori berhasil dibuat");
    },
    onError: (error: Error) => {
      toast.error("Gagal membuat kategori", { description: error.message });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      toast.error("Nama kategori harus diisi");
      return;
    }
    const code = newCode.trim() || newName.trim().toLowerCase().replace(/\s+/g, "_");
    void createMutation.mutateAsync({ data: { code, name: newName.trim() } });
  };

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <PageHeader
        action={{
          label: "Tambah Kategori",
          onClick: () => setCreateModalOpen(true),
        }}
      />

      <DataTable
        columns={columns}
        data={categories}
        keyExtractor={(r) => r.id}
        search={search}
        onSearchChange={setSearch}
      />

      {/* Create Category Modal */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Tambah Kategori"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cat-name">Nama Kategori</Label>
            <Input
              id="cat-name"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (!newCode) {
                  setNewCode(e.target.value.toLowerCase().replace(/\s+/g, "_"));
                }
              }}
              placeholder="Minuman Dingin"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cat-code">Kode (slug)</Label>
            <Input
              id="cat-code"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
              placeholder="minuman_dingin"
            />
            <p className="text-xs text-muted-foreground">
              Otomatis diisi dari nama. Gunakan huruf kecil dan underscore.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
