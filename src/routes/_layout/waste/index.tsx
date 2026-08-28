import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { formText } from "#/lib/utils";
import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable, { type Column } from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { AlertCircle, Search, X, Plus, CalendarDays, ArrowUp, ArrowDown } from "lucide-react";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "#/components/ui/combobox";
import {
  getWasteEntries,
  createWasteEntry,
  addInvestigationNote,
  cancelWasteEntry,
  getRecipeInventoryForWaste,
  getRecipeBomForWaste,
  createBomWasteEntry,
  type RecipeBomLine,
} from "#/lib/server/waste";
import { getIngredients } from "#/lib/server/ingredients";
import { getInventory } from "#/lib/server/inventory";
import { getBranches } from "#/lib/server/branches";
import { Badge } from "#/components/ui/badge";
import { getFinancialClassificationLabel } from "#/lib/waste-categories";

interface WasteRow {
  id: string;
  createdAt: Date;
  ingredientName: string | null;
  ingredientCode: string | null;
  recipeName: string | null;
  recipeCode: string | null;
  ingredientId: string | null;
  recipeId: string | null;
  quantity: number;
  category: "Beban Makan" | "Biaya Operasional" | "Spoiled" | "Denda";
  staffName: string | null;
  notes: string | null;
  investigationNote: string | null;
  valuation: number;
  branchName: string | null;
  currentInventoryQty: number | null;
  currentRecipeQty: number | null;
  stockUnit: string | null;
  status: "Active" | "Cancelled";
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  cancelledByName: string | null;
}

// FEATURE FLAG: "Porsi jadi" menu waste (deducts the ready-units porsi shelf)
// is hidden for now — Bahan (BOM) is the default and only exposed menu-waste
// mode (ADR 0013). Outlets never stock the porsi shelf, so its picker label
// ("belum pernah ada (0)") was pure noise. Flip to true to re-expose the toggle.
const ENABLE_PORSI_WASTE_MODE = false;

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

interface BomSelection {
  checked: boolean;
  /** Optional manual override; otherwise qty follows perPorsi × overall menu qty. */
  qtyOverride?: number;
}

/**
 * BOM picker for menu waste in "Bahan (BOM)" mode (ADR 0013): shows the
 * recipe's flat per-porsi BOM (same math as POS order intake) and lets the
 * user pick which ingredients were actually wasted, with editable integer
 * quantities. Defaults scale with the porsi count.
 */
