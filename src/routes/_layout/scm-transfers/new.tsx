import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import { usePageTitle } from "#/hooks/usePageTitle";
import RoleGuard from "#/components/RoleGuard";
import { Button } from "#/components/ui/button";
import { AlertCircle, ArrowLeft, Plus, Trash2 } from "lucide-react";
import { createMutasiTransfer } from "#/lib/server/scm-transfers";
import { getBranches } from "#/lib/server/branches";
import { getIngredients } from "#/lib/server/ingredients";
import { getInventory } from "#/lib/server/inventory";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/_layout/scm-transfers/new")({
  component: NewMutasiPage,
  loader: async () => {
    const [branches, ingredients] = await Promise.all([
      getBranches({ data: {} }),
      getIngredients({ data: {} }),
    ]);
    return { branches, ingredients };
  },
});

interface ItemRow {
  id: string;
  ingredientId: string;
  quantity: number;
}

function NewMutasiPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { branches, ingredients } = Route.useLoaderData();

  const [fromBranchId, setFromBranchId] = useState<string>(user?.branchId ?? "");
  const [toBranchId, setToBranchId] = useState<string>("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [notes, setNotes] = useState<string>("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createMut = useServerFn(createMutasiTransfer);
  const queryClient = useQueryClient();

  // Fetch inventory for the sender branch so we can show available qty.
  // Runs once when fromBranchId is set; refetches if it changes (super_admin case).
  const { data: inventoryRows } = useQuery({
    queryKey: ["inventory-branch", fromBranchId],
    queryFn: () => getInventory({ data: { branchId: fromBranchId } }),
    enabled: !!fromBranchId,
  });

  const ingredientById = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i])),
    [ingredients],
  );

  // Map ingredientId → available qty in the sender's inventory
  const stockByIngredient = useMemo(() => {
    const m = new Map<string, number>();
    const rows = inventoryRows?.data;
    if (rows) {
      for (const inv of rows) {
        m.set(inv.ingredientId, inv.quantity);
      }
    }
    return m;
  }, [inventoryRows]);

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
      { id: crypto.randomUUID(), ingredientId: ingredients[0]?.id ?? "", quantity: 1 },
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
    if (itemsOverStock.length > 0) {
      setSubmitError("Ada item yang melebihi stok tersedia. Periksa kembali jumlahnya.");
      return;
    }

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

      // Invalidate caches
      void queryClient.invalidateQueries({ queryKey: ["scm-transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory-branch"] });

      navigate({ to: "/scm-transfers/$transferId", params: { transferId: result.transfer.id } });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Gagal membuat mutasi");
    }
  };

  usePageTitle("Buat Mutasi Stok", "Surat Jalan baru antar cabang");

  const senderBranch = branches.find((b) => b.id === fromBranchId);

  return (
    <RoleGuard allowedRoles={["super_admin", "branch_admin"]}>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-3xl">
        <button
          type="button"
          onClick={() => navigate({ to: "/scm-transfers" })}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali ke daftar
        </button>

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
                    {ing?.name ?? w.ingredientId}: diminta <strong>{w.requested}</strong>,
                    tersedia hanya <strong>{w.available}</strong>
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
        {fromBranchId && inventoryRows?.data && (
          <div className="rounded-md bg-muted/30 border px-4 py-2 text-xs text-muted-foreground">
            Tersedia di <strong>{senderBranch?.name ?? "cabang pengirim"}</strong>:{" "}
            {inventoryRows.data.length} jenis bahan tercatat
            {itemsOverStock.length > 0 && (
              <span className="text-destructive font-medium">
                {" — "}{itemsOverStock.length} item melebihi stok
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
            <div className="space-y-2">
              {items.map((it) => {
                const available = stockByIngredient.get(it.ingredientId);
                const over = available != null && it.quantity > available;
                return (
                  <div key={it.id} className="flex items-center gap-2">
                    <select
                      value={it.ingredientId}
                      onChange={(e) => updateItem(it.id, { ingredientId: e.target.value })}
                      className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {ingredients.map((ing) => (
                        <option key={ing.id} value={ing.id}>
                          {ing.name}
                        </option>
                      ))}
                    </select>
                    <div className="relative">
                      <input
                        type="number"
                        min={1}
                        value={it.quantity}
                        onChange={(e) =>
                          updateItem(it.id, { quantity: Number(e.target.value) })
                        }
                        className={`h-9 w-20 rounded-md border px-2 text-sm text-right ${
                          over
                            ? "border-destructive bg-destructive/5 text-destructive"
                            : "border-input bg-background"
                        }`}
                      />
                      {available != null && (
                        <span className={`absolute -bottom-4 left-0 text-[10px] ${
                          over ? "text-destructive font-medium" : "text-muted-foreground"
                        }`}>
                          stok: {available}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      className="h-9 w-9 inline-flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Submit button row — show stock warning inline */}
        {items.length > 0 && fromBranchId && (
          <div className="rounded-md border px-4 py-3 text-xs text-muted-foreground space-y-1">
            <p>
              Total item: <strong>{items.length}</strong>
              {" · "}
              Total diminta:{" "}
              <strong>{items.reduce((s, it) => s + it.quantity, 0)}</strong>
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
          <button
            type="button"
            onClick={() => navigate({ to: "/scm-transfers" })}
            className="h-9 px-4 rounded-md border text-sm"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={itemsOverStock.length > 0}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-40"
          >
            Buat Draft SJ
          </button>
        </div>
      </form>
    </RoleGuard>
  );
}
