import { createFileRoute, Link } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable, { type Column } from "#/components/ui/DataTable";
import { getCategories, createCategory } from "#/lib/server/categories";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import Modal from "#/components/ui/Modal";
import { Label } from "#/components/ui/label";
import { Input } from "#/components/ui/input";
import { toast } from "sonner";
import { ArrowRight, Search, X, Plus, Layers } from "lucide-react";

interface CategoryRow {
  id: string;
  code: string;
  name: string;
  recipeCount: number;
}

const columns: Column<CategoryRow>[] = [
  {
    accessorKey: "name",
    header: "Kategori",
    enableSorting: true,
    cell: ({ row }) => <span className="font-medium capitalize">{row.original.name}</span>,
  },
  {
    accessorKey: "recipeCount",
    header: "Menu Terkait",
    width: "w-28",
    align: "center",
    enableSorting: true,
    cell: ({ row }) => <Badge variant="outline">{row.original.recipeCount}</Badge>,
  },
  {
    accessorKey: "id",
    header: "",
    width: "w-12",
    cell: ({ row }) => (
      <Link
        to="/categories/$categoryId"
        params={{ categoryId: row.original.id }}
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
  const { page, setPage, sort, setSort } = useTableUrlState();
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

  const displayRows = useMemo(() => {
    if (!search.trim()) return categories ?? [];
    const q = search.toLowerCase();
    return (categories ?? []).filter(
      (r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q),
    );
  }, [categories, search]);
  const totalPages = Math.ceil(displayRows.length / 15) || 1;
  const pagedRows = useMemo(
    () => displayRows.slice(page * 15, (page + 1) * 15),
    [displayRows, page],
  );
  const hasActiveFilters = !!search.trim();

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
      {/* ── Toolbar: search + action (mobile-first) ── */}
      <div className="space-y-3 mb-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-[380px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              autoComplete="off"
              aria-label="Cari kategori"
              placeholder="Cari kategori…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-9 text-[16px] shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:rounded-lg sm:text-sm"
            />
            {search ? (
              <button
                type="button"
                aria-label="Hapus pencarian"
                onClick={() => setSearch("")}
                className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <Button
            onClick={() => setCreateModalOpen(true)}
            className="w-full sm:w-auto sm:ml-auto h-11 sm:h-9 rounded-xl sm:rounded-md shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Tambah Kategori
          </Button>
        </div>
        <div className="flex items-center justify-between sm:hidden text-xs">
          <span className="text-muted-foreground tabular-nums">
            {displayRows.length} kategori • Hal {page + 1}/{totalPages}
          </span>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearch("");
                setPage(0);
              }}
              className="font-medium text-primary hover:underline underline-offset-4"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2.5 -mx-4 px-4">
        {pagedRows.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Layers className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium">
              {hasActiveFilters ? "Tidak ada hasil" : "Belum ada kategori"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {hasActiveFilters
                ? `Tidak ada kategori untuk "${search}".`
                : "Tambah kategori pertama untuk memulai."}
            </p>
            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setSearch("");
                  setPage(0);
                }}
              >
                Reset
              </Button>
            )}
          </div>
        ) : (
          pagedRows.map((r) => (
            <Link
              key={r.id}
              to="/categories/$categoryId"
              params={{ categoryId: r.id }}
              className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3.5 shadow-xs active:scale-[0.99] transition-transform"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate capitalize">{r.name}</div>
                <div className="text-xs text-muted-foreground font-mono truncate">{r.code}</div>
                <div className="mt-1">
                  <Badge variant="outline" className="text-[11px] h-5">
                    {r.recipeCount} menu
                  </Badge>
                </div>
              </div>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-background shrink-0">
                <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          ))
        )}
        {totalPages > 1 && pagedRows.length > 0 && (
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="inline-flex items-center justify-center h-9 px-3 rounded-lg border bg-background text-sm font-medium disabled:opacity-30 hover:bg-muted min-w-[96px]"
            >
              Sebelumnya
            </button>
            <span className="text-xs tabular-nums text-muted-foreground">
              Hal {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="inline-flex items-center justify-center h-9 px-3 rounded-lg border bg-background text-sm font-medium disabled:opacity-30 hover:bg-muted min-w-[96px]"
            >
              Selanjutnya
            </button>
          </div>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block -mx-4 md:mx-0">
        <DataTable
          columns={columns}
          data={displayRows}
          keyExtractor={(r) => r.id}
          searchable={false}
          page={page}
          onPageChange={setPage}
          sort={sort}
          onSortChange={setSort}
        />
      </div>

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