function BomWastePicker({
  lines,
  pending,
  selection,
  onSelectionChange,
  porsiQty,
  showCost,
}: {
  lines: RecipeBomLine[];
  pending: boolean;
  selection: Record<string, BomSelection>;
  onSelectionChange: (next: Record<string, BomSelection>) => void;
  porsiQty: number;
  showCost: boolean;
}) {
  const validPorsiQty = Number.isInteger(porsiQty) && porsiQty >= 1 ? porsiQty : 1;
  const defaultQty = (line: RecipeBomLine) =>
    Math.max(1, Math.round(line.perPorsi * validPorsiQty));

  const isChecked = (id: string) => selection[id]?.checked ?? false;
  const qtyOf = (line: RecipeBomLine) =>
    selection[line.ingredientId]?.qtyOverride ?? defaultQty(line);

  const setLine = (line: RecipeBomLine, patch: Partial<BomSelection> & { qty?: number }) => {
    onSelectionChange({
      ...selection,
      [line.ingredientId]: {
        checked: patch.checked ?? isChecked(line.ingredientId),
        qtyOverride:
          patch.qty !== undefined ? patch.qty : selection[line.ingredientId]?.qtyOverride,
      },
    });
  };

  const toggleAll = (checked: boolean) => {
    const next: Record<string, BomSelection> = {};
    if (checked) {
      for (const line of lines) next[line.ingredientId] = { checked: true };
    }
    onSelectionChange(next);
  };

  const checkedCount = lines.filter((l) => isChecked(l.ingredientId)).length;
  const estimatedLoss = lines.reduce(
    (sum, l) => sum + (isChecked(l.ingredientId) ? qtyOf(l) * (l.averageCost ?? 0) : 0),
    0,
  );

  if (pending) {
    return <p className="text-xs text-muted-foreground">Memuat BOM…</p>;
  }
  if (lines.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Resep ini tidak memiliki BOM. Gunakan mode “Porsi jadi” untuk waste menu jadi.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Bahan terbuang ({checkedCount}/{lines.length} dipilih)
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleAll(true)}
            className="text-xs text-primary hover:underline underline-offset-4"
          >
            Pilih semua
          </button>
          <button
            type="button"
            onClick={() => toggleAll(false)}
            className="text-xs text-muted-foreground hover:underline underline-offset-4"
          >
            Kosongkan
          </button>
        </div>
      </div>{" "}
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="w-8 py-1.5 pl-2 pr-0 font-medium" aria-label="Pilih" />
              <th className="py-1.5 px-2 font-medium">Bahan</th>
              <th className="py-1.5 px-2 font-medium text-right">Kebutuhan/porsi</th>
              <th className="py-1.5 px-2 font-medium text-right">Stok</th>
              <th className="py-1.5 px-2 font-medium text-right">Jumlah terbuang</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const checked = isChecked(line.ingredientId);
              return (
                <tr key={line.ingredientId} className={checked ? "bg-primary/5" : ""}>
                  <td className="py-1.5 pl-2 pr-0 align-middle">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setLine(line, { checked: e.target.checked })}
                      aria-label={`Waste ${line.name}`}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <div className={checked ? "font-medium" : "text-muted-foreground"}>
                      {line.name}
                    </div>
                    {line.code && (
                      <div className="text-[10px] text-muted-foreground font-mono">{line.code}</div>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                    ×{line.perPorsi.toLocaleString("id-ID", { maximumFractionDigits: 3 })}{" "}
                    {line.stockUnit}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {line.currentQty === null ? (
                      <span className="italic text-muted-foreground">belum pernah ada</span>
                    ) : line.currentQty <= 0 ? (
                      <span className="text-amber-600 font-medium">habis</span>
                    ) : (
                      <span className="text-muted-foreground">
                        {line.currentQty.toLocaleString("id-ID")}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={qtyOf(line)}
                      disabled={!checked}
                      onChange={(e) => {
                        const v = Math.floor(Number(e.target.value));
                        setLine(line, { qty: Number.isFinite(v) && v >= 1 ? v : 1 });
                      }}
                      aria-label={`Jumlah waste ${line.name}`}
                      className="h-9 w-24 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums disabled:opacity-40 sm:h-7 sm:w-20 sm:text-xs"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showCost && checkedCount > 0 && (
        <p className="text-xs font-medium">Estimasi kerugian: {formatRupiah(estimatedLoss)}</p>
      )}
    </div>
  );
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
    filters: { category, dateFrom, dateTo, sortBy, sortDir, noInvestigation, status },
    setFilter,
  } = useTableUrlState<{
    category?: string;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: string;
    sortDir?: string;
    noInvestigation?: string;
    status?: string;
  }>(["category", "dateFrom", "dateTo", "sortBy", "sortDir", "noInvestigation", "status"]);
  const [investigationModalOpen, setInvestigationModalOpen] = useState(false);
  const [investigationEntryId, setInvestigationEntryId] = useState<string | null>(null);
  const [investigationNoteText, setInvestigationNoteText] = useState("");
  const [investigationError, setInvestigationError] = useState<string | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelEntryId, setCancelEntryId] = useState<string | null>(null);
  const [cancelReasonText, setCancelReasonText] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);

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

  // Branch picked in the modal's Cabang dropdown. Drives the inventory query so
  // stock shown matches the branch selected (central users can preview any
  // branch; branch-scoped roles stay locked to their session branch).
  const [selectedBranchId, setSelectedBranchId] = useState(
    user?.branchId ?? filteredBranches[0]?.id ?? "",
  );

  // Fetch inventory for the selected branch. `limit: 1000` keeps every
  // inventory row (getInventory defaults to 50, which truncates larger
  // branches), and `includeNonCatalog: true` shows actual branch stock even
  // for items outside the outlet catalog — a branch can physically hold and
  // waste items that aren't in its display catalog.
  const { data: inventoryResult } = useQuery({
    queryKey: ["inventory-branch", selectedBranchId],
    queryFn: () =>
      getInventory({
        data: { branchId: selectedBranchId, limit: 1000, includeNonCatalog: true },
      }),
    enabled: !!selectedBranchId,
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

  // ── Menu (recipe) waste — Bahan vs Menu toggle ──
  const [wasteTarget, setWasteTarget] = useState<"bahan" | "menu">("bahan");
  const { data: recipeInventoryResult } = useQuery({
    queryKey: ["recipe-inventory", selectedBranchId],
    queryFn: () => getRecipeInventoryForWaste({ data: { branchId: selectedBranchId } }),
    enabled: !!selectedBranchId,
  });
  const stockByRecipe = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of recipeInventoryResult ?? []) m.set(r.recipeId, r.quantity);
    return m;
  }, [recipeInventoryResult]);
  const branchHasRecipe = useMemo(() => {
    const s = new Set<string>();
    for (const r of recipeInventoryResult ?? []) if (r.hasRow) s.add(r.recipeId);
    return s;
  }, [recipeInventoryResult]);
  const recipeOptions = useMemo(() => {
    const rows = recipeInventoryResult ?? [];
    // Map recipeId → hasRow/qty for quick lookup, then build options for all visible recipes (rows)
    // If recipeInventoryResult is empty, we still have ingredient-only fallback; recipes without row show 0
    return rows
      .map((r) => ({
        id: r.recipeId,
        value: r.recipeId,
        label: `${r.name} (porsi)`,
        stockQty: r.quantity,
        stockUnit: "porsi" as const,
        hasInventory: r.hasRow,
        totalCogs: r.totalCogs,
        keywords: [r.code ?? "", "porsi"],
      }))
      .sort((a, b) => {
        if (a.hasInventory && !b.hasInventory) return -1;
        if (!a.hasInventory && b.hasInventory) return 1;
        if (a.stockQty > 0 && b.stockQty <= 0) return -1;
        if (a.stockQty <= 0 && b.stockQty > 0) return 1;
        if (b.stockQty !== a.stockQty) return b.stockQty - a.stockQty;
        return a.label.localeCompare(b.label);
      });
  }, [recipeInventoryResult]);
  const [selectedRecipe, setSelectedRecipe] = useState<(typeof recipeOptions)[number] | null>(null);
  const [recipeInputValue, setRecipeInputValue] = useState("");

  // ── Menu waste mode (ADR 0013): "porsi" deducts the ready-units shelf
  // (recipeInventory); "bom" deducts selected BOM ingredients instead.
  // Porsi mode is hidden behind ENABLE_PORSI_WASTE_MODE — BOM is the default. ──
  const [menuWasteMode, setMenuWasteMode] = useState<"porsi" | "bom">(
    ENABLE_PORSI_WASTE_MODE ? "porsi" : "bom",
  );
  // Per-BOM-line checkbox + editable qty, keyed by ingredientId.
  const [bomSelection, setBomSelection] = useState<Record<string, BomSelection>>({});
  // Controlled Jumlah (porsi count) — drives default BOM line quantities.
  const [quantityValue, setQuantityValue] = useState("1");

  const { data: bomResult, isPending: bomPending } = useQuery({
    queryKey: ["recipe-bom-waste", selectedRecipe?.id, selectedBranchId],
    queryFn: () =>
      getRecipeBomForWaste({
        data: { recipeId: selectedRecipe!.id, branchId: selectedBranchId },
      }),
    enabled:
      wasteTarget === "menu" && menuWasteMode === "bom" && !!selectedRecipe && !!selectedBranchId,
  });

  // Fresh selection whenever the recipe or branch changes.
  useEffect(() => {
    setBomSelection({});
  }, [selectedRecipe?.id, selectedBranchId]);

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

    // Filter by cancellation status
    if (status === "Active") result = result.filter((e) => e.status === "Active");
    if (status === "Cancelled") result = result.filter((e) => e.status === "Cancelled");

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
    status,
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
      void queryClient.invalidateQueries({ queryKey: ["recipe-inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory-branch"] });
      setModalOpen(false);
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal mencatat waste");
    },
  });

  const bomWasteMutation = useMutation({
    mutationFn: createBomWasteEntry,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["waste-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory-branch"] });
      void queryClient.invalidateQueries({ queryKey: ["recipe-bom-waste"] });
      setModalOpen(false);
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal mencatat waste BOM");
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

  const cancelMutation = useMutation({
    mutationFn: cancelWasteEntry,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["waste-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["recipe-inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory-branch"] });
      setCancelModalOpen(false);
      setCancelEntryId(null);
      setCancelReasonText("");
      setCancelError(null);
    },
    onError: (err) => {
      setCancelError(err instanceof Error ? err.message : "Gagal membatalkan waste");
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const quantity = Number(fd.get("quantity"));
    if (quantity < 1 || !Number.isInteger(quantity) || !Number.isFinite(quantity)) {
      setSubmitError(
        wasteTarget === "menu"
          ? "Jumlah menu/porsi harus bilangan bulat >= 1"
          : "Jumlah harus >= 1",
      );
      return;
    }
    if (wasteTarget === "menu") {
      if (!selectedRecipe) {
        setIngredientError("Pilih menu terlebih dahulu");
        return;
      }
      if (menuWasteMode === "bom") {
        const lines = (bomResult?.lines ?? [])
          .filter((l) => bomSelection[l.ingredientId]?.checked)
          .map((l) => ({
            ingredientId: l.ingredientId,
            quantity:
              bomSelection[l.ingredientId]?.qtyOverride ??
              Math.max(1, Math.round(l.perPorsi * (Number(quantityValue) || 1))),
          }));
        if (
          lines.length === 0 ||
          lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1)
        ) {
          setIngredientError("Pilih minimal satu bahan dengan jumlah ≥ 1");
          return;
        }
        setIngredientError(null);
        void bomWasteMutation.mutateAsync({
          data: {
            branchId: selectedBranchId || (user?.branchId ?? ""),
            recipeId: selectedRecipe.id,
            lines,
            category: z
              .enum(["Beban Makan", "Biaya Operasional", "Spoiled", "Denda"])
              .parse(formText(fd, "category")),
            staffName: formText(fd, "staffName") || undefined,
            notes: formText(fd, "notes") || undefined,
          },
        });
        return;
      }
      setIngredientError(null);
      // Warn, don't block — allow negative with visual warning (decision #153). Server upserts-from-0.
      const data = {
        branchId: selectedBranchId || (user?.branchId ?? ""),
        recipeId: selectedRecipe.id,
        quantity,
        category: z
          .enum(["Beban Makan", "Biaya Operasional", "Spoiled", "Denda"])
          .parse(formText(fd, "category")),
        staffName: formText(fd, "staffName") || undefined,
        notes: formText(fd, "notes") || undefined,
      };
      void createMutation.mutateAsync({ data });
      return;
    }
    if (!selectedIngredient) {
      setIngredientError("Pilih bahan terlebih dahulu");
      return;
    }
    setIngredientError(null);
    // Warn, don't block — allow-negative now (decision #153). Previous clamp removed.
    const data = {
      branchId: selectedBranchId || (user?.branchId ?? ""),
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

  const handleOpenCancel = (entry: WasteRow) => {
    setCancelEntryId(entry.id);
    setCancelReasonText("");
    setCancelError(null);
    setCancelModalOpen(true);
  };

  const handleCancelSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!cancelEntryId || !cancelReasonText.trim()) return;
    void cancelMutation.mutateAsync({
      data: { wasteEntryId: cancelEntryId, reason: cancelReasonText.trim() },
    });
  };

  usePageTitle("Waste", "Pencatatan sisa produksi, jatah makan, dan barang rusak");

  // Branch admins must not see the HPP-derived valuation (qty × averageCost).
  const isBranchAdmin = user?.role === "branch_admin";
  // Only super_admin (all branches) and area_manager (assigned branches) may cancel.
  const canCancel = user?.role === "super_admin" || user?.role === "area_manager";

  const columns: Column<WasteRow>[] = [
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
    {
      accessorKey: "ingredientName",
      header: "Target",
      enableSorting: true,
      cell: ({ row }) => {
        const isRecipe = !!row.original.recipeId;
        return (
          <div>
            <div className="font-medium">
              {isRecipe ? (row.original.recipeName ?? "—") : (row.original.ingredientName ?? "—")}
            </div>
            <div className="text-xs text-muted-foreground">
              {isRecipe ? (row.original.recipeCode ?? "") : (row.original.ingredientCode ?? "")} ·{" "}
              {isRecipe ? "Menu" : "Bahan"}
            </div>
          </div>
        );
      },
    },
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
        const isRecipe = !!row.original.recipeId;
        const current = isRecipe
          ? (row.original.currentRecipeQty ?? 0)
          : (row.original.currentInventoryQty ?? 0);
        const wastePercentage =
          current + row.original.quantity > 0
            ? (row.original.quantity / (current + row.original.quantity)) * 100
            : 0;
        const isAnomaly = row.original.status !== "Cancelled" && wastePercentage > 5;
        const unit = isRecipe ? "porsi" : (row.original.stockUnit ?? "");
        return (
          <div className={isAnomaly ? "text-rose-600 font-medium" : ""}>
            {row.original.quantity.toLocaleString("id-ID")}
            {unit && <span className="text-muted-foreground ml-0.5">{unit}</span>}
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
          // SAFETY: the object literal has the same accessorKey/header/cell
          // shape as the other WasteRow columns; the annotation restores the
          // contextual typing that conditional-spread arrays lose.
          {
            accessorKey: "valuation",
            header: "Nilai Kerugian",
            align: "right" as const,
            width: "w-32",
            enableSorting: true,
            cell: ({ row }) => formatRupiah(row.original.valuation),
          } as Column<WasteRow>,
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
        const isAnomaly = row.original.status !== "Cancelled" && wastePercentage > 5;
        const canInvestigate = user?.role === "super_admin" || user?.role === "area_manager";

        if (row.original.status === "Cancelled") {
          return (
            <div className="space-y-1">
              <Badge variant="secondary" className="text-xs">
                Dibatalkan
              </Badge>
              <div className="text-xs text-muted-foreground line-clamp-2 max-w-[160px]">
                {row.original.cancelReason ?? "-"}
              </div>
              {row.original.cancelledByName && (
                <div className="text-[11px] text-muted-foreground">
                  oleh {row.original.cancelledByName}
                </div>
              )}
            </div>
          );
        }

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
    // Cancel action — only super_admin / area_manager, and only while Active.
    ...(canCancel
      ? [
          {
            accessorKey: "cancel",
            header: "",
            width: "w-20",
            cell: ({ row }: { row: { original: WasteRow } }) =>
              row.original.status === "Cancelled" ? null : (
                <button
                  onClick={() => handleOpenCancel(row.original)}
                  className="text-xs px-2.5 py-1 rounded-md border border-input text-foreground hover:bg-muted transition-colors"
                >
                  Batalkan
                </button>
              ),
          },
        ]
      : []),
  ];

  const totalValuation = useMemo(() => {
    return filteredEntries.reduce(
      (sum, e) => sum + (e.status === "Cancelled" ? 0 : (e.valuation ?? 0)),
      0,
    );
  }, [filteredEntries]);

  const wasteCategories = ["Beban Makan", "Biaya Operasional", "Spoiled", "Denda"] as const;
  const totalPages = Math.ceil(filteredEntries.length / 15) || 1;
  const pagedEntries = filteredEntries.slice(page * 15, (page + 1) * 15);
  const hasActiveFilters = !!(
    category ||
    search ||
    noInvestigation === "true" ||
    dateFrom ||
    dateTo
  );

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
      {/* Summary — compact, HPP total hidden for branch_admin */}
      {!isBranchAdmin && (
        <div className="mb-4">
          <div className="rounded-xl sm:rounded-lg border bg-card p-3.5 sm:p-4 shadow-xs">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
                  Total Kerugian
                </div>
                <div className="text-xl sm:text-2xl font-semibold tracking-tight tabular-nums truncate">
                  {formatRupiah(totalValuation)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  <CalendarDays className="h-3 w-3" />
                  {effectiveDateFrom} — {effectiveDateTo}
                </div>
              </div>
              <div className="hidden sm:flex flex-col items-end gap-1 shrink-0">
                <span className="text-xs text-muted-foreground">
                  {filteredEntries.length} entri • {formatRupiah(totalValuation)}
                </span>
              </div>
              <div className="sm:hidden shrink-0 text-right">
                <div className="text-[11px] text-muted-foreground">
                  {filteredEntries.length} entri
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Adaptive toolbar: search first on mobile ── */}
      <div className="mb-4 space-y-3">
        {/* Row 1 — Search + primary action */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-[380px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              autoComplete="off"
              aria-label="Cari waste"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari bahan, kode, catatan…"
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
          <button
            onClick={() => {
              setModalOpen(true);
              setIngredientError(null);
            }}
            className="inline-flex items-center justify-center gap-1.5 h-11 sm:h-9 px-4 rounded-xl sm:rounded-md bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:bg-primary/90 active:scale-[0.98] transition-all sm:ml-auto shrink-0 w-full sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            Input Waste
          </button>
        </div>

        {/* Row 2 — Date range */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
          <input
            type="date"
            value={effectiveDateFrom}
            onChange={(e) => {
              setFilter("dateFrom", e.target.value);
              setPage(0);
            }}
            aria-label="Tanggal awal"
            className="h-11 sm:h-9 w-full rounded-xl sm:rounded-md border border-input bg-background px-3 text-[15px] sm:text-sm font-medium shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="flex items-center justify-center text-muted-foreground text-sm font-medium px-1">
            —
          </span>
          <input
            type="date"
            value={effectiveDateTo}
            onChange={(e) => {
              setFilter("dateTo", e.target.value);
              setPage(0);
            }}
            aria-label="Tanggal akhir"
            className="h-11 sm:h-9 w-full rounded-xl sm:rounded-md border border-input bg-background px-3 text-[15px] sm:text-sm font-medium shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {/* Row 3 — Category pills + sort, edge-to-edge scroll on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0 pb-0.5 snap-x snap-mandatory">
          <div className="flex items-center gap-1.5 shrink-0 snap-start">
            <button
              onClick={() => {
                setFilter("category", "");
                setPage(0);
              }}
              aria-pressed={!category}
              className={`shrink-0 snap-start inline-flex items-center h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${!category ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
            >
              Semua
            </button>
            {wasteCategories.map((cat) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  onClick={() => {
                    setFilter("category", active ? "" : cat);
                    setPage(0);
                  }}
                  aria-pressed={active}
                  className={`shrink-0 snap-start inline-flex items-center h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${active ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 snap-start">
            {(["", "Active", "Cancelled"] as const).map((s) => {
              const label = s === "" ? "Semua" : s === "Active" ? "Aktif" : "Dibatalkan";
              const active = (status ?? "") === s;
              return (
                <button
                  key={s}
                  onClick={() => {
                    setFilter("status", active ? "" : s);
                    setPage(0);
                  }}
                  aria-pressed={active}
                  className={`shrink-0 snap-start inline-flex items-center h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${active ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="shrink-0 h-5 w-px bg-border mx-1 hidden sm:block" />
          <div className="flex items-center gap-1.5 shrink-0 snap-start">
            <select
              value={effectiveSortBy}
              onChange={(e) => {
                setFilter("sortBy", e.target.value);
                setPage(0);
              }}
              aria-label="Urut berdasarkan"
              className="h-8 rounded-full border border-input bg-background px-3 pr-7 text-xs font-medium shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="date">Tanggal</option>
              <option value="category">Kategori</option>
            </select>
            <button
              type="button"
              onClick={() => {
                setFilter("sortDir", effectiveSortDir === "asc" ? "desc" : "asc");
                setPage(0);
              }}
              aria-label={effectiveSortDir === "asc" ? "Urut naik" : "Urut turun"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-background text-xs font-medium hover:bg-muted active:scale-95 transition-all shrink-0"
            >
              {effectiveSortDir === "asc" ? (
                <ArrowUp className="h-3.5 w-3.5" />
              ) : (
                <ArrowDown className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile meta */}
        <div className="flex items-center justify-between sm:hidden text-xs">
          <span className="text-muted-foreground tabular-nums">
            {filteredEntries.length} entri • Hal {page + 1} / {totalPages}
          </span>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setFilter("category", "");
                setFilter("dateFrom", "");
                setFilter("dateTo", "");
                setFilter("sortBy", "");
                setFilter("sortDir", "");
                setFilter("noInvestigation", "");
                setFilter("status", "");
                setSearch("");
                setPage(0);
              }}
              className="font-medium text-primary hover:underline underline-offset-4"
            >
              Reset filter
            </button>
          )}
        </div>
      </div>

      {/* Mobile cards — hidden on desktop */}
      <div className="md:hidden space-y-2.5 -mx-4 px-4">
        {pagedEntries.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
            <p className="text-sm font-medium">Tidak ada data waste</p>
            <p className="text-xs text-muted-foreground mt-1">Ubah filter atau rentang tanggal</p>
          </div>
        ) : (
          pagedEntries.map((row) => {
            const isRecipeRow = !!row.recipeId;
            const current = isRecipeRow
              ? (row.currentRecipeQty ?? 0)
              : (row.currentInventoryQty ?? 0);
            const wastePct =
              current + row.quantity > 0 ? (row.quantity / (current + row.quantity)) * 100 : 0;
            const isAnomaly = row.status !== "Cancelled" && wastePct > 5;
            const canInvestigate = user?.role === "super_admin" || user?.role === "area_manager";
            return (
              <div
                key={row.id}
                className={`rounded-xl border bg-card p-3.5 shadow-xs ${isAnomaly ? "border-rose-200 bg-rose-50/20 dark:border-rose-900/30" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">
                        {(row.recipeId ? row.recipeName : row.ingredientName) ?? "—"}
                      </span>
                      {(row.recipeId ? row.recipeCode : row.ingredientCode) && (
                        <span className="text-[11px] text-muted-foreground font-mono">
                          {row.recipeId ? row.recipeCode : row.ingredientCode}
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {row.recipeId ? "Menu" : "Bahan"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <Badge
                        variant={catColors[row.category]}
                        className="text-[11px] px-2 py-0 h-5"
                      >
                        {row.category}
                      </Badge>
                      {isAnomaly && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600">
                          <AlertCircle className="h-3 w-3" />
                          {wastePct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`text-sm font-semibold tabular-nums ${isAnomaly ? "text-rose-600" : ""}`}
                    >
                      {row.quantity.toLocaleString("id-ID")}
                      <span className="text-xs font-normal text-muted-foreground ml-1">
                        {row.recipeId ? "porsi" : (row.stockUnit ?? "")}
                      </span>
                    </div>
                    {!isBranchAdmin && (
                      <div className="text-xs tabular-nums text-muted-foreground">
                        {formatRupiah(row.valuation)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <div>
                    <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                      Waktu
                    </div>
                    <div className="tabular-nums">
                      {new Date(row.createdAt).toLocaleString("id-ID", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                      Cabang
                    </div>
                    <div className="truncate">{row.branchName ?? "—"}</div>
                  </div>
                  {row.notes && (
                    <div className="col-span-2">
                      <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                        Keterangan
                      </div>
                      <div className="line-clamp-2 text-muted-foreground">{row.notes}</div>
                    </div>
                  )}
                </div>
                <div className="mt-2.5 pt-2.5 border-t flex items-center justify-between gap-2">
                  {row.status === "Cancelled" ? (
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium flex items-center gap-1">
                        <Badge variant="secondary" className="text-[11px] h-4 px-1.5">
                          Dibatalkan
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-1">
                        {row.cancelReason ?? "-"}
                      </div>
                    </div>
                  ) : row.investigationNote ? (
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium flex items-center gap-1">
                        <Badge variant="secondary" className="text-[11px] h-4 px-1.5">
                          Diinvestigasi
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-1">
                        {row.investigationNote}
                      </div>
                    </div>
                  ) : isAnomaly ? (
                    canInvestigate ? (
                      <button
                        onClick={() => handleOpenInvestigation(row)}
                        className="inline-flex items-center justify-center h-8 px-3 rounded-full bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 active:scale-[0.98] transition-all"
                      >
                        Investigasi
                      </button>
                    ) : (
                      <Badge variant="destructive" className="text-xs">
                        Butuh Investigasi
                      </Badge>
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                  {canCancel && row.status !== "Cancelled" && (
                    <button
                      onClick={() => handleOpenCancel(row)}
                      className="inline-flex items-center justify-center h-8 px-3 rounded-full border text-xs font-medium hover:bg-muted active:scale-[0.98] transition-all shrink-0"
                    >
                      Batalkan
                    </button>
                  )}
                  <span className="text-[11px] text-muted-foreground hidden sm:inline">
                    {getFinancialClassificationLabel(row.category)}
                  </span>
                </div>
              </div>
            );
          })
        )}
        {totalPages > 1 && (
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

      <div className="hidden md:block -mx-4 md:mx-0">
        <DataTable
          searchable={false}
          columns={columns}
          data={filteredEntries}
          keyExtractor={(r) => r.id}
          pageSize={15}
          page={page}
          onPageChange={setPage}
          rowClassName={(r) => {
            const cur = r.recipeId ? (r.currentRecipeQty ?? 0) : (r.currentInventoryQty ?? 0);
            const wastePercentage =
              cur + r.quantity > 0 ? (r.quantity / (cur + r.quantity)) * 100 : 0;
            return r.status !== "Cancelled" && wastePercentage > 5 ? "bg-rose-50/30" : "";
          }}
        />
      </div>

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
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-5 sm:space-y-4">
          {submitError && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}
          <div className="space-y-2">
            <label htmlFor="waste-branch" className="text-sm font-medium">
              Cabang
            </label>
            <select
              id="waste-branch"
              name="branchId"
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
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
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Target</legend>
            <div className="flex w-full rounded-xl bg-muted p-1 gap-1 sm:w-fit sm:rounded-full">
              <button
                type="button"
                onClick={() => setWasteTarget("bahan")}
                className={`flex-1 px-4 py-2 rounded-lg text-xs font-semibold transition-colors sm:flex-none sm:rounded-full ${wasteTarget === "bahan" ? "bg-foreground text-background shadow-sm" : "text-muted-foreground"}`}
              >
                Bahan
              </button>
              <button
                type="button"
                onClick={() => setWasteTarget("menu")}
                className={`flex-1 px-4 py-2 rounded-lg text-xs font-semibold transition-colors sm:flex-none sm:rounded-full ${wasteTarget === "menu" ? "bg-foreground text-background shadow-sm" : "text-muted-foreground"}`}
              >
                Menu
              </button>
            </div>
          </fieldset>
          {wasteTarget === "bahan" ? (
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
              {selectedIngredient && (
                <p
                  className={`text-xs ${!branchHasIngredient.has(selectedIngredient.id) ? "text-amber-600" : (stockByIngredient.get(selectedIngredient.id) ?? 0) <= 0 ? "text-amber-600" : "text-muted-foreground"}`}
                >
                  {!branchHasIngredient.has(selectedIngredient.id)
                    ? `Belum pernah ada di cabang ini — akan dibuat (0 → ${(stockByIngredient.get(selectedIngredient.id) ?? 0) - 1} ${selectedIngredient.stockUnit}) ⚠ negative allowed`
                    : `Stok tersedia: ${stockByIngredient.get(selectedIngredient.id) ?? 0} ${selectedIngredient.stockUnit} → sisa ${(stockByIngredient.get(selectedIngredient.id) ?? 0) - 1} ${selectedIngredient.stockUnit} ${(stockByIngredient.get(selectedIngredient.id) ?? 0) <= 0 ? " ⚠ akan negative" : ""}`}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium">Menu</label>
              <Combobox
                value={selectedRecipe}
                onValueChange={(val) => {
                  setSelectedRecipe(val);
                  setRecipeInputValue(val ? val.label : "");
                  if (val) setIngredientError(null);
                }}
                inputValue={recipeInputValue}
                onInputValueChange={setRecipeInputValue}
                items={recipeOptions}
                itemToStringValue={(item) => item.id}
                itemToStringLabel={(item) => item.label}
                isItemEqualToValue={(a, b) => a?.id === b?.id}
              >
                <ComboboxInput
                  showTrigger
                  showClear={!!selectedRecipe}
                  placeholder="Pilih menu (mis. Iced Tea)..."
                  className={ingredientError ? "border-destructive" : ""}
                />
                <ComboboxContent container={formRef.current}>
                  <ComboboxList>
                    {(item: (typeof recipeOptions)[number]) => (
                      <ComboboxItem key={item.id} value={item}>
                        <div className="flex items-center justify-between w-full">
                          <span
                            className={item.hasInventory && item.stockQty <= 0 ? "opacity-50" : ""}
                          >
                            {item.label}
                          </span>
                          {/* No recipeInventory row → no label: outlets never stock
                              the porsi shelf, so "belum pernah ada (0)" was noise. */}
                          {item.hasInventory && (
                            <span
                              className={
                                "text-xs " +
                                (item.stockQty <= 0
                                  ? "text-amber-600 font-medium"
                                  : "text-muted-foreground")
                              }
                            >
                              {item.stockQty <= 0 ? "habis" : `Stok: ${item.stockQty} porsi`}
                            </span>
                          )}
                        </div>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                  <ComboboxEmpty>Tidak ada menu yang cocok</ComboboxEmpty>
                </ComboboxContent>
              </Combobox>
              {ingredientError && <p className="text-xs text-destructive">{ingredientError}</p>}
              {selectedRecipe && (
                <div className="space-y-2">
                  {/* Waste mode (ADR 0013): deduct the porsi shelf, or explode into BOM
                      ingredients. The porsi toggle is hidden behind a feature flag. */}
                  {ENABLE_PORSI_WASTE_MODE && (
                    <div className="flex rounded-full bg-muted p-1 w-fit gap-1">
                      <button
                        type="button"
                        onClick={() => setMenuWasteMode("porsi")}
                        className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${menuWasteMode === "porsi" ? "bg-foreground text-background shadow-sm" : "text-muted-foreground"}`}
                      >
                        Porsi jadi
                      </button>
                      <button
                        type="button"
                        onClick={() => setMenuWasteMode("bom")}
                        className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${menuWasteMode === "bom" ? "bg-foreground text-background shadow-sm" : "text-muted-foreground"}`}
                      >
                        Bahan (BOM)
                      </button>
                    </div>
                  )}
                  {menuWasteMode === "porsi" ? (
                    <>
                      <p
                        className={`text-xs ${!branchHasRecipe.has(selectedRecipe.id) ? "text-amber-600" : (stockByRecipe.get(selectedRecipe.id) ?? 0) <= 0 ? "text-amber-600" : "text-muted-foreground"}`}
                      >
                        {!branchHasRecipe.has(selectedRecipe.id)
                          ? `Belum pernah ada di cabang ini — akan dibuat (0 → ${(stockByRecipe.get(selectedRecipe.id) ?? 0) - 1} porsi) ⚠ negative allowed`
                          : `Stok tersedia: ${stockByRecipe.get(selectedRecipe.id) ?? 0} porsi → sisa ${(stockByRecipe.get(selectedRecipe.id) ?? 0) - 1} porsi ${(stockByRecipe.get(selectedRecipe.id) ?? 0) <= 0 ? " ⚠ akan negative" : ""}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Nilai kerugian: qty × totalCogs (HPP per porsi) — snapshot saat simpan. Iced
                        tea glass spilled = 1 porsi.
                      </p>
                    </>
                  ) : (
                    <BomWastePicker
                      lines={bomResult?.lines ?? []}
                      pending={bomPending}
                      selection={bomSelection}
                      onSelectionChange={setBomSelection}
                      porsiQty={Number(quantityValue) || 1}
                      showCost={!isBranchAdmin}
                    />
                  )}
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <label className="text-sm font-medium">
                {wasteTarget === "menu" ? "Jumlah Porsi" : "Jumlah bahan"}
              </label>
              <input
                name="quantity"
                type="number"
                min={1}
                step={1}
                required
                value={quantityValue}
                onChange={(e) => setQuantityValue(e.target.value)}
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
              aria-label="Keterangan"
              className="w-full rounded-md border border-input bg-background px-3 py-3 text-sm min-h-[96px] resize-none sm:min-h-[60px] sm:py-2"
            />
          </div>
          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end sm:border-0 sm:pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="h-11 w-full rounded-xl border px-4 text-sm sm:h-9 sm:w-auto sm:rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || bomWasteMutation.isPending}
              className="h-11 w-full rounded-xl bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50 sm:h-9 sm:w-auto sm:rounded-md"
            >
              {createMutation.isPending ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={cancelModalOpen}
        onClose={() => {
          setCancelModalOpen(false);
          setCancelEntryId(null);
          setCancelReasonText("");
          setCancelError(null);
        }}
        title="Batalkan Waste"
        size="sm"
      >
        <form onSubmit={handleCancelSubmit} className="space-y-4">
          {cancelError && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{cancelError}</span>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Stok akan dikembalikan ke inventori dan nilai kerugian dihapus dari total. Tindakan ini
            tidak dapat dibatalkan.
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium">Alasan Pembatalan</label>
            <textarea
              value={cancelReasonText}
              onChange={(e) => setCancelReasonText(e.target.value)}
              required
              placeholder="Tulis alasan pembatalan..."
              className="w-full rounded-md border border-input bg-background px-3 py-3 md:py-2 text-sm min-h-[140px] md:min-h-[120px] resize-none"
            />
          </div>
          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end sm:border-0 sm:pt-2">
            <button
              type="button"
              onClick={() => {
                setCancelModalOpen(false);
                setCancelEntryId(null);
                setCancelReasonText("");
                setCancelError(null);
              }}
              className="h-11 w-full rounded-xl border px-4 text-sm sm:h-9 sm:w-auto sm:rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={cancelMutation.isPending}
              className="h-11 w-full rounded-xl bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50 sm:h-9 sm:w-auto sm:rounded-md"
            >
              {cancelMutation.isPending ? "Menyimpan..." : "Batalkan Waste"}
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
          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end sm:border-0 sm:pt-2">
            <button
              type="button"
              onClick={() => {
                setInvestigationModalOpen(false);
                setInvestigationEntryId(null);
                setInvestigationNoteText("");
                setInvestigationError(null);
              }}
              className="h-11 w-full rounded-xl border px-4 text-sm sm:h-9 sm:w-auto sm:rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={investigationMutation.isPending}
              className="h-11 w-full rounded-xl bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50 sm:h-9 sm:w-auto sm:rounded-md"
            >
              {investigationMutation.isPending ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
