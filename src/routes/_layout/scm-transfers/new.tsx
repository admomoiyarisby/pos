import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "#/lib/auth-context";
import { usePageTitle } from "#/hooks/usePageTitle";
import RoleGuard from "#/components/RoleGuard";
import { Button } from "#/components/ui/button";
import { AlertCircle, ArrowLeft, Plus, Trash2 } from "lucide-react";
import { createMutasiTransfer, getMutasiTransfer } from "#/lib/server/scm-transfers";
import { getBranches } from "#/lib/server/branches";
import { getIngredients } from "#/lib/server/ingredients";
import { useQueryClient } from "@tanstack/react-query";
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
  const [warnings, setWarnings] = useState<
    Array<{ ingredientId: string; requested: number; available: number }>
  >([]);

  const createMut = useServerFn(createMutasiTransfer);
  const queryClient = useQueryClient();

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
    setWarnings([]);

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
      setWarnings(result.warnings);

      // Invalidate the list cache so the new transfer shows up
      void queryClient.invalidateQueries({ queryKey: ["scm-transfers"] });
      // Refresh the source data so warnings show
      void getMutasiTransfer({ data: { transferId: result.transfer.id } });

      navigate({ to: "/scm-transfers/$transferId", params: { transferId: result.transfer.id } });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Gagal membuat mutasi");
    }
  };

  usePageTitle("Buat Mutasi Stok", "Surat Jalan baru antar cabang");

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

        {warnings.length > 0 && (
          <div className="rounded-md bg-warning/10 border border-warning/20 px-4 py-3 text-sm">
            <p className="font-medium text-warning">Peringatan stok</p>
            <ul className="mt-1 text-warning/80 list-disc list-inside">
              {warnings.map((w) => {
                const ing = ingredients.find((i) => i.id === w.ingredientId);
                return (
                  <li key={w.ingredientId}>
                    {ing?.name ?? w.ingredientId}: diminta {w.requested}, tersedia {w.available}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Dari Cabang (Pengirim)</label>
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
              {items.map((it) => (
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
                  <input
                    type="number"
                    min={1}
                    value={it.quantity}
                    onChange={(e) =>
                      updateItem(it.id, { quantity: Number(e.target.value) })
                    }
                    className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm text-right"
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(it.id)}
                    className="h-9 w-9 inline-flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

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
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
          >
            Buat Draft SJ
          </button>
        </div>
      </form>
    </RoleGuard>
  );
}
