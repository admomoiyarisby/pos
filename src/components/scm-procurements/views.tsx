import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { ScmItemTable, type ScmItemRow } from "./ScmItemTable";
import { AuditLogCard } from "./AuditLogCard";
import {
  transitionProcurement,
  updateProcurementItem,
  addProcurementItem,
  removeProcurementItem,
} from "#/lib/server/scm-queries";
import { getIngredients } from "#/lib/server/ingredients";
import { printSuratJalan, printInvoice } from "#/lib/server/scm-print";
import { openPrintWindow } from "#/lib/print-window";
import { Plus, Trash2 } from "lucide-react";

/**
 * Shared props for all state views. The detail page passes the procurement
 * row and items. Audit log is fetched by the view itself via AuditLogCard
 * (paginated), so it's not in the props.
 */
export interface StateViewProps {
  procurement: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  auditLog?: never; // no longer passed; use AuditLogCard
  invoice?: Record<string, unknown> | null;
}

function rowsToItems(items: Array<Record<string, unknown>>): ScmItemRow[] {
  return (items as unknown as ScmItemRow[]).map((it) => ({
    ...it,
    // CA's caDecision: leave as-is. The DB starts every item at "pending"
    // and the CA must explicitly click Setujui/Tolak on each row before
    // the primary "Setujui & Buat SJ" button activates. (ADR 0004 §1)
    // The earlier "default pending to approved" override silently flipped
    // decisions the CA never made — fixed in the layout phase.
    // CA's readyQuantity: default to the requested quantity. The input
    // shows this as the visual default (controlled), but the underlying
    // state is null until typed. Defaulting ensures the payload sends
    // the right value when the CA accepts-as-is.
    readyQuantity: it.readyQuantity ?? it.quantity ?? null,
    // BA's receivedQuantity: default to the picked quantity. The input
    // shows pickedQuantity as the visual default (controlled), but the
    // state is null until typed. Defaulting ensures accepting-as-is works
    // without the user having to type each row.
    receivedQuantity: it.receivedQuantity ?? it.pickedQuantity ?? null,
  }));
}

/**
 * Map the invoice's frozen lineItems to ScmItemRow so the ScmItemTable
 * invoice-preview mode can render them. The invoice snapshot is the
 * source of truth for the invoice (frozen at finish-receive time); the
 * procurement items might have been touched since (eg a cancelled
 * procurement reverses the rejection quantities, but the invoice stays
 * frozen). Using the snapshot here keeps the detail page in sync with
 * the print window, which also reads from lineItems.
 */
function invoiceLineItemsToRows(lineItems: Array<Record<string, unknown>>): ScmItemRow[] {
  return lineItems.map((li) => ({
    id: (li.itemId as string) ?? "",
    ingredientId: (li.ingredientId as string) ?? "",
    ingredientName: (li.ingredientName as string) ?? "",
    quantity: 0,
    readyQuantity: null,
    pickedQuantity: null,
    receivedQuantity: (li.receivedQuantity as number) ?? null,
    rejectedQuantity: (li.rejectedQuantity as number) ?? null,
    caDecision: (li.caDecision as "pending" | "approved" | "rejected") ?? "pending",
    baDecision: (li.baDecision as "pending" | "accepted" | "rejected") ?? "pending",
    unitPrice: (li.unitPrice as number) ?? null,
    reason: (li.reason as string) ?? null,
  }));
}

/**
 * AuditLogSection — wraps AuditLogCard in a Card with the "Riwayat" title.
 * Each view renders this instead of inlining the Card markup.
 */
function AuditLogSection({ procurementId }: { procurementId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Riwayat</CardTitle>
      </CardHeader>
      <CardContent>
        <AuditLogCard procurementId={procurementId} />
      </CardContent>
    </Card>
  );
}

/**
 * SuratJalanButton — opens a print window with the SJ document.
 * Mirrors the POS receipt pattern: window.open + auto-print + auto-close.
 */
