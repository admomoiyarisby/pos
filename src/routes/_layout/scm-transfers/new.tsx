import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import { usePageTitle } from "#/hooks/usePageTitle";
import RoleGuard from "#/components/RoleGuard";
import { Button } from "#/components/ui/button";
import { AlertCircle, ArrowLeft, Plus, Trash2 } from "lucide-react";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "#/components/ui/combobox";
import { createMutasiTransfer } from "#/lib/server/scm-transfers";
import { getBranches } from "#/lib/server/branches";
import { getIngredients } from "#/lib/server/ingredients";
import { getInventory } from "#/lib/server/inventory";
import { useUnsavedDraft } from "#/hooks/useUnsavedDraft";
import { RestoreDraftBanner } from "#/components/draft/RestoreDraftBanner";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/_layout/scm-transfers/new")({
  component: NewMutasiPage,
  loader: async () => {
    const [branches, ingredients] = await Promise.all([
      getBranches({ data: {} }),
      getIngredients({ data: { excludeNasi: true } }),
    ]);
    return { branches, ingredients };
  },
});

interface IngredientOption {
  id: string;
  name: string;
  stockUnit: string;
  stockQty: number;
}

interface ItemRow {
  id: string;
  ingredientId: string;
  quantity: number;
  inputValue: string;
}

interface MutasiDraft {
  items: ItemRow[];
  fromBranchId: string;
  toBranchId: string;
  notes: string;
}

function NewMutasiPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { branches, ingredients } = Route.useLoaderData();

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ADR 0011: persist the in-progress draft so a crash / tab-close doesn't lose it.
  // Creation form -> prompt-restore (never silently re-apply a stale draft).
  const draftKey = `draft:${user?.id ?? ""}:scm-transfers/new`;
  const {
    state: draft,
    setState: setDraft,
    clear: clearDraft,
    hasPendingDraft,
    pendingDraft,
    restorePending,
    discardPending,
  } = useUnsavedDraft<MutasiDraft>(
    draftKey,
    { items: [], fromBranchId: user?.branchId ?? "", toBranchId: "", notes: "" },
    {
      restoreMode: "prompt",
      isDirty: (s) => {
        const d = s as MutasiDraft;
        return (
          d.items.length > 0 ||
          !!d.notes ||
          d.toBranchId !== "" ||
          d.fromBranchId !== (user?.branchId ?? "")
        );
      },
    },
  );
  const items = draft.items;
  const setItems = (next: ItemRow[] | ((prev: ItemRow[]) => ItemRow[])) =>
    setDraft((prev) => ({ ...prev, items: typeof next === "function" ? next(prev.items) : next }));
  const fromBranchId = draft.fromBranchId;
  const setFromBranchId = (v: string) => setDraft((prev) => ({ ...prev, fromBranchId: v }));
  const toBranchId = draft.toBranchId;
  const setToBranchId = (v: string) => setDraft((prev) => ({ ...prev, toBranchId: v }));
  const notes = draft.notes;
  const setNotes = (v: string) => setDraft((prev) => ({ ...prev, notes: v }));

  const createMut = useServerFn(createMutasiTransfer);
  const queryClient = useQueryClient();

  // Fetch inventory for the sender branch so we can show available qty.
  const { data: inventoryResult } = useQuery({
    queryKey: ["inventory-branch", fromBranchId],
    queryFn: () => getInventory({ data: { branchId: fromBranchId } }),
    enabled: !!fromBranchId,
  });

  const ingredientById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  // Map ingredientId → available qty in the sender's inventory
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

  // Options for the combobox: ingredient + stock info
  const ingredientOptions: IngredientOption[] = useMemo(
    () =>
      ingredients.map((ing) => ({
        id: ing.id,
        name: ing.name,
        stockUnit: ing.stockUnit,
        stockQty: stockByIngredient.get(ing.id) ?? 0,
      })),
    [ingredients, stockByIngredient],
  );

  // Compute which items exceed available stock
  const itemsOverStock = useMemo(() => {
    const over: Array<{ ingredientId: string; requested: number; available: number }> = [];
    for (const it of items) {
      if (!it.ingredientId || it.quantity <= 0) continue;
      const available = stockByIngredient.get(it.ingredientId) ?? 0;
      if (it.quantity > available) {
        over.push({ ingredientId: it.ingredientId, requested: it.quantity, available });
      }
    }
    return over;
  }, [items, stockByIngredient]);

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), ingredientId: "", quantity: 1, inputValue: "" },
    ]);
  };

  const updateItem = (id: string, patch: Partial<ItemRow>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (fromBranchId === toBranchId) {
      setSubmitError("Cabang pengirim dan penerima harus berbeda");
      return;
    }
    if (!items.length) {
      setSubmitError("Minimal satu item harus ditambahkan");
      return;
    }
    if (items.some((it) => it.quantity <= 0)) {
      setSubmitError("Jumlah item harus lebih dari 0");
      return;
    }
    if (items.some((it) => !it.ingredientId)) {
      setSubmitError("Semua item harus memiliki bahan yang dipilih");
      return;
    }
    if (itemsOverStock.length > 0) {
      setSubmitError("Ada item yang melebihi stok tersedia. Periksa kembali jumlahnya.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createMut({
        data: {
          fromBranchId,
          toBranchId,
          items: items.map((it) => ({
            ingredientId: it.ingredientId,
            quantity: it.quantity,
          })),
          notes: notes || undefined,
        },
      });
      clearDraft();

      void queryClient.invalidateQueries({ queryKey: ["scm-transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory-branch"] });

      void navigate({
        to: "/scm-transfers/$transferId",
        params: { transferId: result.transfer.id },
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Gagal membuat mutasi");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRestoreDraft = () => {
    if (!pendingDraft) return;
    const kept = pendingDraft.items.filter((it) => ingredientById.has(it.ingredientId));
    const dropped = pendingDraft.items.filter((it) => !ingredientById.has(it.ingredientId));
    if (dropped.length > 0) {
      toast.warning(
        `${dropped.length} bahan dari draft sebelumnya tidak lagi tersedia dan dihapus: ${dropped
          .map((d) => ingredientById.get(d.ingredientId)?.name ?? d.ingredientId)
          .join(", ")}`,
      );
    }
    restorePending({
      items: kept,
      fromBranchId: pendingDraft.fromBranchId,
      toBranchId: pendingDraft.toBranchId,
      notes: pendingDraft.notes,
    });
  };

  usePageTitle("Buat Mutasi Stok", "Surat Jalan baru antar cabang");

  const senderBranch = branches.find((b) => b.id === fromBranchId);

  return (
    <RoleGuard allowedRoles={["super_admin", "branch_admin"]}>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              navigate({ to: "/scm-transfers", search: { status: undefined, search: undefined } })
            }
            className="gap-1"
          >
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Button>
          <h1 className="text-lg font-semibold">Buat Mutasi Stok</h1>
        </div>

        {hasPendingDraft ? (
          <RestoreDraftBanner onRestore={handleRestoreDraft} onDiscard={discardPending} />
        ) : null}

        {submitError && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="flex-1">{submitError}</span>
            <button
              type="button"
              onClick={() => setSubmitError(null)}
              className="text-destructive/70 hover:text-destructive"
            >
              ✕
            </button>
          </div>
        )}

        {itemsOverStock.length > 0 && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm">
            <p className="font-medium text-destructive">Stok tidak mencukupi</p>
            <ul className="mt-1 text-destructive/80 list-disc list-inside">
              {itemsOverStock.map((w) => {
                const ing = ingredientById.get(w.ingredientId);
                return (
                  <li key={w.ingredientId}>
                    {ing?.name ?? w.ingredientId}: diminta <strong>{w.requested}</strong>, tersedia
                    hanya <strong>{w.available}</strong>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Dari Cabang (Pengirim)</label>
            {user?.role === "branch_admin" ? (
              <>
                {(() => {
                  const sb = senderBranch;
                  if (!sb || !user?.branchId) {
                    return (
                      <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
                        Akun Anda tidak memiliki cabang terdaftar. Hubungi Super Admin.
                      </div>
                    );
                  }
                  return (
                    <div className="h-9 flex items-center gap-2 rounded-md border bg-muted px-3 text-sm">
                      <span className="font-medium">{sb.name}</span>
                      <span className="text-xs text-muted-foreground">({sb.code})</span>
                    </div>
                  );
                })()}
              </>
            ) : (
              <select
                value={fromBranchId}
                onChange={(e) => setFromBranchId(e.target.value)}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Pilih cabang…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Ke Cabang (Penerima)</label>
            <select
              value={toBranchId}
              onChange={(e) => setToBranchId(e.target.value)}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Pilih cabang…</option>
              {branches
                .filter((b) => b.id !== fromBranchId)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Stock info bar */}
        {fromBranchId && inventoryResult?.data && (
          <div className="rounded-md bg-muted/30 border px-4 py-2 text-xs text-muted-foreground">
            Tersedia di <strong>{senderBranch?.name ?? "cabang pengirim"}</strong>:{" "}
            {inventoryResult.data.length} jenis bahan tercatat
            {itemsOverStock.length > 0 && (
              <span className="text-destructive font-medium">
                {" — "}
                {itemsOverStock.length} item melebihi stok
              </span>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Item</label>
            <Button type="button" size="sm" variant="outline" onClick={addItem}>
              <Plus className="h-4 w-4 mr-1" />
              Tambah Item
            </Button>
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Belum ada item.</p>
          ) : (
            <div className="space-y-3">
              {items.map((it) => {
                const selected = ingredientOptions.find((o) => o.id === it.ingredientId);
                const available = stockByIngredient.get(it.ingredientId);
                const over = available != null && it.quantity > available;
                const isNewRow = !it.ingredientId;

                return (
                  <div key={it.id} className="flex items-start gap-2">
                    <Combobox
                      value={selected ?? null}
                      onValueChange={(val) => {
                        const o = val as IngredientOption | null;
                        updateItem(it.id, {
                          ingredientId: o?.id ?? "",
                          inputValue: o?.name ?? "",
                        });
                      }}
                      inputValue={it.inputValue}
                      onInputValueChange={(val) => updateItem(it.id, { inputValue: val })}
                      items={
                        isNewRow
                          ? ingredientOptions
                          : // once a row is committed, reuse the same options (all)
                            ingredientOptions
                      }
                      itemToStringValue={(item: IngredientOption) => item.id}
                      itemToStringLabel={(item: IngredientOption) => item.name}
                      isItemEqualToValue={(
                        a: IngredientOption | null,
                        b: IngredientOption | null,
                      ) => a?.id === b?.id}
                    >
                      <ComboboxInput
                        showTrigger
                        showClear={!!selected}
                        placeholder="Cari bahan…"
                        className="flex-1 min-w-0"
                      />
                      <ComboboxContent>
                        <ComboboxList>
                          {(item: IngredientOption) => (
                            <ComboboxItem key={item.id} value={item}>
                              <div className="flex items-center justify-between w-full">
                                <span>
                                  {item.name}{" "}
                                  <span className="text-muted-foreground">({item.stockUnit})</span>
                                </span>
                                <span
                                  className={
                                    "text-xs " +
                                    (item.stockQty <= 0
                                      ? "text-destructive font-medium"
                                      : "text-muted-foreground")
                                  }
                                >
                                  Stok: {item.stockQty}
                                  {item.stockQty <= 0 && " ⛔ habis"}
                                </span>
                              </div>
                            </ComboboxItem>
                          )}
                        </ComboboxList>
                        <ComboboxEmpty>Tidak ada bahan yang cocok</ComboboxEmpty>
                      </ComboboxContent>
                    </Combobox>
                    <div className="relative pt-0">
                      <input
                        type="number"
                        min={1}
                        value={it.quantity}
                        disabled={!it.ingredientId}
                        onChange={(e) => updateItem(it.id, { quantity: Number(e.target.value) })}
                        className={`h-9 w-20 rounded-md border px-2 text-sm text-right ${
                          over
                            ? "border-destructive bg-destructive/5 text-destructive"
                            : "border-input bg-background"
                        } disabled:opacity-40`}
                      />
                      {available != null && it.ingredientId && (
                        <span
                          className={`absolute -bottom-4 left-0 text-[10px] ${
                            over ? "text-destructive font-medium" : "text-muted-foreground"
                          }`}
                        >
                          stok: {available}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {items.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addItem}
              className="w-full mt-2"
            >
              <Plus className="h-4 w-4 mr-1" />
              Tambah Item
            </Button>
          )}
        </div>

        {items.length > 0 && fromBranchId && (
          <div className="rounded-md border px-4 py-3 text-xs text-muted-foreground space-y-1">
            <p>
              Total item: <strong>{items.length}</strong>
              {" · "}
              Total diminta: <strong>{items.reduce((s, it) => s + it.quantity, 0)}</strong>
            </p>
            {itemsOverStock.length > 0 && (
              <p className="text-destructive">
                ⚠ {itemsOverStock.length} item melebihi stok — perbaiki sebelum submit.
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium">Catatan (opsional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              navigate({ to: "/scm-transfers", search: { status: undefined, search: undefined } })
            }
            disabled={isSubmitting}
          >
            Batal
          </Button>
          <Button
            type="submit"
            disabled={
              isSubmitting || itemsOverStock.length > 0 || items.some((it) => !it.ingredientId)
            }
          >
            {isSubmitting ? "Membuat..." : "Buat Draft SJ"}
          </Button>
        </div>
      </form>
    </RoleGuard>
  );
}
