import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Button } from "#/components/ui/button";
import { ScmItemTable, type ScmItemRow } from "./ScmItemTable";
import { AuditLogCard } from "./AuditLogCard";
import { transitionProcurement, updateProcurementItem, listProcurements } from "#/lib/server/scm-queries";
import { printSuratJalan, printInvoice } from "#/lib/server/scm-print";
import { openPrintWindow } from "#/lib/print-window";

interface ProcurementRow extends Record<string, unknown> {
  id: string;
  code: string;
  branchId: string;
  submittedAt: string | Date | null;
  createdAt: string | Date;
}

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
  pendingReview?: Array<Record<string, unknown>>;
}

function rowsToItems(items: Array<Record<string, unknown>>): ScmItemRow[] {
  return (items as unknown as ScmItemRow[]).map((it) => ({
    ...it,
    // CA's caDecision: default 'pending' to 'approved' so accepting-as-is
    // just clicks the primary button. The CA only needs to click 'Tolak'
    // for items they want to reject. Without this, a 'pending' decision
    // is treated as 'not approved' by copyReadyToPicked, silently zeroing
    // out pickedQuantity (and thus everything downstream: SJ, BA's
    // receivedQuantity default, invoice line items, branch inventory).
    caDecision: it.caDecision === "pending" ? "approved" : it.caDecision,
    // CA's readyQuantity: default to the requested quantity. The input
    // shows this as defaultValue (uncontrolled), but the underlying state
    // is null until typed. Defaulting ensures the payload sends the right
    // value when the CA accepts-as-is.
    readyQuantity: it.readyQuantity ?? it.quantity ?? null,
    // BA's receivedQuantity: default to the picked quantity. The input
    // shows pickedQuantity as the visual default (controlled, value =
    // received = it.receivedQuantity ?? pickedQuantity), but the state
    // is null until typed. Defaulting ensures accepting-as-is works
    // without the user having to type each row.
    receivedQuantity: it.receivedQuantity ?? it.pickedQuantity ?? null,
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
function SuratJalanButton({ procurementId, label = "Lihat Surat Jalan" }: { procurementId: string; label?: string }) {
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
function InvoiceButton({ procurementId, label = "Lihat Invoice" }: { procurementId: string; label?: string }) {
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
      queryClient.invalidateQueries({ queryKey: ["scm-procurement", vars.procurementId] });
      queryClient.invalidateQueries({ queryKey: ["scm-procurements"] });
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
      queryClient.invalidateQueries({ queryKey: ["scm-procurement-items", vars.procurementId] });
    },
  });
}

// =============================================================================
// Draft — BA: editable form with Submit button
// =============================================================================
export function DraftForm({ procurement, items }: StateViewProps) {
  const transitionM = useTransitionMutation();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Item Pengadaan</CardTitle>
        </CardHeader>
        <CardContent>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
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
          disabled={transitionM.isPending}
        >
          Submit Pengadaan
        </Button>
      </div>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

// =============================================================================
// Pending — BA: read-only + Withdraw button; CA: review queue (placeholder)
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
            Pengadaan sudah disubmit. Admin Pusat akan membuka review. Anda masih bisa menariknya kembali.
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

export function PendingCaQueue(_props: StateViewProps) {
  const transitionM = useTransitionMutation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ["scm-procurements", "Pending"],
    queryFn: () => listProcurements({ data: { status: "Pending" } }),
  });

  function openReview(procurementId: string) {
    transitionM.mutate(
      { procurementId, event: "open-review" },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["scm-procurements"] });
          navigate({
            to: "/scm-procurements/$procurementId",
            params: { procurementId },
          });
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Antrian Review</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Memuat...</p>
        ) : (pending as ProcurementRow[]).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tidak ada pengadaan yang menunggu review saat ini.
          </p>
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left">Kode</th>
                  <th className="px-3 py-2 text-left">Cabang</th>
                  <th className="px-3 py-2 text-left">Tanggal Submit</th>
                  <th className="w-32"></th>
                </tr>
              </thead>
              <tbody>
                {(pending as ProcurementRow[]).map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="px-3 py-2">
                      <Link
                        to="/scm-procurements/$procurementId"
                        params={{ procurementId: p.id }}
                        className="font-mono text-sm font-medium text-primary hover:underline"
                      >
                        {p.code}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {p.branchId.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-2">
                      {p.submittedAt
                        ? new Date(p.submittedAt as string).toLocaleString("id-ID")
                        : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        onClick={() => openReview(p.id)}
                        disabled={transitionM.isPending}
                      >
                        Buka Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Review Pengadaan</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Setujui per item atau tolak seluruh pengadaan. Item yang disetujui akan dikirim; yang ditolak diabaikan.
            Pengeditan tersimpan saat Anda klik <strong>Setujui & Buat SJ</strong>.
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
          <input
            type="text"
            placeholder="Alasan penolakan (wajib jika menolak semua)"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm"
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
            disabled={transitionM.isPending || updateM.isPending}
            onClick={handleAcceptAndShip}
          >
            {updateM.isPending ? "Menyimpan..." : transitionM.isPending ? "Memproses..." : "Setujui & Buat SJ"}
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
            Admin Pusat sedang memutuskan item mana yang akan dikirim. Anda hanya bisa melihat progresnya.
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
export function RejectedView({ procurement }: StateViewProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Pengadaan Ditolak</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            <strong>Alasan:</strong> {(procurement.rejectionReason as string) || "-"}
          </p>
        </CardContent>
      </Card>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}

// =============================================================================
// InTransit — BA: tracking; CA: detail + Mark Delivered
// =============================================================================
export function InTransitBaTracking({ procurement, items }: StateViewProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Dalam Pengiriman</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Stock sedang dalam perjalanan. Tunggu sampai Admin Pusat menandai sudah dikirim.
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

export function InTransitCaDetail({ procurement, items }: StateViewProps) {
  const transitionM = useTransitionMutation();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Dalam Pengiriman</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Stock sudah keluar dari gudang. Tandai "Sudah Dikirim" setelah branch konfirmasi barang tiba.
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <SuratJalanButton procurementId={procurement.id as string} label="Cetak Surat Jalan" />
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
          <CardTitle>Sudah Dikirim — Mulai Penerimaan</CardTitle>
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
        <Button
          disabled={transitionM.isPending || updateM.isPending}
          onClick={handleOpenReceive}
        >
          {updateM.isPending ? "Menyimpan..." : transitionM.isPending ? "Memproses..." : "Lanjut ke Review"}
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
            Konfirmasi jumlah yang diterima (Ditolak dihitung otomatis). Klik <strong>Selesai Review</strong> untuk konfirmasi.
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
          <input
            type="text"
            placeholder="Alasan pembatalan (wajib jika batal)"
            value={cancellationReason}
            onChange={(e) => setCancellationReason(e.target.value)}
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm"
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
          <Button
            disabled={transitionM.isPending}
            onClick={handleFinishReceive}
          >
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
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Invoice — Menunggu Pembayaran</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Invoice berikut sudah diterbitkan. Silakan transfer sesuai total di bawah.
          </p>
          <ScmItemTable mode="invoice-preview" items={rowsToItems(items)} />
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
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Invoice — Tandai Pembayaran</CardTitle>
        </CardHeader>
        <CardContent>
          <ScmItemTable mode="invoice-preview" items={rowsToItems(items)} />
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
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Lunas</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm">
            Pengadaan sudah lunas. Total dibayar:{" "}
            <strong>Rp {total.toLocaleString("id-ID")}</strong>
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
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
export function CancelledView({ procurement }: StateViewProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Pengadaan Dibatalkan</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            <strong>Alasan:</strong> {(procurement.cancellationReason as string) || "-"}
          </p>
        </CardContent>
      </Card>
      <AuditLogSection procurementId={procurement.id as string} />
    </div>
  );
}
