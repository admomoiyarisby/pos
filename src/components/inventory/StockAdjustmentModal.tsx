import { useState, useMemo, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Modal from "#/components/ui/Modal";
import { AlertCircle, Plus, X } from "lucide-react";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "#/components/ui/combobox";
import { adjustBranchStockBatch } from "#/lib/server/inventory";

export interface IngredientOption {
  id: string;
  name: string;
  code: string | null;
  stockUnit: string | null;
  category: string | null;
  label: string;
  stockQty: number;
  hasInventory: boolean;
  keywords: string[];
}

interface LineItem {
  id: string;
  ingredient: IngredientOption | null;
  ingredientInput: string;
  direction: "IN" | "OUT";
  quantity: string;
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export interface StockAdjustmentModalProps {
  open: boolean;
  onClose: () => void;
  branches: { id: string; name: string }[];
  defaultBranchId?: string;
  ingredientOptions: IngredientOption[];
  stockByIngredient: Map<string, number>;
}

export default function StockAdjustmentModal({
  open,
  onClose,
  branches,
  defaultBranchId,
  ingredientOptions,
  stockByIngredient,
}: StockAdjustmentModalProps) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<LineItem[]>([]);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set(["Fresh", "Dry", "Packaging"]));
  const [pickerOpen, setPickerOpen] = useState(true);
  const [branchPickerOpen, setBranchPickerOpen] = useState(true);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);

  const allBranchesSelected = branches.length > 0 && selectedBranchIds.length === branches.length;
  const someBranchesSelected = selectedBranchIds.length > 0 && !allBranchesSelected;
  const previewIsSingleDefault =
    selectedBranchIds.length === 1 && selectedBranchIds[0] === defaultBranchId;

  function toggleBranch(id: string) {
    setSelectedBranchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  // Fresh state every time the modal opens.
  useEffect(() => {
    if (open) {
      setSubmitError(null);
      setReason("");
      setLines([
        { id: makeId(), ingredient: null, ingredientInput: "", direction: "IN", quantity: "" },
      ]);
      setOpenCats(new Set(["Fresh", "Dry", "Packaging"]));
      setPickerOpen(true);
      setBranchPickerOpen(true);
      setSelectedBranchIds(defaultBranchId ? [defaultBranchId] : []);
    }
  }, [open]);

  // Ingredients already chosen in OTHER lines are hidden from a line's combobox
  // so the same ingredient cannot be added twice in one batch.
  const selectedElsewhere = (lineId: string) =>
    new Set(lines.filter((l) => l.id !== lineId && l.ingredient).map((l) => l.ingredient!.id));

  const adjustMutation = useMutation({
    mutationFn: adjustBranchStockBatch,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-ledger"] });
      onClose();
    },
    onError: (err) =>
      setSubmitError(err instanceof Error ? err.message : "Gagal menyesuaikan stok"),
  });

  function updateLine(id: string, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  function isIncluded(id: string) {
    return lines.some((l) => l.ingredient?.id === id);
  }

  function toggleInclude(opt: IngredientOption) {
    if (isIncluded(opt.id)) {
      setLines((prev) => prev.filter((l) => l.ingredient?.id !== opt.id));
    } else {
      setLines((prev) => [
        ...prev,
        {
          id: makeId(),
          ingredient: opt,
          ingredientInput: opt.label,
          direction: "IN",
          quantity: "",
        },
      ]);
    }
  }

  function toggleCatAll(cat: string) {
    const opts = grouped[cat] ?? [];
    const allIn = opts.length > 0 && opts.every((o) => isIncluded(o.id));
    if (allIn) {
      const ids = new Set(opts.map((o) => o.id));
      setLines((prev) => prev.filter((l) => !(l.ingredient && ids.has(l.ingredient.id))));
    } else {
      setLines((prev) => {
        const existing = new Set(prev.map((l) => l.ingredient?.id).filter(Boolean) as string[]);
        const toAdd = opts
          .filter((o) => !existing.has(o.id))
          .map((o) => ({
            id: makeId(),
            ingredient: o,
            ingredientInput: o.label,
            direction: "IN" as const,
            quantity: "",
          }));
        return [...prev, ...toAdd];
      });
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (selectedBranchIds.length === 0) {
      setSubmitError("Minimal satu cabang harus dipilih");
      return;
    }
    if (!reason.trim()) {
      setSubmitError("Alasan penyesuaian wajib diisi");
      return;
    }
    const valid = lines.filter((l) => l.ingredient && Number(l.quantity) > 0);
    if (valid.length === 0) {
      setSubmitError("Minimal satu bahan dengan jumlah valid harus diisi");
      return;
    }
    const ids = valid.map((l) => l.ingredient!.id);
    if (new Set(ids).size !== ids.length) {
      setSubmitError("Bahan duplikat dalam satu penyesuaian");
      return;
    }
    const badOut = valid.find(
      (l) =>
        l.direction === "OUT" && previewIsSingleDefault && !stockByIngredient.has(l.ingredient!.id),
    );
    if (badOut) {
      setSubmitError(
        `Tidak dapat mengurangi "${badOut.ingredient!.name}" — bahan belum ada di cabang ini`,
      );
      return;
    }
    void adjustMutation.mutateAsync({
      data: {
        branchIds: selectedBranchIds,
        reason: reason.trim(),
        items: valid.map((l) => ({
          ingredientId: l.ingredient!.id,
          direction: l.direction,
          quantity: Number(l.quantity),
        })),
      },
    });
  }

  const grouped = useMemo(() => {
    const m: Record<string, IngredientOption[]> = {};
    for (const o of ingredientOptions) {
      const cat = o.category ?? "Lainnya";
      (m[cat] ??= []).push(o);
    }
    return m;
  }, [ingredientOptions]);
  const categoryOrder = ["Fresh", "Dry", "Packaging", "Lainnya"];

  return (
    <Modal open={open} onClose={onClose} title="Sesuaikan Stok (Multi)" size="3xl">
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
        {submitError && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{submitError}</span>
          </div>
        )}

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setBranchPickerOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium"
          >
            <span>Cabang ({selectedBranchIds.length} dipilih)</span>
            <span className="text-muted-foreground">{branchPickerOpen ? "▾" : "▸"}</span>
          </button>
          {branchPickerOpen && (
            <div className="rounded-md border max-h-44 overflow-y-auto p-1">
              <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted/50 cursor-pointer border-b">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer"
                  ref={(el) => {
                    if (el) el.indeterminate = someBranchesSelected;
                  }}
                  checked={allBranchesSelected}
                  onChange={() =>
                    setSelectedBranchIds(allBranchesSelected ? [] : branches.map((b) => b.id))
                  }
                />
                <span className="font-medium">Pilih Semua Cabang</span>
              </label>
              {branches.map((b) => (
                <label
                  key={b.id}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer"
                    checked={selectedBranchIds.includes(b.id)}
                    onChange={() => toggleBranch(b.id)}
                  />
                  <span className="truncate">{b.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium"
          >
            <span>Pilih Bahan Cepat (centang per tipe)</span>
            <span className="text-muted-foreground">{pickerOpen ? "▾" : "▸"}</span>
          </button>
          {pickerOpen && (
            <div className="rounded-md border max-h-[34vh] overflow-y-auto">
              {categoryOrder
                .filter((c) => grouped[c]?.length)
                .map((cat) => {
                  const opts = grouped[cat] ?? [];
                  const catAll = opts.length > 0 && opts.every((o) => isIncluded(o.id));
                  const catSome = opts.some((o) => isIncluded(o.id));
                  return (
                    <div key={cat} className="border-b last:border-b-0">
                      <div className="flex w-full items-center justify-between px-3 py-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            aria-label={`Pilih semua ${cat}`}
                            className="h-4 w-4 cursor-pointer"
                            ref={(el) => {
                              if (el) el.indeterminate = catSome && !catAll;
                            }}
                            checked={catAll}
                            onChange={() => toggleCatAll(cat)}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setOpenCats((prev) => {
                                const next = new Set(prev);
                                if (next.has(cat)) next.delete(cat);
                                else next.add(cat);
                                return next;
                              })
                            }
                            className="text-sm font-medium hover:underline"
                          >
                            {cat}
                            <span className="text-muted-foreground text-xs">
                              {" "}
                              ({grouped[cat].length})
                            </span>
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setOpenCats((prev) => {
                              const next = new Set(prev);
                              if (next.has(cat)) next.delete(cat);
                              else next.add(cat);
                              return next;
                            })
                          }
                          className="text-muted-foreground"
                          aria-label={openCats.has(cat) ? "Tutup" : "Buka"}
                        >
                          {openCats.has(cat) ? "▾" : "▸"}
                        </button>
                      </div>
                      {openCats.has(cat) && (
                        <div className="divide-y">
                          {opts.map((opt) => (
                            <label
                              key={opt.id}
                              className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 cursor-pointer"
                                checked={isIncluded(opt.id)}
                                onChange={() => toggleInclude(opt)}
                              />
                              <span className="flex-1 truncate">{opt.name}</span>
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {opt.stockUnit} · {opt.stockQty}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            Daftar Bahan <span className="text-muted-foreground">({lines.length})</span>
          </span>
          <button
            type="button"
            onClick={() =>
              setLines((prev) => [
                ...prev,
                {
                  id: makeId(),
                  ingredient: null,
                  ingredientInput: "",
                  direction: "IN",
                  quantity: "",
                },
              ])
            }
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border text-xs hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" /> Tambah Baris
          </button>
        </div>

        <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
          {lines.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Belum ada bahan. Klik “Tambah Baris”.
            </p>
          )}
          {lines.map((line) => {
            const currentQty = line.ingredient
              ? (stockByIngredient.get(line.ingredient.id) ?? 0)
              : 0;
            const parsedQty = Number(line.quantity);
            const preview =
              line.ingredient && Number.isFinite(parsedQty) && parsedQty > 0
                ? currentQty + (line.direction === "IN" ? parsedQty : -parsedQty)
                : null;
            const wouldBeNegative = preview !== null && preview < 0;
            const outMissing =
              line.direction === "OUT" &&
              line.ingredient &&
              previewIsSingleDefault &&
              !stockByIngredient.has(line.ingredient.id);
            const available = ingredientOptions.filter(
              (o) => !selectedElsewhere(line.id).has(o.id) || o.id === line.ingredient?.id,
            );
            return (
              <div
                key={line.id}
                className="grid grid-cols-[1fr_110px_90px_120px_28px] gap-2 items-start rounded-md border p-2"
              >
                <div className="space-y-1">
                  <Combobox
                    value={line.ingredient}
                    onValueChange={(val) => {
                      updateLine(line.id, {
                        ingredient: val,
                        ingredientInput: val ? val.label : "",
                      });
                    }}
                    inputValue={line.ingredientInput}
                    onInputValueChange={(v) => updateLine(line.id, { ingredientInput: v })}
                    items={available}
                    itemToStringValue={(item) => item.id}
                    itemToStringLabel={(item) => item.label}
                    isItemEqualToValue={(a, b) => a?.id === b?.id}
                  >
                    <ComboboxInput
                      showTrigger
                      showClear={!!line.ingredient}
                      placeholder="Pilih bahan..."
                    />
                    <ComboboxContent container={formRef.current}>
                      <ComboboxList>
                        {(item: IngredientOption) => (
                          <ComboboxItem key={item.id} value={item}>
                            <div className="flex items-center justify-between w-full">
                              <span>{item.label}</span>
                              <span className="text-xs text-muted-foreground">
                                {item.hasInventory ? `Stok: ${item.stockQty}` : "belum ada"}
                              </span>
                            </div>
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                      <ComboboxEmpty>Tidak ada bahan yang cocok</ComboboxEmpty>
                    </ComboboxContent>
                  </Combobox>
                  {outMissing && (
                    <p className="text-xs text-destructive">
                      Bahan belum ada di cabang ini; tidak dapat dikurangi
                    </p>
                  )}
                </div>

                <select
                  value={line.direction}
                  onChange={(e) =>
                    updateLine(line.id, { direction: e.target.value as "IN" | "OUT" })
                  }
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="IN">Masuk</option>
                  <option value="OUT">Keluarkan</option>
                </select>

                <input
                  type="number"
                  min={0.0001}
                  step="any"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                  placeholder="Jml"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                />

                <div className="h-9 flex flex-col justify-center text-xs">
                  {line.ingredient ? (
                    previewIsSingleDefault ? (
                      <>
                        <span className="text-muted-foreground">
                          skrg: {currentQty.toLocaleString("id-ID")}
                        </span>
                        {preview !== null && (
                          <span className={wouldBeNegative ? "text-destructive font-medium" : ""}>
                            → {preview.toLocaleString("id-ID")}
                            {wouldBeNegative ? " ⚠" : ""}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        {line.direction === "IN" ? "+" : "−"}
                        {Number(line.quantity).toLocaleString("id-ID")} × {selectedBranchIds.length}{" "}
                        cabang
                      </span>
                    )
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => removeLine(line.id)}
                  className="h-9 w-7 rounded-md border text-muted-foreground hover:bg-muted flex items-center justify-center"
                  title="Hapus baris"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Alasan <span className="text-destructive">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            placeholder="Berlaku untuk semua baris, contoh: koreksi opname, barang rusak, saldo awal..."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-md border text-sm">
            Batal
          </button>
          <button
            type="submit"
            disabled={adjustMutation.isPending || lines.length === 0}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
          >
            {adjustMutation.isPending ? "Menyimpan..." : "Simpan Penyesuaian"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
