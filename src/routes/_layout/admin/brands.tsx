import { createFileRoute } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { formText } from "#/lib/utils";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable, { type Column } from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { Button } from "#/components/ui/button";
import { getBrands, createBrand, updateBrand, deleteBrand } from "#/lib/server/brands";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge";
import { Trash2, AlertTriangle, Search, X, Plus, Tag, ArrowRight } from "lucide-react";

interface BrandRow {
  id: string;
  code: string;
  name: string;
  logo: string | null;
  status: string;
}

const columns: Column<BrandRow>[] = [
  { accessorKey: "code", header: "Kode", width: "w-24", enableSorting: true },
  { accessorKey: "name", header: "Nama Brand", enableSorting: true },
  {
    accessorKey: "status",
    header: "Status",
    width: "w-20",
    enableSorting: true,
    cell: ({ row }) =>
      row.original.status === "Active" ? (
        <Badge variant="success">Aktif</Badge>
      ) : (
        <Badge variant="secondary">Nonaktif</Badge>
      ),
  },
];

export const Route = createFileRoute("/_layout/admin/brands")({
  component: BrandsPage,
  loader: async () => {
    const brands = await getBrands({ data: {} });
    return { brands };
  },
});

function BrandsPage() {
  const [search, setSearch, committedSearch] = useTableSearch({ debounceMs: 250 });
  const { page, setPage, sort, setSort } = useTableUrlState();
  const { brands: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BrandRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrandRow | null>(null);

  const { data: brands } = useQuery({
    queryKey: ["brands", committedSearch],
    queryFn: () => getBrands({ data: { search: committedSearch || undefined } }),
    initialData: initial,
  });

  const createMutation = useMutation({
    mutationFn: createBrand,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["brands"] });
      setModalOpen(false);
      setEditing(null);
      toast.success("Merek berhasil ditambahkan");
    },
    onError: (error: Error) => {
      toast.error("Gagal menambah merek", { description: error.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateBrand,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["brands"] });
      setModalOpen(false);
      setEditing(null);
      toast.success("Merek berhasil diperbarui");
    },
    onError: (error: Error) => {
      toast.error("Gagal memperbarui merek", { description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBrand,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["brands"] });
      setDeleteTarget(null);
      toast.success("Merek berhasil dinonaktifkan");
    },
    onError: (error: Error) => {
      toast.error("Gagal menonaktifkan merek", { description: error.message });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      code: formText(fd, "code"),
      name: formText(fd, "name"),
    };
    if (editing) {
      void updateMutation.mutateAsync({ data: { id: editing.id, ...data } });
    } else {
      void createMutation.mutateAsync({ data });
    }
  };
  const displayRows = useMemo(() => {
    if (!search.trim()) return brands ?? [];
    const q = search.toLowerCase();
    return (brands ?? []).filter(
      (r) => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
    );
  }, [brands, search]);
  const totalPages = Math.ceil(displayRows.length / 15) || 1;
  const pagedRows = useMemo(
    () => displayRows.slice(page * 15, (page + 1) * 15),
    [displayRows, page],
  );
  const hasActiveFilters = !!search.trim();

  usePageTitle("Manajemen Merek", "Kelola merek menu");

  // SAFETY: tableColumns are built from validated BrandRow ColumnDef shapes — the action column augments the known set.
  const tableColumns = [
    ...columns,
    {
      accessorKey: "actions",
      header: "",
      width: "w-12",
      cell: ({ row }: { row: { original: BrandRow } }) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setDeleteTarget(row.original);
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          title="Nonaktifkan"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    },
    // SAFETY: action column is a validated BrandRow ColumnDef augmentation.
  ] as Column<BrandRow>[];

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
              aria-label="Cari merek"
              placeholder="Cari kode, nama…"
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
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            className="w-full sm:w-auto sm:ml-auto h-11 sm:h-9 rounded-xl sm:rounded-md shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Tambah Merek
          </Button>
        </div>
        <div className="flex items-center justify-between sm:hidden text-xs">
          <span className="text-muted-foreground tabular-nums">
            {displayRows.length} merek • Hal {page + 1}/{totalPages}
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
              <Tag className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium">
              {hasActiveFilters ? "Tidak ada hasil" : "Belum ada merek"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {hasActiveFilters ? `Tidak ada merek untuk "${search}".` : "Tambah merek pertama."}
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
            <div
              key={r.id}
              onClick={() => {
                setEditing(r);
                setModalOpen(true);
              }}
              className="flex items-center gap-3 rounded-xl border bg-card p-3.5 shadow-xs active:scale-[0.99] transition-transform cursor-pointer"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-muted-foreground truncate">{r.code}</div>
                <div className="font-medium text-sm truncate">{r.name}</div>
                <div className="mt-1">
                  {r.status === "Active" ? (
                    <Badge variant="success" className="text-[11px] h-5">
                      Aktif
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[11px] h-5">
                      Nonaktif
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(r);
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border bg-background shadow-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  title="Nonaktifkan"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border bg-background">
                  <ArrowRight className="h-4 w-4" />
                </span>
              </div>
            </div>
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
          columns={tableColumns}
          data={displayRows}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => {
            setEditing(r);
            setModalOpen(true);
          }}
          searchable={false}
          page={page}
          onPageChange={setPage}
          sort={sort}
          onSortChange={setSort}
        />
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit Merek" : "Tambah Merek"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Kode</label>
            <input
              name="code"
              defaultValue={editing?.code ?? ""}
              required
              className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Nama</label>
            <input
              name="name"
              defaultValue={editing?.name ?? ""}
              required
              className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
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
              {editing ? "Simpan" : "Tambah"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Nonaktifkan Merek"
        size="sm"
      >
        {deleteTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Nonaktifkan merek "{deleteTarget.name}"?</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Merek yang dinonaktifkan tidak akan muncul di menu, tetapi data historis tetap
                  tersimpan.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
                Batal
              </Button>
              <Button
                variant="destructive"
                onClick={() => void deleteMutation.mutateAsync({ data: { id: deleteTarget.id } })}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Menonaktifkan..." : "Nonaktifkan"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </RoleGuard>
  );
}
