import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useState } from "react";
import { formText } from "#/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { lookupLabel } from "#/lib/label-lookup";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import MoneyInput from "#/components/MoneyInput";
import {
  getIngredients,
  createIngredient,
  updateIngredient,
  deleteIngredient,
} from "#/lib/server/ingredients";
import { getBranches } from "#/lib/server/branches";
import { toast } from "sonner";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Switch } from "#/components/ui/switch";
import { ArrowRight, Trash2, Check } from "lucide-react";

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
  status: "Active" | "Inactive" | "Deleted";
  isBranchVisible: boolean;
}

const skuLabels = {
  RM: "Raw Material",
  SFG: "Semi-Finished",
  FG: "Finished Goods",
} satisfies Record<string, string>;

export const Route = createFileRoute("/_layout/ingredients/")({
  component: IngredientsPage,
  loader: async () => {
    const [ingredients, branches] = await Promise.all([
      getIngredients({ data: {} }),
      getBranches({ data: {} }),
    ]);
    return { ingredients, branches };
  },
});

function IngredientsPage() {
  const [search, setSearch] = useTableSearch();
  const { page, setPage, sort, setSort, filters, setFilter } = useTableUrlState<{
    category?: string;
    skuType?: string;
  }>(["category", "skuType"]);
  const categoryFilter = filters.category ?? "all";
  const skuTypeFilter = filters.skuType ?? "all";
  const { ingredients: initial, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [ingredientToDelete, setIngredientToDelete] = useState<string | null>(null);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [isBranchVisible, setIsBranchVisible] = useState(false);

  const { data: ingredients } = useQuery({
    queryKey: ["ingredients"],
    queryFn: () => getIngredients({ data: {} }),
    initialData: initial,
  });

  const filteredIngredients = ingredients.filter((r) => {
    if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
    if (skuTypeFilter !== "all" && r.skuType !== skuTypeFilter) return false;
    return true;
  });

  const createMutation = useMutation({
    mutationFn: createIngredient,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      setModalOpen(false);
      toast.success("Bahan baku berhasil ditambahkan");
    },
    onError: (error: Error) => {
      toast.error("Gagal menambah bahan baku", { description: error.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateIngredient,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      toast.success("Status bahan baku berhasil diubah");
    },
    onError: (error: Error) => {
      toast.error("Gagal mengubah status", { description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ data }: { data: { id: string; hardDelete: boolean } }) =>
      deleteIngredient({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      setDeleteModalOpen(false);
      setIngredientToDelete(null);
      toast.success("Bahan baku berhasil dihapus");
    },
    onError: (error: Error) => {
      toast.error("Gagal menghapus bahan baku", { description: error.message });
    },
  });

  const handleStatusToggle = async (
    id: string,
    currentStatus: "Active" | "Inactive" | "Deleted",
  ) => {
    const newStatus = currentStatus === "Active" ? "Inactive" : "Active";
    await updateMutation.mutateAsync({ data: { id, status: newStatus } });
  };

  const handleDelete = async () => {
    if (ingredientToDelete) {
      await deleteMutation.mutateAsync({
        data: { id: ingredientToDelete, hardDelete: false },
      });
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      code: formText(fd, "code"),
      name: formText(fd, "name"),
      category: z.enum(["Fresh", "Dry", "Packaging"]).parse(formText(fd, "category")),
      skuType: z.enum(["RM", "SFG", "FG"]).parse(formText(fd, "skuType")),
      purchaseUnit: formText(fd, "purchaseUnit"),
      stockUnit: formText(fd, "stockUnit"),
      conversionFactor: Number(fd.get("conversionFactor")),
      averageCost: Number(fd.get("averageCost")),
      rop: Number(fd.get("rop")),
      moq: Number(fd.get("moq")),
      isBranchVisible,
      // Central-only (toggle off) ⇒ no branch links; branch-visible ⇒ honor selection.
      branchIds: isBranchVisible ? selectedBranchIds : [],
    };
    void createMutation.mutateAsync({ data });
  };

  usePageTitle("Bahan Baku", "Kelola master bahan baku, semi-finished, dan finished goods");

  const setCategoryFilter = (v: string) => {
    setFilter("category", v === "all" ? undefined : v);
    setPage(0);
  };
  const setSkuTypeFilter = (v: string) => {
    setFilter("skuType", v === "all" ? undefined : v);
    setPage(0);
  };

  const columns: Column<IngredientRow>[] = [
    { key: "code", header: "Kode", width: "w-24", sortable: true },
    { key: "name", header: "Nama Bahan", sortable: true },
    {
      key: "skuType",
      header: "Tipe SKU",
      sortable: true,
      render: (r) => <Badge variant="outline">{lookupLabel(skuLabels, r.skuType) ?? "-"}</Badge>,
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
      key: "isBranchVisible",
      header: "Visibilitas",
      render: (r) => (
        <Badge variant={r.isBranchVisible ? "success" : "secondary"}>
          {r.isBranchVisible ? "Cabang" : "Pusat"}
        </Badge>
      ),
    },
    {
      key: "id",
      header: "",
      width: "w-32",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Link
            to="/ingredients/$ingId"
            params={{ ingId: r.id }}
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <ArrowRight className="h-4 w-4" />
          </Link>
          <button
            onClick={() => handleStatusToggle(r.id, r.status)}
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title={r.status === "Active" ? "Nonaktifkan" : "Aktifkan"}
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              setIngredientToDelete(r.id);
              setDeleteModalOpen(true);
            }}
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Hapus"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "central_kitchen"]}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <PageHeader action={{ label: "Tambah Bahan", onClick: () => setModalOpen(true) }} />
        <div className="flex items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            aria-label="Filter kategori bahan"
          >
            <option value="all">Semua Kategori</option>
            <option value="Fresh">Fresh</option>
            <option value="Dry">Dry</option>
            <option value="Packaging">Packaging</option>
          </select>
          <select
            value={skuTypeFilter}
            onChange={(e) => setSkuTypeFilter(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            aria-label="Filter tipe SKU"
          >
            <option value="all">Semua SKU</option>
            <option value="RM">RM</option>
            <option value="SFG">SFG</option>
            <option value="FG">FG</option>
          </select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredIngredients}
        keyExtractor={(r) => r.id}
        search={search}
        onSearchChange={setSearch}
        page={page}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
      />

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
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Nama</label>
              <input
                name="name"
                required
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipe SKU</label>
              <select
                name="skuType"
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Satuan Stok</label>
              <input
                name="stockUnit"
                required
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">HPP (Rp)</label>
              <MoneyInput
                name="averageCost"
                defaultValue={0}
                required
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">ROP</label>
              <input
                name="rop"
                type="number"
                min={0}
                defaultValue={0}
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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
              className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">Tampil di Cabang</p>
              <p className="text-xs text-muted-foreground">
                Aktif = masuk katalog cabang (terlihat branch_admin). Nonaktif = hanya Gudang Pusat
                &amp; manajemen.
              </p>
            </div>
            <Switch
              checked={isBranchVisible}
              onCheckedChange={(checked) => {
                setIsBranchVisible(checked);
                // Auto-sync the branch option: turning ON defaults to "all branches".
                if (checked) setSelectedBranchIds([]);
              }}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Ketersediaan Cabang</label>
            <p className="text-xs text-muted-foreground">
              Pilih cabang yang boleh melihat & memilih bahan ini. Kosong = semua cabang.
            </p>
            {!isBranchVisible && (
              <p className="text-xs text-amber-600">
                Nonaktif: bahan hanya untuk Gudang Pusat &amp; manajemen, pilihan cabang diabaikan.
              </p>
            )}
            <div className="rounded-lg border p-4 space-y-3">
              <label
                className={
                  "flex items-center gap-3 " +
                  (isBranchVisible ? "cursor-pointer" : "cursor-not-allowed opacity-60")
                }
              >
                <input
                  type="checkbox"
                  disabled={!isBranchVisible}
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
                  <p className="text-xs text-muted-foreground">Bahan tersedia di semua cabang</p>
                </div>
              </label>
            </div>
            {selectedBranchIds.length > 0 && isBranchVisible && (
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
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="h-10 md:h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              className="h-10 md:h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
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
        title="Hapus Bahan Baku"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Yakin ingin menghapus bahan baku ini? Bahan akan dihapus dari daftar dan tidak dapat
            dikembalikan melalui aplikasi.
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
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Menghapus..." : "Hapus"}
            </Button>
          </div>
        </div>
      </Modal>
    </RoleGuard>
  );
}
