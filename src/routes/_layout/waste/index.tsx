import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { formText } from "#/lib/utils";
import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { AlertCircle, Search } from "lucide-react";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "#/components/ui/combobox";
import { getWasteEntries, createWasteEntry, addInvestigationNote } from "#/lib/server/waste";
import { getIngredients } from "#/lib/server/ingredients";
import { getInventory } from "#/lib/server/inventory";
import { getBranches } from "#/lib/server/branches";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "#/components/ui/badge";
import { getFinancialClassificationLabel } from "#/lib/waste-categories";

interface WasteRow {
  id: string;
  createdAt: Date;
  ingredientName: string | null;
  ingredientCode: string | null;
  quantity: number;
  category: "Beban Makan" | "Biaya Operasional" | "Spoiled" | "Denda";
  staffName: string | null;
  notes: string | null;
  investigationNote: string | null;
  valuation: number;
  branchName: string | null;
  currentInventoryQty: number | null;
  stockUnit: string | null;
}

const catColors = {
  "Beban Makan": "default",
  "Biaya Operasional": "warning",
  Spoiled: "destructive",
  Denda: "secondary",
} satisfies Record<string, "default" | "warning" | "destructive" | "secondary">;

function formatRupiah(value: number): string {
  return `Rp${value.toLocaleString("id-ID")}`;
}