function SuratJalanButton({
  procurementId,
  label = "Lihat Surat Jalan",
}: {
  procurementId: string;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  async function handleClick() {
    try {
      setLoading(true);
      const html = await printSuratJalan({ data: { procurementId } });
      openPrintWindow(html);
    } catch (err) {
      alert(`Gagal mencetak: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={loading}>
      {loading ? "Menyiapkan..." : label}
    </Button>
  );
}

/**
 * InvoiceButton — opens a print window with the Invoice document.
 */
function InvoiceButton({
  procurementId,
  label = "Lihat Invoice",
}: {
  procurementId: string;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  async function handleClick() {
    try {
      setLoading(true);
      const html = await printInvoice({ data: { procurementId } });
      openPrintWindow(html);
    } catch (err) {
      alert(`Gagal mencetak: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={loading}>
      {loading ? "Menyiapkan..." : label}
    </Button>
  );
}

function useTransitionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      procurementId: string;
      event: string;
      payload?: Record<string, unknown>;
    }) =>
      transitionProcurement({
        data: {
          procurementId: vars.procurementId,
          event: vars.event,
          payload: vars.payload ?? {},
        },
      }),
    onSuccess: (_data, vars) => {
      // Invalidate all four detail-page queries, not just the
      // procurement header. A transition can change:
      //   - the procurement row (status, lastEventAt, etc.)
      //   - the items (e.g. setReceivedQuantities during finish-receive)
      //   - the invoice (createInvoiceSnapshot during finish-receive)
      // Skipping the items or invoice invalidation leaves stale
      // caches: the detail page shows "Total: Rp 0" right after
      // finish-receive because invoiceQ still has the old null data,
      // and only corrects itself after a hard reload. (Bug repro:
      // BA clicks "Selesai Review" -> total stays Rp 0 -> reload ->
      // total appears.) Invalidation is cheap (same-origin GET, the
      // server returns the same data for events that don't touch a
      // given query), so we just blanket-invalidate all four.
      void queryClient.invalidateQueries({ queryKey: ["scm-procurement", vars.procurementId] });
      void queryClient.invalidateQueries({ queryKey: ["scm-procurements"] });
      void queryClient.invalidateQueries({
        queryKey: ["scm-procurement-items", vars.procurementId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["scm-procurement-invoice", vars.procurementId],
      });
    },
  });
}

function useUpdateItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      procurementId: string;
      itemId: string;
      patch: Record<string, unknown>;
    }) =>
      updateProcurementItem({
        data: { procurementId: vars.procurementId, itemId: vars.itemId, patch: vars.patch },
      }),
    onSuccess: (_d, vars) => {
      // Invalidate items + the procurement header. An item-update
      // doesn't create an invoice, so invoiceQ doesn't need to be
      // re-fetched here. (The header changes too because the
      // server updates lastEventAt.)
      void queryClient.invalidateQueries({
        queryKey: ["scm-procurement-items", vars.procurementId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["scm-procurement", vars.procurementId],
      });
    },
  });
}

// =============================================================================
// Draft — BA: editable form with Submit / Cancel
// =============================================================================
//
// Editable per ADR 0004 §3. BA can change quantities, add items, and
// remove items before submitting. Each change goes through the server
// immediately (no separate "save" step) so the audit log records every
// mutation.

