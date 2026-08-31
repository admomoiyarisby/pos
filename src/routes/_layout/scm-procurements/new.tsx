import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import { usePageTitle } from "#/hooks/usePageTitle";
import RoleGuard from "#/components/RoleGuard";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { Card, CardContent } from "#/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Plus, Trash2, ArrowLeft } from "lucide-react";
import { createProcurement, transitionProcurement } from "#/lib/server/scm-queries";
import { getIngredients } from "#/lib/server/ingredients";
import { useUnsavedDraft } from "#/hooks/useUnsavedDraft";
import { RestoreDraftBanner } from "#/components/draft/RestoreDraftBanner";
import { toast } from "sonner";

export const Route = createFileRoute("/_layout/scm-procurements/new")({
  component: NewProcurementPage,
});

type ProcurementDraftItem = {
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unitPrice: number;
  unitPriceUnit: string;
};

type ProcurementDraft = {
  items: ProcurementDraftItem[];
  notes: string;
  requestSource: string;
};

function NewProcurementPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: ingredients = [] } = useQuery({
    // Dedicated key: the plain ["ingredients"] key is used by the recipe wizard
    // and ingredient master with the FULL list; caching the excludeNasi subset
    // under it would leak into those pages.
    queryKey: ["ingredients", "procurement-new"],
    queryFn: () => getIngredients({ data: { excludeNasi: true } }),
  });

  // Local draft state. Persisted to the server on "Simpan sebagai Draft"
  // (which creates a Draft procurement and navigates to the detail page);
  // subsequent edits happen on the detail page's DraftForm. (ADR 0004 §3)
  const [selectedIngredient, setSelectedIngredient] = useState("");
  const [quantity, setQuantity] = useState(1);

  // ADR 0011: persist the in-progress draft so a crash / tab-close doesn't lose it.
  // Creation form -> prompt-restore (never silently re-apply a stale draft).
  const draftKey = `draft:${user?.id ?? ""}:scm-procurements/new`;
  const {
    state: draft,
    setState: setDraft,
    clear: clearDraft,
    hasPendingDraft,
    pendingDraft,
    restorePending,
    discardPending,
  } = useUnsavedDraft<ProcurementDraft>(
    draftKey,
    { items: [], notes: "", requestSource: "" },
    {
      restoreMode: "prompt",
      isDirty: (s) => s.items.length > 0 || !!s.notes || !!s.requestSource,
    },
  );
  const items = draft.items;
  const setItems = (
    next: ProcurementDraftItem[] | ((prev: ProcurementDraftItem[]) => ProcurementDraftItem[]),
  ) => setDraft((prev) => ({ ...prev, items: Array.isArray(next) ? next : next(prev.items) }));
  const notes = draft.notes;
  const setNotes = (v: string) => setDraft((prev) => ({ ...prev, notes: v }));
  const requestSource = draft.requestSource;
  const setRequestSource = (v: string) => setDraft((prev) => ({ ...prev, requestSource: v }));

  const showPrices = user?.role !== "branch_admin";

  const createDraftM = useMutation({
    mutationFn: async () => {
      if (items.length === 0) throw new Error("Tambahkan minimal 1 item");
      const branchId = user?.branchId;
      if (!branchId) throw new Error("User tidak terhubung ke cabang");
      return await createProcurement({
        data: {
          branchId,
          items: items.map((it, idx) => ({
            ingredientId: it.ingredientId,
            quantity: it.quantity,
            sortOrder: idx,
          })),
          notes: notes || undefined,
          requestSource: requestSource || undefined,
        },
      });
    },
    onSuccess: (result) => {
      clearDraft();
      void queryClient.invalidateQueries({ queryKey: ["scm-procurements"] });
      // After a successful save, jump straight to the detail page so any
      // further edits (add/remove items, change quantities) go through
      // the DraftForm server functions rather than getting stranded in
      // local state. (ADR 0004 §3)
      void navigate({
        to: "/scm-procurements/$procurementId",
        params: { procurementId: result.id },
      });
    },
  });

  const submitM = useMutation({
    mutationFn: async (id: string) => {
      await transitionProcurement({
        data: { procurementId: id, event: "submit", payload: {} },
      });
    },
    onSuccess: (_d, id) => {
      clearDraft();
      void queryClient.invalidateQueries({ queryKey: ["scm-procurements"] });
      void navigate({ to: "/scm-procurements/$procurementId", params: { procurementId: id } });
    },
  });

  function addItem() {
    if (!selectedIngredient || quantity <= 0) return;
    const ing = ingredients.find((i) => i.id === selectedIngredient);
    if (!ing) return;
    if (items.some((it) => it.ingredientId === ing.id)) return;
    setItems([
      ...items,
      {
        ingredientId: ing.id,
        ingredientName: ing.name,
        quantity,
        unitPrice: ing.averageCost,
        unitPriceUnit: ing.stockUnit,
      },
    ]);
    setSelectedIngredient("");
    setQuantity(1);
  }

  function removeItem(ingredientId: string) {
    setItems(items.filter((it) => it.ingredientId !== ingredientId));
  }

  function handleSimpanDraft() {
    createDraftM.mutate();
  }

  function handleSubmit() {
    // Create + submit in one step. "Simpan sebagai Draft" is the path
    // for stopping mid-form; the user can submit the procurement
    // immediately if they have all the items. (ADR 0004 §3)
    createDraftM.mutate(undefined, {
      onSuccess: (result) => {
        submitM.mutate(result.id);
      },
    });
  }

  const handleRestoreDraft = () => {
    if (!pendingDraft) return;
    const validIds = new Set(ingredients.map((i) => i.id));
    const kept = pendingDraft.items.filter((it) => validIds.has(it.ingredientId));
    const dropped = pendingDraft.items.filter((it) => !validIds.has(it.ingredientId));
    if (dropped.length > 0) {
      toast.warning(
        `${dropped.length} bahan dari draft sebelumnya tidak lagi tersedia dan dihapus: ${dropped
          .map((d) => d.ingredientName)
          .join(", ")}`,
      );
    }
    restorePending({
      items: kept,
      notes: pendingDraft.notes,
      requestSource: pendingDraft.requestSource,
    });
  };

  usePageTitle(
    "Buat Pengadaan",
    "Isi item yang diminta. Simpan sebagai Draft untuk melanjutkan nanti, atau langsung Submit untuk masuk antrian review Admin Pusat.",
  );

  return (
    <RoleGuard allowedRoles={["branch_admin", "super_admin"]} deniedTo="/scm-procurements">
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex justify-end">
          <Link
            to="/scm-procurements"
            search={(prev) => ({
              ...prev,
              status: undefined,
              search: undefined,
              page: prev.page,
              sortKey: prev.sortKey,
              sortDir: prev.sortDir,
            })}
          >
            <Button variant="ghost">
              <ArrowLeft className="h-4 w-4" />
              Kembali
            </Button>
          </Link>
        </div>

        {hasPendingDraft ? (
          <RestoreDraftBanner onRestore={handleRestoreDraft} onDiscard={discardPending} />
        ) : null}

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              <Label>Item</Label>
              <div className="flex gap-2">
                <Select value={selectedIngredient} onValueChange={setSelectedIngredient}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Pilih bahan..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ingredients.map((ing) => (
                      <SelectItem key={ing.id} value={ing.id}>
                        {ing.name}
                        {showPrices
                          ? ` — Rp ${ing.averageCost.toLocaleString("id-ID")}/${ing.stockUnit}`
                          : ` (${ing.stockUnit})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="w-32"
                />
                <Button onClick={addItem} variant="secondary">
                  <Plus className="h-4 w-4" />
                  Tambah Bahan
                </Button>
              </div>
            </div>

            {items.length > 0 ? (
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left">Bahan</th>
                      <th className="px-3 py-2 text-right">Jumlah</th>
                      {showPrices && <th className="px-3 py-2 text-right">Harga</th>}
                      {showPrices && <th className="px-3 py-2 text-right">Subtotal</th>}
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.ingredientId} className="border-b">
                        <td className="px-3 py-2">{it.ingredientName}</td>
                        <td className="px-3 py-2 text-right font-mono">{it.quantity}</td>
                        {showPrices && (
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                            Rp {it.unitPrice.toLocaleString("id-ID")}/{it.unitPriceUnit}
                          </td>
                        )}
                        {showPrices && (
                          <td className="px-3 py-2 text-right font-mono">
                            Rp {(it.quantity * it.unitPrice).toLocaleString("id-ID")}
                          </td>
                        )}
                        <td className="px-3 py-2">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Hapus ${it.ingredientName} dari daftar`}
                            onClick={() => removeItem(it.ingredientId)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {showPrices && (
                      <tr className="border-t-2 bg-muted/30 font-semibold">
                        <td colSpan={3} className="px-3 py-2 text-right">
                          Total:
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          Rp{" "}
                          {items
                            .reduce((sum, it) => sum + it.quantity * it.unitPrice, 0)
                            .toLocaleString("id-ID")}
                        </td>
                        <td></td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Sumber Permintaan (opsional)</Label>
                <Input
                  placeholder="mis. WhatsApp, Telepon, Walk-in"
                  value={requestSource}
                  onChange={(e) => setRequestSource(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Catatan (opsional)</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Link
                to="/scm-procurements"
                search={(prev) => ({
                  ...prev,
                  status: undefined,
                  search: undefined,
                  page: prev.page,
                  sortKey: prev.sortKey,
                  sortDir: prev.sortDir,
                })}
              >
                <Button variant="ghost">Batalkan</Button>
              </Link>
              <Button
                variant="outline"
                onClick={handleSimpanDraft}
                disabled={items.length === 0 || createDraftM.isPending || createDraftM.isSuccess}
              >
                {createDraftM.isPending
                  ? "Menyimpan..."
                  : createDraftM.isSuccess
                    ? "Tersimpan sebagai Draft. Klik Submit untuk mengirim."
                    : "Simpan sebagai Draft"}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={items.length === 0 || createDraftM.isPending || submitM.isPending}
              >
                {submitM.isPending ? "Mengirim..." : "Submit Pengadaan"}
              </Button>
            </div>

            {createDraftM.isError ? (
              <p className="text-sm text-destructive">
                {createDraftM.error instanceof Error
                  ? createDraftM.error.message
                  : String(createDraftM.error)}
              </p>
            ) : null}
            {submitM.isError ? (
              <p className="text-sm text-destructive">
                {submitM.error instanceof Error ? submitM.error.message : String(submitM.error)}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </RoleGuard>
  );
}