/**
 * Format a date as YYYY-MM-DD using local time (not UTC).
 * Avoids the timezone shift caused by toISOString().
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const Route = createFileRoute("/_layout/waste/")({
  component: WastePage,
  loader: async () => {
    const entries = await getWasteEntries({ data: {} });
    const ingredients = await getIngredients({ data: { excludeNasi: true } });
    const branches = await getBranches({ data: {} });
    return { entries, ingredients, branches };
  },
});

function WastePage() {
  const { user } = useAuth();
  const { entries: initial, ingredients, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ingredientError, setIngredientError] = useState<string | null>(null);
  const [search, setSearch, committedSearch] = useTableSearch({ debounceMs: 250 });
  // URL-persisted table state: filters (category / date range / sort / neg)
  // plus page, so returning to this page restores the exact list view.
  const {
    page,
    setPage,
    filters: { category, dateFrom, dateTo, sortBy, sortDir, noInvestigation },
    setFilter,
  } = useTableUrlState<{
    category?: string;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: string;
    sortDir?: string;
    noInvestigation?: string;
  }>(["category", "dateFrom", "dateTo", "sortBy", "sortDir", "noInvestigation"]);
  const [investigationModalOpen, setInvestigationModalOpen] = useState(false);
  const [investigationEntryId, setInvestigationEntryId] = useState<string | null>(null);
  const [investigationNoteText, setInvestigationNoteText] = useState("");
  const [investigationError, setInvestigationError] = useState<string | null>(null);

  // Default date range (26th prev month to 25th current month) used when the
  // URL carries no explicit dateFrom/dateTo.
  const defaultRange = useMemo(() => {
    const now = new Date();
    const currentDay = now.getDate();
    if (currentDay < 26) {
      return {
        from: formatLocalDate(new Date(now.getFullYear(), now.getMonth() - 1, 26)),
        to: formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 25)),
      };
    }
    return {
      from: formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 26)),
      to: formatLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 25)),
    };
  }, []);
  const effectiveDateFrom = dateFrom ?? defaultRange.from;
  const effectiveDateTo = dateTo ?? defaultRange.to;

  const [showStaffField, setShowStaffField] = useState(false);

  // Sort state (default: date, descending).
  // SAFETY: the sort controls only offer "date"/"category" and "asc"/"desc".
  const effectiveSortBy = (sortBy ?? "date") as "date" | "category";
  // SAFETY: same — only two directions are offered in the UI.
  const effectiveSortDir = (sortDir ?? "desc") as "asc" | "desc";

  const filteredBranches = useMemo(() => {
    if (user?.role === "area_manager" && user.assignedBranches?.length) {
      return branches.filter((b) => user.assignedBranches!.includes(b.id));
    }
    return branches;
  }, [branches, user]);

  // Effective branch ID for inventory lookup
  const effectiveBranchId = user?.branchId ?? filteredBranches[0]?.id;

  // Fetch inventory for the selected branch
  const { data: inventoryResult } = useQuery({
    queryKey: ["inventory-branch", effectiveBranchId],
    queryFn: () => getInventory({ data: { branchId: effectiveBranchId } }),
    enabled: !!effectiveBranchId,
  });

  // Map ingredientId → available qty
  const stockByIngredient = useMemo(() => {
    const m = new Map<string, number>();
    const rows = inventoryResult?.data;
    if (rows) {
      for (const inv of rows) {
        m.set(inv.ingredientId, inv.quantity);
      }
    }
    return m;
  }, [inventoryResult]);

  // Set of ingredientIds that have an inventory row (branch has this item)
  const branchHasIngredient = useMemo(() => {
    const s = new Set<string>();
    const rows = inventoryResult?.data;
    if (rows) {
      for (const inv of rows) {
        s.add(inv.ingredientId);
      }
    }
    return s;
  }, [inventoryResult]);

  const ingredientOptions = useMemo(() => {
    return ingredients
      .map((i) => {
        const hasRow = branchHasIngredient.has(i.id);
        const stockQty = stockByIngredient.get(i.id) ?? 0;
        return {
          id: i.id,
          value: i.id,
          label: `${i.name} (${i.stockUnit})`,
          stockQty,
          stockUnit: i.stockUnit,
          hasInventory: hasRow,
          keywords: [i.code ?? "", i.stockUnit],
        };
      })
      .sort((a, b) => {
        // Items in branch inventory first (even if empty)
        if (a.hasInventory && !b.hasInventory) return -1;
        if (!a.hasInventory && b.hasInventory) return 1;
        // Then in-stock before empty
        if (a.stockQty > 0 && b.stockQty <= 0) return -1;
        if (a.stockQty <= 0 && b.stockQty > 0) return 1;
        // Then by stock descending
        if (b.stockQty !== a.stockQty) return b.stockQty - a.stockQty;
        // Then alphabetically
        return a.label.localeCompare(b.label);
      });
  }, [ingredients, stockByIngredient, branchHasIngredient]);

  const [selectedIngredient, setSelectedIngredient] = useState<
    (typeof ingredientOptions)[number] | null
  >(null);
  const [ingredientInputValue, setIngredientInputValue] = useState("");

  const { data: entries } = useQuery({
    queryKey: ["waste-entries", category, committedSearch],
    queryFn: () =>
      getWasteEntries({
        data: {
          // SAFETY: the category filter select only offers the four literals.
          category: (category || null) as WasteRow["category"] | null,
          search: committedSearch || undefined,
        },
      }),
    initialData: initial,
  });

  // Filter and sort entries
  const filteredEntries = useMemo(() => {
    let result = entries;

    // Filter by noInvestigation
    if (noInvestigation === "true") {
      result = result.filter((e) => !e.investigationNote || e.investigationNote.trim() === "");
    }

    // Filter by date range
    if (effectiveDateFrom && effectiveDateTo) {
      const from = new Date(effectiveDateFrom);
      from.setHours(0, 0, 0, 0);
      const to = new Date(effectiveDateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter((e) => {
        const entryDate = new Date(e.createdAt);
        return entryDate >= from && entryDate <= to;
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (effectiveSortBy === "date") {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (effectiveSortBy === "category") {
        cmp = a.category.localeCompare(b.category);
      }
      return effectiveSortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [
    entries,
    noInvestigation,
    effectiveDateFrom,
    effectiveDateTo,
    effectiveSortBy,
    effectiveSortDir,
  ]);

  const createMutation = useMutation({
    mutationFn: createWasteEntry,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["waste-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setModalOpen(false);
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal mencatat waste");
    },
  });

  const investigationMutation = useMutation({
    mutationFn: addInvestigationNote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["waste-entries"] });
      setInvestigationModalOpen(false);
      setInvestigationEntryId(null);
      setInvestigationNoteText("");
      setInvestigationError(null);
    },
    onError: (err) => {
      setInvestigationError(
        err instanceof Error ? err.message : "Gagal menambahkan catatan investigasi",
      );
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedIngredient) {
      setIngredientError("Pilih bahan terlebih dahulu");
      return;
    }
    setIngredientError(null);
    const fd = new FormData(e.currentTarget);
    const quantity = Number(fd.get("quantity"));

    // Check if ingredient exists in branch inventory
    if (!branchHasIngredient.has(selectedIngredient.id)) {
      setSubmitError("Bahan ini belum pernah ada di cabang ini");
      return;
    }

    // Check stock availability
    const availableStock = stockByIngredient.get(selectedIngredient.id) ?? 0;
    if (availableStock <= 0) {
      setSubmitError("Stok bahan ini sudah habis");
      return;
    }
    if (quantity > availableStock) {
      setSubmitError(`Jumlah waste (${quantity}) melebihi stok tersedia (${availableStock})`);
      return;
    }

    const data = {
      branchId: formText(fd, "branchId") || (user?.branchId ?? ""),
      ingredientId: selectedIngredient.id,
      quantity,
      category: z
        .enum(["Beban Makan", "Biaya Operasional", "Spoiled", "Denda"])
        .parse(formText(fd, "category")),
      staffName: formText(fd, "staffName") || undefined,
      notes: formText(fd, "notes") || undefined,
    };
    void createMutation.mutateAsync({ data });
  };

  const handleInvestigationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!investigationEntryId || !investigationNoteText.trim()) return;
    void investigationMutation.mutateAsync({
      data: { wasteEntryId: investigationEntryId, investigationNote: investigationNoteText.trim() },
    });
  };

  const handleOpenInvestigation = (entry: WasteRow) => {
    setInvestigationEntryId(entry.id);
    setInvestigationNoteText(entry.investigationNote ?? "");
    setInvestigationError(null);
    setInvestigationModalOpen(true);
  };

  usePageTitle("Waste", "Pencatatan sisa produksi, jatah makan, dan barang rusak");

  // Branch admins must not see the HPP-derived valuation (qty × averageCost).
  const isBranchAdmin = user?.role === "branch_admin";

  const columns: ColumnDef<WasteRow>[] = [
    {
      accessorKey: "createdAt",
      header: "Waktu",
      width: "w-36",
      enableSorting: true,
      cell: ({ row }) =>
        new Date(row.original.createdAt).toLocaleString("id-ID", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
    },
    { accessorKey: "branchName", header: "Cabang", enableSorting: true },
    { accessorKey: "ingredientName", header: "Bahan", enableSorting: true },
    {
      accessorKey: "category",
      header: "Kategori",
      enableSorting: true,
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <Badge variant={catColors[row.original.category]}>{row.original.category}</Badge>
          {row.original.category === "Denda" && row.original.staffName && (
            <div className="text-xs text-muted-foreground">Staff: {row.original.staffName}</div>
          )}
          <div className="text-xs text-muted-foreground">
            {getFinancialClassificationLabel(row.original.category)}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "quantity",
      header: "Qty",
      align: "right",
      width: "w-24",
      enableSorting: true,
      cell: ({ row }) => {
        const currentInv = row.original.currentInventoryQty ?? 0;
        const wastePercentage =
          currentInv + row.original.quantity > 0
            ? (row.original.quantity / (currentInv + row.original.quantity)) * 100
            : 0;
        const isAnomaly = wastePercentage > 5;
        return (
          <div className={isAnomaly ? "text-rose-600 font-medium" : ""}>
            {row.original.quantity.toLocaleString("id-ID")}
            {row.original.stockUnit && (
              <span className="text-muted-foreground ml-0.5">{row.original.stockUnit}</span>
            )}
            {isAnomaly && (
              <div className="text-xs text-rose-500">({wastePercentage.toFixed(1)}%)</div>
            )}
          </div>
        );
      },
    },
    ...(isBranchAdmin
      ? []
      : [
          {
            accessorKey: "valuation",
            header: "Nilai Kerugian",
            align: "right" as const,
            width: "w-32",
            enableSorting: true,
            cell: ({ row }) => formatRupiah(row.original.valuation),
          },
        ]),
    { accessorKey: "notes", header: "Keterangan", cell: ({ row }) => row.original.notes ?? "-" },
    {
      accessorKey: "investigation",
      header: "Investigasi",
      width: "w-48",
      cell: ({ row }) => {
        const currentInv = row.original.currentInventoryQty ?? 0;
        const wastePercentage =
          currentInv + row.original.quantity > 0
            ? (row.original.quantity / (currentInv + row.original.quantity)) * 100
            : 0;
        const isAnomaly = wastePercentage > 5;
        const canInvestigate = user?.role === "super_admin" || user?.role === "area_manager";

        if (row.original.investigationNote) {
          return (
            <div className="space-y-1">
              <Badge variant="secondary" className="text-xs">
                Diinvestigasi
              </Badge>
              <div className="text-xs text-muted-foreground line-clamp-2 max-w-[160px]">
                {row.original.investigationNote}
              </div>
            </div>
          );
        }

        if (isAnomaly) {
          if (canInvestigate) {
            return (
              <button
                onClick={() => handleOpenInvestigation(row.original)}
                className="text-xs px-2 py-1 rounded-md bg-rose-100 text-rose-700 hover:bg-rose-200 transition-colors"
              >
                Investigasi
              </button>
            );
          }
          return (
            <Badge variant="destructive" className="text-xs">
              Butuh Investigasi
            </Badge>
          );
        }

        return <span className="text-muted-foreground text-xs">-</span>;
      },
    },
  ];

  const totalValuation = useMemo(() => {
    return filteredEntries.reduce((sum, e) => sum + (e.valuation ?? 0), 0);
  }, [filteredEntries]);

  return (
    <RoleGuard
      allowedRoles={[
        "super_admin",
        "admin_pusat",
        "area_manager",
        "branch_admin",
        "central_kitchen",
      ]}
    >
      <PageHeader
        action={{
          label: "Input Waste",
          onClick: () => {
            setModalOpen(true);
            setIngredientError(null);
          },
        }}
      />

      {/* Summary — prominent, above filters. HPP-derived total hidden for
          branch_admin. */}
      {!isBranchAdmin && (
        <div className="mb-6">
          <div className="rounded-md border bg-card p-4">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
              <div>
                <div className="text-sm text-muted-foreground">Total Kerugian</div>
                <div className="text-2xl font-semibold tracking-tight">
                  {formatRupiah(totalValuation)}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Periode: {effectiveDateFrom} — {effectiveDateTo}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters — 2-col grid on tablet, wrap on desktop */}
      <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <input
            type="date"
            value={effectiveDateFrom}
            onChange={(e) => {
              setFilter("dateFrom", e.target.value);
              setPage(0);
            }}
            className="h-11 md:h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          />
          <span className="flex items-center text-muted-foreground text-sm">—</span>
          <input
            type="date"
            value={effectiveDateTo}
            onChange={(e) => {
              setFilter("dateTo", e.target.value);
              setPage(0);
            }}
            className="h-11 md:h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <select
          value={category ?? ""}
          onChange={(e) => {
            setFilter("category", e.target.value);
            setPage(0);
          }}
          className="h-11 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Semua Kategori</option>
          <option value="Beban Makan">Beban Makan</option>
          <option value="Biaya Operasional">Biaya Operasional</option>
          <option value="Spoiled">Spoiled</option>
          <option value="Denda">Denda</option>
        </select>
        <div className="flex gap-2">
          <select
            value={effectiveSortBy}
            onChange={(e) => {
              setFilter("sortBy", e.target.value);
              setPage(0);
            }}
            className="h-11 md:h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="date">Urut: Tanggal</option>
            <option value="category">Urut: Kategori</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setFilter("sortDir", effectiveSortDir === "asc" ? "desc" : "asc");
              setPage(0);
            }}
            className="h-11 md:h-9 w-11 md:w-9 rounded-md border flex items-center justify-center hover:bg-muted transition-colors"
            title={effectiveSortDir === "asc" ? "Ascending" : "Descending"}
          >
            {effectiveSortDir === "asc" ? "↑" : "↓"}
          </button>
        </div>
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari bahan..."
            className="h-11 md:h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
          />
        </div>
      </div>

      <DataTable
        searchable={false}
        columns={columns}
        data={filteredEntries}
        keyExtractor={(r) => r.id}
        pageSize={15}
        page={page}
        onPageChange={setPage}
        rowClassName={(r) => {
          const currentInv = r.currentInventoryQty ?? 0;
          const wastePercentage =
            currentInv + r.quantity > 0 ? (r.quantity / (currentInv + r.quantity)) * 100 : 0;
          return wastePercentage > 5 ? "bg-rose-50/30" : "";
        }}
      />

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSubmitError(null);
          setIngredientError(null);
          setShowStaffField(false);
        }}
        title="Input Waste"
        size="lg"
      >
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          {submitError && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">Cabang</label>
            <select
              name="branchId"
              defaultValue={user?.branchId ?? ""}
              disabled={!!user?.branchId || user?.role === "area_manager"}
              className="h-11 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
            >
              {filteredBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Bahan</label>
            <Combobox
              value={selectedIngredient}
              onValueChange={(val) => {
                setSelectedIngredient(val);
                setIngredientInputValue(val ? val.label : "");
                if (val) setIngredientError(null);
              }}
              inputValue={ingredientInputValue}
              onInputValueChange={setIngredientInputValue}
              items={ingredientOptions}
              itemToStringValue={(item) => item.id}
              itemToStringLabel={(item) => item.label}
              isItemEqualToValue={(a, b) => a?.id === b?.id}
            >
              <ComboboxInput
                showTrigger
                showClear={!!selectedIngredient}
                placeholder="Pilih bahan..."
                className={ingredientError ? "border-destructive" : ""}
              />
              <ComboboxContent container={formRef.current}>
                <ComboboxList>
                  {(item: (typeof ingredientOptions)[number]) => (
                    <ComboboxItem key={item.id} value={item}>
                      <div className="flex items-center justify-between w-full">
                        <span
                          className={!item.hasInventory || item.stockQty <= 0 ? "opacity-50" : ""}
                        >
                          {item.label}
                        </span>
                        <span
                          className={
                            "text-xs " +
                            (!item.hasInventory
                              ? "text-muted-foreground italic"
                              : item.stockQty <= 0
                                ? "text-destructive font-medium"
                                : "text-muted-foreground")
                          }
                        >
                          {!item.hasInventory
                            ? "belum pernah ada"
                            : item.stockQty <= 0
                              ? "habis"
                              : `Stok: ${item.stockQty}`}
                        </span>
                      </div>
                    </ComboboxItem>
                  )}
                </ComboboxList>
                <ComboboxEmpty>Tidak ada bahan yang cocok</ComboboxEmpty>
              </ComboboxContent>
            </Combobox>
            {ingredientError && <p className="text-xs text-destructive">{ingredientError}</p>}
            <input type="hidden" name="ingredientId" value={selectedIngredient?.id ?? ""} />
            {selectedIngredient && (
              <p
                className={`text-xs ${
                  !branchHasIngredient.has(selectedIngredient.id)
                    ? "text-muted-foreground italic"
                    : (stockByIngredient.get(selectedIngredient.id) ?? 0) <= 0
                      ? "text-destructive font-medium"
                      : "text-muted-foreground"
                }`}
              >
                {!branchHasIngredient.has(selectedIngredient.id)
                  ? "Bahan ini belum pernah ada di cabang ini"
                  : `Stok tersedia: ${stockByIngredient.get(selectedIngredient.id) ?? 0} ${selectedIngredient.stockUnit}${(stockByIngredient.get(selectedIngredient.id) ?? 0) <= 0 ? " — tidak bisa dicatat sebagai waste" : ""}`}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Kategori</label>
              <select
                name="category"
                required
                onChange={(e) => setShowStaffField(e.target.value === "Denda")}
                className="h-11 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Beban Makan">Beban Makan (Jatah karyawan)</option>
                <option value="Biaya Operasional">Biaya Operasional</option>
                <option value="Spoiled">Spoiled (Basi/Hancur)</option>
                <option value="Denda">Denda Karyawan</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Jumlah</label>
              <input
                name="quantity"
                type="number"
                min={1}
                required
                className="h-11 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          {showStaffField && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Nama Staff (untuk Denda)</label>
              <input
                name="staffName"
                type="text"
                placeholder="Nama karyawan yang kena denda"
                className="h-11 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">Keterangan</label>
            <textarea
              name="notes"
              className="w-full rounded-md border border-input bg-background px-3 py-3 md:py-2 text-sm min-h-[80px] md:min-h-[60px] resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="h-11 md:h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="h-11 md:h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              {createMutation.isPending ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={investigationModalOpen}
        onClose={() => {
          setInvestigationModalOpen(false);
          setInvestigationEntryId(null);
          setInvestigationNoteText("");
          setInvestigationError(null);
        }}
        title="Catatan Investigasi"
        size="sm"
      >
        <form onSubmit={handleInvestigationSubmit} className="space-y-4">
          {investigationError && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{investigationError}</span>
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">Catatan Investigasi</label>
            <textarea
              value={investigationNoteText}
              onChange={(e) => setInvestigationNoteText(e.target.value)}
              required
              placeholder="Tulis hasil investigasi selisih stok..."
              className="w-full rounded-md border border-input bg-background px-3 py-3 md:py-2 text-sm min-h-[140px] md:min-h-[120px] resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setInvestigationModalOpen(false);
                setInvestigationEntryId(null);
                setInvestigationNoteText("");
                setInvestigationError(null);
              }}
              className="h-11 md:h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={investigationMutation.isPending}
              className="h-11 md:h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              {investigationMutation.isPending ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
