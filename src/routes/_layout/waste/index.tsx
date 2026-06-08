import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
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
import { getBranches } from "#/lib/server/branches";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { getFinancialClassificationLabel } from "#/lib/waste-categories";

interface WasteRow {
  id: string;
  createdAt: Date;
  ingredientName: string | null;
  ingredientCode: string | null;
  quantity: number;
  category: "Beban Makan" | "Biaya Operasional" | "Spoiled";
  notes: string | null;
  investigationNote: string | null;
  valuation: number;
  branchName: string | null;
  currentInventoryQty: number | null;
}

const catColors: Record<string, "default" | "warning" | "destructive"> = {
  "Beban Makan": "default",
  "Biaya Operasional": "warning",
  Spoiled: "destructive",
};

function formatRupiah(value: number): string {
  return `Rp${value.toLocaleString("id-ID")}`;
}

export const Route = createFileRoute("/_layout/waste/")({
  component: WastePage,
  loader: async () => {
    const entries = await getWasteEntries({ data: {} });
    const ingredients = await getIngredients({ data: {} });
    const branches = await getBranches({ data: {} });
    return { entries, ingredients, branches };
  },
});

function WastePage() {
  const { user } = useAuth();
  const { entries: initial, ingredients, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [investigationModalOpen, setInvestigationModalOpen] = useState(false);
  const [investigationEntryId, setInvestigationEntryId] = useState<string | null>(null);
  const [investigationNoteText, setInvestigationNoteText] = useState("");
  const [investigationError, setInvestigationError] = useState<string | null>(null);

  const ingredientOptions = useMemo(() => {
    return ingredients.map((i) => ({
      id: i.id,
      value: i.id,
      label: `${i.name} (${i.stockUnit})`,
      keywords: [i.code ?? "", i.stockUnit],
    }));
  }, [ingredients]);

  const [selectedIngredient, setSelectedIngredient] = useState<
    (typeof ingredientOptions)[number] | null
  >(null);
  const [ingredientInputValue, setIngredientInputValue] = useState("");

  const filteredBranches = useMemo(() => {
    if (user?.role === "area_manager" && user.assignedBranches?.length) {
      return branches.filter((b) => user.assignedBranches!.includes(b.id));
    }
    return branches;
  }, [branches, user]);

  const { data: entries } = useQuery({
    queryKey: ["waste-entries", selectedCategory, debouncedSearch],
    queryFn: () =>
      getWasteEntries({
        data: {
          category: selectedCategory as "Beban Makan" | "Biaya Operasional" | "Spoiled" | null,
          search: debouncedSearch || undefined,
        },
      }),
    initialData: initial,
  });

  const { noInvestigation } = Route.useSearch() as { noInvestigation?: string };
  const filteredEntries =
    noInvestigation === "true"
      ? entries.filter(
          (e) => !e.investigationNote || e.investigationNote.trim() === "",
        )
      : entries;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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
    const fd = new FormData(e.currentTarget);
    const data = {
      branchId: (fd.get("branchId") as string | null) ?? user?.branchId ?? "",
      ingredientId: fd.get("ingredientId") as string,
      quantity: Number(fd.get("quantity")),
      category: fd.get("category") as "Beban Makan" | "Biaya Operasional" | "Spoiled",
      notes: (fd.get("notes") as string) || undefined,
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

  usePageTitle("Pemborosan", "Pencatatan sisa produksi, jatah makan, dan barang rusak");

  const columns: Column<WasteRow>[] = [
    {
      key: "createdAt",
      header: "Waktu",
      width: "w-36",
      sortable: true,
      render: (r) =>
        new Date(r.createdAt).toLocaleString("id-ID", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
    },
    { key: "branchName", header: "Cabang", sortable: true },
    { key: "ingredientName", header: "Bahan", sortable: true },
    {
      key: "category",
      header: "Kategori",
      sortable: true,
      render: (r) => (
        <div className="space-y-0.5">
          <Badge variant={catColors[r.category]}>{r.category}</Badge>
          <div className="text-[10px] text-muted-foreground">
            {getFinancialClassificationLabel(r.category)}
          </div>
        </div>
      ),
    },
    {
      key: "quantity",
      header: "Qty",
      align: "right",
      width: "w-24",
      sortable: true,
      render: (r) => {
        const currentInv = r.currentInventoryQty ?? 0;
        const wastePercentage =
          currentInv + r.quantity > 0 ? (r.quantity / (currentInv + r.quantity)) * 100 : 0;
        const isAnomaly = wastePercentage > 5;
        return (
          <div className={isAnomaly ? "text-rose-600 font-medium" : ""}>
            {r.quantity.toLocaleString("id-ID")}
            {isAnomaly && (
              <div className="text-[10px] text-rose-500">({wastePercentage.toFixed(1)}%)</div>
            )}
          </div>
        );
      },
    },
    {
      key: "valuation",
      header: "Nilai Kerugian",
      align: "right",
      width: "w-32",
      sortable: true,
      render: (r) => formatRupiah(r.valuation),
    },
    { key: "notes", header: "Keterangan", render: (r) => r.notes ?? "-" },
    {
      key: "investigation",
      header: "Investigasi",
      width: "w-48",
      render: (r) => {
        const currentInv = r.currentInventoryQty ?? 0;
        const wastePercentage =
          currentInv + r.quantity > 0 ? (r.quantity / (currentInv + r.quantity)) * 100 : 0;
        const isAnomaly = wastePercentage > 5;
        const canInvestigate = user?.role === "super_admin" || user?.role === "area_manager";

        if (r.investigationNote) {
          return (
            <div className="space-y-1">
              <Badge variant="secondary" className="text-[10px]">
                Diinvestigasi
              </Badge>
              <div className="text-xs text-muted-foreground line-clamp-2 max-w-[160px]">
                {r.investigationNote}
              </div>
            </div>
          );
        }

        if (isAnomaly) {
          if (canInvestigate) {
            return (
              <button
                onClick={() => handleOpenInvestigation(r)}
                className="text-xs px-2 py-1 rounded-md bg-rose-100 text-rose-700 hover:bg-rose-200 transition-colors"
              >
                Investigasi
              </button>
            );
          }
          return (
            <Badge variant="destructive" className="text-[10px]">
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
      <PageHeader action={{ label: "Input Waste", onClick: () => setModalOpen(true) }} />

      <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">Total Kerugian Waste</div>
          <div className="text-lg font-semibold">{formatRupiah(totalValuation)}</div>
          <div className="text-[10px] text-muted-foreground">periode aktif</div>
        </div>
        <div className="flex items-end">
          <div className="w-full space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Kategori</label>
            <select
              value={selectedCategory ?? ""}
              onChange={(e) => setSelectedCategory(e.target.value || null)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Semua Kategori</option>
              <option value="Beban Makan">Beban Makan</option>
              <option value="Biaya Operasional">Biaya Operasional</option>
              <option value="Spoiled">Spoiled</option>
            </select>
          </div>
        </div>
        <div className="flex items-end">
          <div className="w-full space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Cari Bahan</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Nama bahan..."
                className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      <DataTable
        searchable={false}
        columns={columns}
        data={filteredEntries}
        keyExtractor={(r) => r.id}
        pageSize={15}
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
        }}
        title="Input Waste"
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {submitError && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
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
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
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
              />
              <ComboboxContent>
                <ComboboxList>
                  {(item: (typeof ingredientOptions)[number]) => (
                    <ComboboxItem key={item.id} value={item}>
                      {item.label}
                    </ComboboxItem>
                  )}
                </ComboboxList>
                <ComboboxEmpty>Tidak ada bahan yang cocok</ComboboxEmpty>
              </ComboboxContent>
            </Combobox>
            <input type="hidden" name="ingredientId" value={selectedIngredient?.id ?? ""} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Kategori</label>
              <select
                name="category"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Beban Makan">Beban Makan (Jatah karyawan)</option>
                <option value="Biaya Operasional">Biaya Operasional</option>
                <option value="Spoiled">Spoiled (Basi/Hancur)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Jumlah</label>
              <input
                name="quantity"
                type="number"
                min={1}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Keterangan</label>
            <textarea
              name="notes"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none"
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
              Simpan
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
            <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
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
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[120px] resize-none"
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
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={investigationMutation.isPending}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              {investigationMutation.isPending ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