export function DraftForm({ procurement, items }: StateViewProps) {
  const transitionM = useTransitionMutation();
  const updateM = useUpdateItemMutation();
  const queryClient = useQueryClient();
  const [editableItems, setEditableItems] = useState<ScmItemRow[]>(() => rowsToItems(items));

  useEffect(() => {
    setEditableItems(rowsToItems(items));
  }, [items]);

  const handleItemChange = (itemId: string, patch: Partial<ScmItemRow>) => {
    setEditableItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it)));
  };

  const persistQuantity = async (itemId: string, quantity: number | null | undefined) => {
    if (quantity === null || quantity === undefined) return;
    await updateM.mutateAsync({
      procurementId: procurement.id as string,
      itemId,
      patch: { quantity },
    });
  };

  const addM = useMutation({
    mutationFn: async (vars: { ingredientId: string; quantity: number }) =>
      addProcurementItem({
        data: {
          procurementId: procurement.id as string,
          ingredientId: vars.ingredientId,
          quantity: vars.quantity,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scm-procurement-items", procurement.id] });
    },
  });

  const removeM = useMutation({
    mutationFn: async (itemId: string) =>
      removeProcurementItem({
        data: { procurementId: procurement.id as string, itemId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scm-procurement-items", procurement.id] });
    },
  });

  const [newIngredientId, setNewIngredientId] = useState("");
  const [newQuantity, setNewQuantity] = useState(1);

  const { data: allIngredients = [] } = useQuery({
    queryKey: ["ingredients"],
    queryFn: () => getIngredients({ data: {} }),
  });

  const availableToAdd = (
    allIngredients as Array<{ id: string; name: string; stockUnit: string; averageCost: number }>
  ).filter((ing) => !editableItems.some((it) => it.ingredientId === ing.id));

  function handleAdd() {
    if (!newIngredientId || newQuantity <= 0) return;
    addM.mutate(
      { ingredientId: newIngredientId, quantity: newQuantity },
      {
        onSuccess: () => {
          setNewIngredientId("");
          setNewQuantity(1);
        },
      },
    );
  }

  function handleRemove(itemId: string) {
    removeM.mutate(itemId);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Item Pengadaan (Draft)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Ubah jumlah, tambah bahan, atau hapus bahan. Setiap perubahan langsung tersimpan dan
            tercatat di audit log.
          </p>
          <ScmItemTable
            mode="draft-edit"
            items={editableItems}
            onItemChange={(id, patch) => {
              handleItemChange(id, patch);
              if (patch.readyQuantity !== undefined) {
                void persistQuantity(id, patch.readyQuantity);
              }
            }}
            disabled={updateM.isPending}
          />
          {editableItems.length > 0 ? (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  editableItems.forEach((it) => handleRemove(it.id));
                }}
                disabled={removeM.isPending}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
                Hapus Semua Bahan
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tambah Bahan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Select value={newIngredientId} onValueChange={setNewIngredientId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Pilih bahan..." />
              </SelectTrigger>
              <SelectContent>
                {availableToAdd.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    Semua bahan sudah ditambahkan
                  </SelectItem>
                ) : (
                  availableToAdd.map((ing) => (
                    <SelectItem key={ing.id} value={ing.id}>
                      {ing.name} — Rp {ing.averageCost.toLocaleString("id-ID")}/{ing.stockUnit}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={1}
              value={newQuantity}
              onChange={(e) => setNewQuantity(Number(e.target.value))}
              className="w-32"
            />
            <Button
              onClick={handleAdd}
              disabled={
                !newIngredientId ||
                newQuantity <= 0 ||
                addM.isPending ||
                availableToAdd.length === 0
              }
            >
              <Plus className="h-4 w-4" />
              Tambah Bahan
            </Button>
          </div>
          {addM.isError ? (
            <p className="mt-2 text-sm text-destructive">{(addM.error as Error).message}</p>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          onClick={() =>
            transitionM.mutate({ procurementId: procurement.id as string, event: "cancel" })
          }
          variant="ghost"
          disabled={transitionM.isPending}
        >
          Batalkan
        </Button>
        <Button
          onClick={() =>
            transitionM.mutate({ procurementId: procurement.id as string, event: "submit" })
          }
          disabled={transitionM.isPending || editableItems.length === 0}
        >
          {transitionM.isPending ? "Menyimpan..." : "Submit Pengadaan"}
        </Button>
      </div>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

// =============================================================================
// Pending — BA: read-only + Withdraw / Cancel; CA: Buka Review
// =============================================================================
export function PendingBaView({ procurement, items }: StateViewProps) {
  const transitionM = useTransitionMutation();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Menunggu Review</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Pengadaan sudah disubmit. Admin Pusat akan membuka review. Anda masih bisa menariknya
            kembali.
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          disabled={transitionM.isPending}
          onClick={() =>
            transitionM.mutate({ procurementId: procurement.id as string, event: "withdraw" })
          }
        >
          Tarik Kembali
        </Button>
        <Button
          variant="ghost"
          disabled={transitionM.isPending}
          onClick={() =>
            transitionM.mutate({ procurementId: procurement.id as string, event: "cancel" })
          }
        >
          Batalkan
        </Button>
      </div>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

// CA's view of a Pending procurement. Read-only content with a single
// "Buka Review" action that transitions Pending -> UnderReview. The queue
// itself lives on the list page (/scm-procurements?status=Pending) per
// ADR 0004 §2; this view is for when a CA lands here from a deep link
// or the sidebar badge.
export function PendingCaView({ procurement, items }: StateViewProps) {
  const transitionM = useTransitionMutation();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Menunggu Review</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Pengadaan ini menunggu review. Buka review untuk mulai memutuskan item yang akan
            dikirim.
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button
          disabled={transitionM.isPending}
          onClick={() =>
            transitionM.mutate({ procurementId: procurement.id as string, event: "open-review" })
          }
        >
          {transitionM.isPending ? "Membuka Review..." : "Buka Review"}
        </Button>
      </div>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

// =============================================================================
// UnderReview — CA: interactive table; BA: live read-only
// =============================================================================
export function UnderReviewCaReview({ procurement, items }: StateViewProps) {
  const updateM = useUpdateItemMutation();
  const transitionM = useTransitionMutation();
  const [rejectionReason, setRejectionReason] = useState("");
  const [editableItems, setEditableItems] = useState<ScmItemRow[]>(() => rowsToItems(items));

  useEffect(() => {
    setEditableItems(rowsToItems(items));
  }, [items]);

  const handleItemChange = (itemId: string, patch: Partial<ScmItemRow>) => {
    setEditableItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it)));
  };

  const handleAcceptAndShip = async () => {
    // Save all item-level changes via updateItem, then transition.
    // Gated by `allDecided` below — the button is disabled while any
    // row is still "pending", so this loop only runs explicit decisions.
    for (const it of editableItems) {
      await updateM.mutateAsync({
        procurementId: procurement.id as string,
        itemId: it.id,
        patch: {
          caDecision: it.caDecision,
          readyQuantity: it.readyQuantity,
        } as Record<string, unknown>,
      });
    }
    await transitionM.mutateAsync({
      procurementId: procurement.id as string,
      event: "accept-and-ship",
    });
  };

  // Every row must be explicitly approved or rejected before the primary
  // button activates. (ADR 0004 §1)
  const allDecided = editableItems.every(
    (it) => it.caDecision === "approved" || it.caDecision === "rejected",
  );
  const pendingCount = editableItems.filter((it) => it.caDecision === "pending").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Review Pengadaan</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Setujui per item atau tolak seluruh pengadaan. Item yang disetujui akan dikirim; yang
            ditolak diabaikan. Pengeditan tersimpan saat Anda klik{" "}
            <strong>Setujui & Buat SJ</strong>.
          </p>
          <ScmItemTable
            mode="ca-review"
            items={editableItems}
            onItemChange={handleItemChange}
            disabled={updateM.isPending || transitionM.isPending}
          />
        </CardContent>
      </Card>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1">
          <Input
            type="text"
            placeholder="Alasan penolakan (wajib untuk Tolak Semua)"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            disabled={!rejectionReason || transitionM.isPending || updateM.isPending}
            onClick={() =>
              transitionM.mutate({
                procurementId: procurement.id as string,
                event: "reject",
                payload: { reason: rejectionReason },
              })
            }
          >
            Tolak Semua
          </Button>
          <Button
            disabled={!allDecided || transitionM.isPending || updateM.isPending}
            onClick={handleAcceptAndShip}
            title={
              allDecided
                ? undefined
                : pendingCount === 1
                  ? "1 item belum diputuskan"
                  : `${pendingCount} item belum diputuskan`
            }
          >
            {updateM.isPending
              ? "Menyimpan..."
              : transitionM.isPending
                ? "Memproses..."
                : "Setujui & Buat SJ"}
          </Button>
        </div>
      </div>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

export function UnderReviewBaLive({ procurement, items }: StateViewProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Sedang Direview</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Admin Pusat sedang memutuskan item mana yang akan dikirim. Anda hanya bisa melihat
            progresnya.
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

// =============================================================================
// Rejected — read-only
// =============================================================================
export function RejectedView({ procurement, items }: StateViewProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Pengadaan Ditolak</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm">
            Pengadaan ini ditolak saat review. <strong>Alasan:</strong>{" "}
            {(procurement.rejectionReason as string) || "-"}
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

// =============================================================================
// InTransit — BA: tracking + Mark Delivered; CA: tracking + Cancel
//
// The "mark-delivered" actor moved from CA to BA in the FSM: BA is the
// one who physically receives the goods at the branch, so they're
// the one who confirms "Sudah Dikirim". CA keeps the cancel
// permission (e.g. goods lost in transit before BA can mark them
// delivered) — a destructive action paired with a reason input.
export function InTransitBaTracking({ procurement, items }: StateViewProps) {
  const transitionM = useTransitionMutation();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Dalam Pengiriman</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Stock sedang dalam perjalanan. Tandai "Sudah Dikirim" setelah barang tiba di cabang.
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <SuratJalanButton procurementId={procurement.id as string} />
        <Button
          disabled={transitionM.isPending}
          onClick={() =>
            transitionM.mutate({ procurementId: procurement.id as string, event: "mark-delivered" })
          }
        >
          Tandai Sudah Dikirim
        </Button>
      </div>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

export function InTransitCaDetail({ procurement, items }: StateViewProps) {
  const transitionM = useTransitionMutation();
  const [cancellationReason, setCancellationReason] = useState("");
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Dalam Pengiriman</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Stock sudah keluar dari gudang. Cabang akan menandai "Sudah Dikirim" setelah barang
            tiba.
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1">
          <Input
            type="text"
            placeholder="Alasan pembatalan (wajib untuk Batalkan)"
            value={cancellationReason}
            onChange={(e) => setCancellationReason(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            disabled={!cancellationReason || transitionM.isPending}
            onClick={() =>
              transitionM.mutate({
                procurementId: procurement.id as string,
                event: "cancel",
                payload: { reason: cancellationReason },
              })
            }
          >
            Batalkan
          </Button>
          <SuratJalanButton procurementId={procurement.id as string} label="Cetak Surat Jalan" />
        </div>
      </div>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

// =============================================================================
// Delivered — BA: receiving form; CA: waiting
// =============================================================================
export function DeliveredBaForm({ procurement, items }: StateViewProps) {
  const updateM = useUpdateItemMutation();
  const transitionM = useTransitionMutation();
  const [editableItems, setEditableItems] = useState<ScmItemRow[]>(() => rowsToItems(items));

  useEffect(() => {
    setEditableItems(rowsToItems(items));
  }, [items]);

  const handleItemChange = (itemId: string, patch: Partial<ScmItemRow>) => {
    setEditableItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it)));
  };

  const handleOpenReceive = async () => {
    // Save all item-level changes via updateItem, then transition.
    for (const it of editableItems) {
      await updateM.mutateAsync({
        procurementId: procurement.id as string,
        itemId: it.id,
        patch: {
          receivedQuantity: it.receivedQuantity,
          rejectedQuantity: it.rejectedQuantity,
          reason: it.reason,
        } as Record<string, unknown>,
      });
    }
    await transitionM.mutateAsync({
      procurementId: procurement.id as string,
      event: "open-receive",
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Sudah Dikirim: Mulai Penerimaan</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Periksa barang. Isi jumlah yang diterima (Ditolak dihitung otomatis dari selisih).
            Pengeditan tersimpan saat Anda klik <strong>Lanjut ke Review</strong>.
          </p>
          <ScmItemTable
            mode="ba-receive"
            items={editableItems}
            onItemChange={handleItemChange}
            disabled={updateM.isPending || transitionM.isPending}
          />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <SuratJalanButton procurementId={procurement.id as string} />
        <Button disabled={transitionM.isPending || updateM.isPending} onClick={handleOpenReceive}>
          {updateM.isPending
            ? "Menyimpan..."
            : transitionM.isPending
              ? "Memproses..."
              : "Lanjut ke Review"}
        </Button>
      </div>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

export function DeliveredCaWaiting({ procurement, items }: StateViewProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Menunggu Review Cabang</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Barang sudah sampai di cabang. Cabang akan menerima dan review.
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <SuratJalanButton procurementId={procurement.id as string} />
      </div>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

// =============================================================================
// ReviewingSJ — BA: interactive (can split qty); CA: live
// =============================================================================
export function ReviewingSjBaInteractive({ procurement, items }: StateViewProps) {
  const transitionM = useTransitionMutation();
  const [editableItems, setEditableItems] = useState<ScmItemRow[]>(() => rowsToItems(items));
  const [cancellationReason, setCancellationReason] = useState("");

  useEffect(() => {
    setEditableItems(rowsToItems(items));
  }, [items]);

  const handleItemChange = (itemId: string, patch: Partial<ScmItemRow>) => {
    setEditableItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it)));
  };

  const handleFinishReceive = async () => {
    // Use local state in the transition payload — no separate save step
    // (the FSM's finish-receive effect reads the values from the payload).
    await transitionM.mutateAsync({
      procurementId: procurement.id as string,
      event: "finish-receive",
      payload: {
        items: editableItems.map((it) => ({
          id: it.id,
          receivedQuantity: it.receivedQuantity ?? 0,
          rejectedQuantity: it.rejectedQuantity ?? 0,
          reason: it.reason ?? undefined,
        })),
      },
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Review Penerimaan</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Konfirmasi jumlah yang diterima (Ditolak dihitung otomatis). Klik{" "}
            <strong>Selesai Review</strong> untuk konfirmasi.
          </p>
          <ScmItemTable
            mode="ba-receive"
            items={editableItems}
            onItemChange={handleItemChange}
            disabled={transitionM.isPending}
          />
        </CardContent>
      </Card>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1">
          <Input
            type="text"
            placeholder="Alasan pembatalan (wajib untuk Batalkan)"
            value={cancellationReason}
            onChange={(e) => setCancellationReason(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            disabled={!cancellationReason || transitionM.isPending}
            onClick={() =>
              transitionM.mutate({
                procurementId: procurement.id as string,
                event: "cancel",
                payload: { reason: cancellationReason },
              })
            }
          >
            Batalkan
          </Button>
          <Button disabled={transitionM.isPending} onClick={handleFinishReceive}>
            Selesai Review
          </Button>
        </div>
      </div>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

export function ReviewingSjCaLive({ procurement, items }: StateViewProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Sedang Direview Cabang</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Cabang sedang menerima barang. Anda hanya bisa melihat progresnya.
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <SuratJalanButton procurementId={procurement.id as string} />
      </div>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

// =============================================================================
// WaitingForPayment — BA: invoice preview; CA: invoice + Mark Paid
// =============================================================================
export function WaitingForPaymentBaInvoice({ procurement, items, invoice }: StateViewProps) {
  const total = (invoice?.totalAmount as number) ?? 0;
  // Prefer the invoice's frozen lineItems over the live procurement items
  // so the detail page matches the print window. The procurement items
  // can drift (eg reject reversals on cancel) after the invoice snapshot
  // is taken at finish-receive time.
  const invoiceLineItems =
    (invoice?.lineItems as Array<Record<string, unknown>> | undefined) ?? null;
  const previewItems = invoiceLineItems
    ? invoiceLineItemsToRows(invoiceLineItems)
    : rowsToItems(items);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Invoice: Menunggu Pembayaran</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Invoice berikut sudah diterbitkan. Silakan transfer sesuai total di bawah.
          </p>
          <ScmItemTable mode="invoice-preview" items={previewItems} />
          <p className="mt-4 text-right text-lg font-semibold">
            Total: Rp {total.toLocaleString("id-ID")}
          </p>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <InvoiceButton procurementId={procurement.id as string} />
      </div>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

export function WaitingForPaymentCaInvoice({ procurement, items, invoice }: StateViewProps) {
  const transitionM = useTransitionMutation();
  const total = (invoice?.totalAmount as number) ?? 0;
  const invoiceLineItems =
    (invoice?.lineItems as Array<Record<string, unknown>> | undefined) ?? null;
  const previewItems = invoiceLineItems
    ? invoiceLineItemsToRows(invoiceLineItems)
    : rowsToItems(items);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Invoice: Tandai Pembayaran</CardTitle>
        </CardHeader>
        <CardContent>
          <ScmItemTable mode="invoice-preview" items={previewItems} />
          <p className="mt-4 text-right text-lg font-semibold">
            Total: Rp {total.toLocaleString("id-ID")}
          </p>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <InvoiceButton procurementId={procurement.id as string} label="Cetak Invoice" />
        <Button
          disabled={transitionM.isPending}
          onClick={() =>
            transitionM.mutate({ procurementId: procurement.id as string, event: "mark-paid" })
          }
        >
          Tandai Telah Dibayar
        </Button>
      </div>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

// =============================================================================
// Finished — read-only "Lunas"
// =============================================================================
export function FinishedView({ procurement, items, invoice }: StateViewProps) {
  const total = (invoice?.totalAmount as number) ?? 0;
  const invoiceLineItems =
    (invoice?.lineItems as Array<Record<string, unknown>> | undefined) ?? null;
  const previewItems = invoiceLineItems
    ? invoiceLineItemsToRows(invoiceLineItems)
    : rowsToItems(items);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Lunas</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm">
            Pengadaan ini sudah dibayar lunas. Total dibayar:{" "}
            <strong>Rp {total.toLocaleString("id-ID")}</strong>
          </p>
          <ScmItemTable mode="read-only" items={previewItems} />
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <InvoiceButton procurementId={procurement.id as string} />
      </div>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

// =============================================================================
// Cancelled — read-only
// =============================================================================
export function CancelledView({ procurement, items }: StateViewProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Pengadaan Dibatalkan</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm">
            Pengadaan ini dibatalkan. <strong>Alasan:</strong>{" "}
            {(procurement.cancellationReason as string) || "-"}
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}
