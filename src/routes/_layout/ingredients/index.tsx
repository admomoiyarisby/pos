import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getIngredients, createIngredient, deleteIngredient } from "#/lib/server/ingredients";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { ArrowRight, Trash2, Check, X } from "lucide-react";

interface IngredientRow {
  id: string;
  code: string;
  name: string;
  category: "Fresh" | "Dry" | "Packaging";
  skuType: "RM" | "SFG" | "FG";
  purchaseUnit: string;
  stockUnit: string;
  conversionFactor: number;
  averageCost: number;
  status: "Active" | "Inactive";
}

const skuLabels: Record<string, string> = {
  RM: "Raw Material",
  SFG: "Semi-Finished",
  FG: "Finished Goods",
};

const columns: Column<IngredientRow>[] = [
  { key: "code", header: "Kode", width: "w-24", sortable: true },
  { key: "name", header: "Nama Bahan", sortable: true },
  {
    key: "skuType",
    header: "Tipe SKU",
    sortable: true,
    render: (r) => <Badge variant="outline">{skuLabels[r.skuType]}</Badge>,
  },
  {
    key: "category",
    header: "Kategori",
    sortable: true,
    render: (r) => (
      <Badge
        variant={
          r.category === "Fresh" ? "destructive" : r.category === "Dry" ? "secondary" : "default"
        }
      >
        {r.category}
      </Badge>
    ),
  },
  { key: "purchaseUnit", header: "Satuan Beli", width: "w-28", sortable: true },
  { key: "stockUnit", header: "Satuan Stok", width: "w-28", sortable: true },
  {
    key: "averageCost",
    header: "HPP",
    align: "right",
    sortable: true,
    render: (r) => `Rp ${r.averageCost.toLocaleString("id-ID")}`,
  },
  {
    key: "id",
    header: "",
    width: "w-32",
    render: (r) => (
      <div className="flex items-center justify-between gap-1">
        <Link
          to="/ingredients/$ingId"
          params={{ ingId: r.id }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowRight className="h-4 w-4" />
        </Link>
        {r.status === "Active" ? (
          <button
            onClick={() => handleStatusToggle(r.id, r.status)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title="Toggle status"
          >
            <Check className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={() => handleStatusToggle(r.id, r.status)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title="Activate"
          >
            <Check className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => {
            setIngredientToDelete(r.id);
            setDeleteModalOpen(true);
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    ),
  },
];

export const Route = createFileRoute("/_layout/ingredients/")({
  component: IngredientsPage,
  loader: async () => {
    const ingredients = await getIngredients({ data: {} });
    return { ingredients };
  },
});

function IngredientsPage() {
  const { ingredients: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [ingredientToDelete, setIngredientToDelete] = useState<string | null>(null);

  const { data: ingredients } = useQuery({
    queryKey: ["ingredients"],
    queryFn: () => getIngredients({ data: {} }),
    initialData: initial,
  });

  const createMutation = useMutation({
    mutationFn: createIngredient,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      setModalOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ data }: { data: { id: string; hardDelete: boolean } }) =>
      deleteIngredient({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      setDeleteModalOpen(false);
      setIngredientToDelete(null);
    },
    onError: (error: Error) => {
      alert(error.message);
    },
  });

  const handleDelete = async () => {
    if (ingredientToDelete) {
      await deleteMutation.mutateAsync({
        data: { id: ingredientToDelete, hardDelete: false },
      });
    }
  };

  const handleStatusToggle = async (id: string, currentStatus: "Active" | "Inactive") => {
    const newStatus = currentStatus === "Active" ? "Inactive" : "Active";
    await updateIngredientMutation.mutateAsync({
      data: { id, status: newStatus },
    });
  };

  const updateIngredientMutation = useMutation({
    mutationFn: ({ data }: { data: Partial<typeof ingredientInput> & { id: string } }) =>
      updateIngredient({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ingredients"] });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      code: fd.get("code") as string,
      name: fd.get("name") as string,
      category: fd.get("category") as "Fresh" | "Dry" | "Packaging",
      skuType: fd.get("skuType") as "RM" | "SFG" | "FG",
      purchaseUnit: fd.get("purchaseUnit") as string,
      stockUnit: fd.get("stockUnit") as string,
      conversionFactor: Number(fd.get("conversionFactor")),
      averageCost: Number(fd.get("averageCost")),
      rop: Number(fd.get("rop")),
      moq: Number(fd.get("moq")),
    };
    void createMutation.mutateAsync({ data });
  };
  usePageTitle("Bahan Baku", "Kelola master bahan baku, semi-finished, dan finished goods");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "central_kitchen"]}>
      <PageHeader action={{ label: "Tambah Bahan", onClick: () => setModalOpen(true) }} />

      <DataTable columns={columns} data={ingredients} keyExtractor={(r) => r.id} />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Tambah Bahan Baku"
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
              <label className="text-sm font-medium">Tipe SKU</label>
              <select
                name="skuType"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="RM">Raw Material</option>
                <option value="SFG">Semi-Finished Good</option>
                <option value="FG">Finished Good</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Kategori</label>
              <select
                name="category"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Fresh">Fresh</option>
                <option value="Dry">Dry</option>
                <option value="Packaging">Packaging</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Satuan Beli</label>
              <input
                name="purchaseUnit"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Satuan Stok</label>
              <input
                name="stockUnit"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Konversi</label>
              <input
                name="conversionFactor"
                type="number"
                min={1}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">HPP (Rp)</label>
              <input
                name="averageCost"
                type="number"
                min={0}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">ROP</label>
              <input
                name="rop"
                type="number"
                min={0}
                defaultValue={0}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">MOQ</label>
            <input
              name="moq"
              type="number"
              min={1}
              defaultValue={1}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
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

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setIngredientToDelete(null);
        }}
        title="Delete Bahan Baku"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this ingredient? This action will set the status to
            <code className="ml-1 bg-muted px-1.5 py-0.5 rounded">Inactive</code>. The ingredient
            cannot be recovered.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteModalOpen(false);
                setIngredientToDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Modal>
    </RoleGuard>
  );
}
