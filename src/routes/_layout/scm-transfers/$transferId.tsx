import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import { usePageTitle } from "#/hooks/usePageTitle";
import RoleGuard from "#/components/RoleGuard";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import Modal from "#/components/ui/Modal";
import {
  ArrowLeft,
  Check,
  XCircle,
  Truck,
  PackageCheck,
  Ban,
  Send,
  CreditCard,
  ClipboardCheck,
  Undo2,
  AlertCircle,
  Printer,
} from "lucide-react";
import {
  approveMutasiTransfer,
  cancelMutasiTransfer,
  finishReceiveMutasiTransfer,
  getMutasiTransfer,
  markDeliveredMutasiTransfer,
  markPaidMutasiTransfer,
  openReceiveMutasiTransfer,
  rejectMutasiTransfer,
  shipMutasiTransfer,
  submitMutasiTransfer,
  withdrawMutasiTransfer,
} from "#/lib/server/scm-transfers";
import { canAmAct } from "#/lib/server/scm-transfer-queries";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/_layout/scm-transfers/$transferId")({
  component: TransferDetailPage,
  loader: async ({ params }) => {
    const data = await getMutasiTransfer({ data: { transferId: params.transferId } });
    return { initial: data };
  },
});

const statusLabels: Record<string, string> = {
  SuratJalanDraft: "Draft SJ",
  PendingAMReview: "Menunggu AM",
  Approved: "Disetujui",
  InTransit: "Dalam Pengiriman",
  Delivered: "Diterima Cabang",
  ReviewingSJ: "Review Penerima",
  WaitingForPayment: "Menunggu Bayar",
  Finished: "Lunas",
  Rejected: "Ditolak",
  Cancelled: "Dibatalkan",
};

const statusColors: Record<
  string,
  "default" | "warning" | "success" | "destructive" | "secondary"
> = {
  SuratJalanDraft: "secondary",
  PendingAMReview: "warning",
  Approved: "default",
  InTransit: "default",
  Delivered: "default",
  ReviewingSJ: "default",
  WaitingForPayment: "warning",
  Finished: "success",
  Rejected: "destructive",
  Cancelled: "secondary",
};

function TransferDetailPage() {
  const { user } = useAuth();
  const { transferId } = Route.useParams();
  const { initial } = Route.useLoaderData();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);

  const { data: result } = useQuery({
    queryKey: ["scm-transfer", transferId],
    queryFn: () => getMutasiTransfer({ data: { transferId } }),
    initialData: initial ?? undefined,
  });

  usePageTitle(
    result?.transfer ? `Mutasi ${result.transfer.code}` : "Mutasi",
    "Surat Jalan antar cabang",
  );

  const submitMut = useServerFn(submitMutasiTransfer);
  const approveMut = useServerFn(approveMutasiTransfer);
  const rejectMut = useServerFn(rejectMutasiTransfer);
  const withdrawMut = useServerFn(withdrawMutasiTransfer);
  const shipMut = useServerFn(shipMutasiTransfer);
  const markDeliveredMut = useServerFn(markDeliveredMutasiTransfer);
  const openReceiveMut = useServerFn(openReceiveMutasiTransfer);
  const finishReceiveMut = useServerFn(finishReceiveMutasiTransfer);
  const markPaidMut = useServerFn(markPaidMutasiTransfer);
  const cancelMut = useServerFn(cancelMutasiTransfer);

  if (!result) {
    return (
      <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
        <div className="text-muted-foreground">Mutasi tidak ditemukan</div>
      </RoleGuard>
    );
  }

  const { transfer, items, invoice, auditLog } = result;
  const isSenderBa = user?.role === "branch_admin" && user?.branchId === transfer.fromBranchId;
  const isReceiverBa = user?.role === "branch_admin" && user?.branchId === transfer.toBranchId;
  const isAm = user?.role === "area_manager";
  const amInJurisdiction =
    isAm && user?.assignedBranches
      ? canAmAct(
          { assignedBranches: user.assignedBranches },
          transfer,
        )
      : false;

  async function runAction(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      void queryClient.invalidateQueries({ queryKey: ["scm-transfer", transferId] });
      void queryClient.invalidateQueries({ queryKey: ["scm-transfers"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aksi gagal");
    }
  }

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div className="space-y-6">
        <button
          onClick={() => navigate({ to: "/scm-transfers" })}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali
        </button>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-destructive/70">✕</button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">{transfer.code}</h1>
            <p className="text-sm text-muted-foreground">Mutasi Stok Antar Cabang</p>
          </div>
          <Badge
            variant={
              (statusColors[transfer.status] ?? "default") as
                | "default"
                | "success"
                | "warning"
                | "destructive"
                | "secondary"
            }
          >
            {statusLabels[transfer.status] ?? transfer.status}
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Dari Cabang</p>
            <p className="font-medium mt-1">{transfer.fromBranchId.slice(0, 8)}…</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Ke Cabang</p>
            <p className="font-medium mt-1">{transfer.toBranchId.slice(0, 8)}…</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Jumlah Item</p>
            <p className="font-medium mt-1">{items.length}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Dibuat</p>
            <p className="font-medium mt-1">
              {new Date(transfer.createdAt).toLocaleDateString("id-ID")}
            </p>
          </div>
        </div>

        {/* Items */}
        <div className="rounded-lg border">
          <div className="p-4 border-b">
            <h2 className="font-semibold">Item</h2>
          </div>
          <div className="divide-y">
            {items.map((it) => (
              <div key={it.id} className="p-4 flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm font-medium">{it.ingredientId.slice(0, 8)}…</p>
                  <p className="text-xs text-muted-foreground">Qty janji: {it.quantity}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm">
                    Diterima: <strong>{it.receivedQuantity ?? "—"}</strong>
                  </p>
                  <p className="text-sm">
                    Ditolak: <strong>{it.rejectedQuantity ?? "—"}</strong>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    @ Rp {it.unitPrice.toLocaleString("id-ID")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Invoice (if any) */}
        {invoice && (
          <div className="rounded-lg border">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="font-semibold">Invoice</h2>
              <Badge variant={invoice.paidAt ? "success" : "warning"}>
                {invoice.paidAt ? "Lunas" : "Belum Dibayar"}
              </Badge>
            </div>
            <div className="p-4 space-y-2">
              <p className="text-sm">Kode: {invoice.code}</p>
              <p className="text-2xl font-bold">
                Rp {invoice.totalAmount.toLocaleString("id-ID")}
              </p>
              {invoice.paidAt && (
                <p className="text-xs text-muted-foreground">
                  Dibayar: {new Date(invoice.paidAt).toLocaleDateString("id-ID")}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Action bar */}
        <div className="rounded-lg border p-4">
          <h2 className="font-semibold mb-3">Aksi</h2>
          <div className="flex flex-wrap gap-2">
            {/* SuratJalanDraft */}
            {transfer.status === "SuratJalanDraft" && isSenderBa && (
              <>
                <Button
                  onClick={() => runAction(() => submitMut({ data: { transferId } }))}
                >
                  <Send className="h-4 w-4 mr-1" />
                  Kirim ke AM
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setCancelOpen(true)}
                >
                  <Ban className="h-4 w-4 mr-1" />
                  Batalkan
                </Button>
              </>
            )}

            {/* PendingAMReview */}
            {transfer.status === "PendingAMReview" && (
              <>
                {amInJurisdiction && (
                  <>
                    <Button
                      onClick={() => runAction(() => approveMut({ data: { transferId } }))}
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Setujui
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => setRejectOpen(true)}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Tolak
                    </Button>
                  </>
                )}
                {isSenderBa && (
                  <Button
                    variant="outline"
                    onClick={() => runAction(() => withdrawMut({ data: { transferId } }))}
                  >
                    <Undo2 className="h-4 w-4 mr-1" />
                    Tarik Kembali ke Draft
                  </Button>
                )}
                <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                  <Ban className="h-4 w-4 mr-1" />
                  Batalkan
                </Button>
              </>
            )}

            {/* Approved */}
            {transfer.status === "Approved" && (
              <>
                {isSenderBa && (
                  <>
                    <Button
                      onClick={() => runAction(() => shipMut({ data: { transferId } }))}
                    >
                      <Truck className="h-4 w-4 mr-1" />
                      Kirim
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => runAction(() => withdrawMut({ data: { transferId } }))}
                    >
                      <Undo2 className="h-4 w-4 mr-1" />
                      Tarik ke Draft
                    </Button>
                  </>
                )}
                {amInJurisdiction && (
                  <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                    <Ban className="h-4 w-4 mr-1" />
                    Batalkan
                  </Button>
                )}
              </>
            )}

            {/* InTransit */}
            {transfer.status === "InTransit" && (
              <>
                {isReceiverBa && (
                  <Button
                    onClick={() => runAction(() => markDeliveredMut({ data: { transferId } }))}
                  >
                    <PackageCheck className="h-4 w-4 mr-1" />
                    Tandai Diterima
                  </Button>
                )}
                {amInJurisdiction && (
                  <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                    <Ban className="h-4 w-4 mr-1" />
                    Batalkan
                  </Button>
                )}
              </>
            )}

            {/* Delivered */}
            {transfer.status === "Delivered" && (
              <>
                {isReceiverBa && (
                  <Button
                    onClick={() => runAction(() => openReceiveMut({ data: { transferId } }))}
                  >
                    <ClipboardCheck className="h-4 w-4 mr-1" />
                    Mulai Review
                  </Button>
                )}
                {amInJurisdiction && (
                  <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                    <Ban className="h-4 w-4 mr-1" />
                    Batalkan
                  </Button>
                )}
              </>
            )}

            {/* ReviewingSJ */}
            {transfer.status === "ReviewingSJ" && isReceiverBa && (
              <Button onClick={() => setReviewOpen(true)}>
                <Check className="h-4 w-4 mr-1" />
                Selesaikan Review
              </Button>
            )}
            {transfer.status === "ReviewingSJ" && amInJurisdiction && (
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                <Ban className="h-4 w-4 mr-1" />
                Batalkan
              </Button>
            )}

            {/* WaitingForPayment */}
            {transfer.status === "WaitingForPayment" && isSenderBa && (
              <Button
                onClick={() => runAction(() => markPaidMut({ data: { transferId } }))}
              >
                <CreditCard className="h-4 w-4 mr-1" />
                Tandai Lunas
              </Button>
            )}
            {transfer.status === "WaitingForPayment" && amInJurisdiction && (
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                <Ban className="h-4 w-4 mr-1" />
                Batalkan
              </Button>
            )}

            {/* Print buttons (any state from InTransit onwards) */}
            {(transfer.status === "Approved" || transfer.status === "InTransit" || transfer.status === "Delivered" || transfer.status === "ReviewingSJ" || transfer.status === "WaitingForPayment" || transfer.status === "Finished") && (
              <a
                href={`/api/scm-transfer/print-sj?transferId=${transferId}`}
                target="_blank"
                rel="noopener"
                className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-sm hover:bg-accent"
              >
                <Printer className="h-4 w-4" />
                Cetak SJ
              </a>
            )}
            {invoice && (
              <a
                href={`/api/scm-transfer/print-invoice?transferId=${transferId}`}
                target="_blank"
                rel="noopener"
                className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-sm hover:bg-accent"
              >
                <Printer className="h-4 w-4" />
                Cetak Invoice
              </a>
            )}
          </div>
        </div>

        {/* Audit log */}
        {auditLog && auditLog.length > 0 && (
          <div className="rounded-lg border">
            <div className="p-4 border-b">
              <h2 className="font-semibold">Riwayat</h2>
            </div>
            <div className="divide-y">
              {auditLog.map((row) => (
                <div key={row.id} className="p-3 text-sm flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-32">
                    {new Date(row.createdAt).toLocaleString("id-ID")}
                  </span>
                  <span className="font-medium">{row.event}</span>
                  <span className="text-muted-foreground">
                    {row.fromState} → {row.toState}
                  </span>
                  {row.note && (
                    <span className="text-xs italic text-muted-foreground truncate">
                      {row.note}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reject modal */}
        <Modal
          open={rejectOpen}
          onClose={() => setRejectOpen(false)}
          title="Tolak Mutasi"
        >
          <div className="space-y-3">
            <p className="text-sm">Tolak mutasi <strong>{transfer.code}</strong>?</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Alasan penolakan (wajib)"
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRejectOpen(false)}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Batal
              </button>
              <button
                onClick={async () => {
                  if (!rejectReason.trim()) {
                    setError("Alasan penolakan wajib diisi");
                    return;
                  }
                  await runAction(() => rejectMut({ data: { transferId, reason: rejectReason } }));
                  setRejectOpen(false);
                  setRejectReason("");
                }}
                className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm"
              >
                Tolak
              </button>
            </div>
          </div>
        </Modal>

        {/* Cancel modal */}
        <Modal
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          title="Batalkan Mutasi"
        >
          <div className="space-y-3">
            <p className="text-sm">Batalkan mutasi <strong>{transfer.code}</strong>?</p>
            {transfer.status === "InTransit" && (
              <p className="text-xs text-muted-foreground">
                Stok yang sedang dalam perjalanan akan dikembalikan ke cabang pengirim.
              </p>
            )}
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Alasan pembatalan (wajib)"
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCancelOpen(false)}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Tutup
              </button>
              <button
                onClick={async () => {
                  if (!cancelReason.trim()) {
                    setError("Alasan pembatalan wajib diisi");
                    return;
                  }
                  await runAction(() => cancelMut({ data: { transferId, reason: cancelReason } }));
                  setCancelOpen(false);
                  setCancelReason("");
                }}
                className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm"
              >
                Batalkan
              </button>
            </div>
          </div>
        </Modal>

        {/* Finish-review modal */}
        <Modal
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          title="Selesaikan Review"
          size="lg"
        >
          <FinishReviewForm
            items={items}
            onClose={() => setReviewOpen(false)}
            onSubmit={async (payload) => {
              await runAction(() => finishReceiveMut({ data: { transferId, items: payload } }));
              setReviewOpen(false);
            }}
          />
        </Modal>
      </div>
    </RoleGuard>
  );
}

function FinishReviewForm({
  items,
  onClose,
  onSubmit,
}: {
  items: Array<{
    id: string;
    quantity: number;
    receivedQuantity?: number | null;
    rejectedQuantity?: number | null;
    reason?: string | null;
  }>;
  onClose: () => void;
  onSubmit: (payload: Array<{ id: string; receivedQuantity: number; rejectedQuantity: number; reason?: string }>) => Promise<void>;
}) {
  const [rows, setRows] = useState(() =>
    items.map((it) => ({
      id: it.id,
      qty: it.quantity,
      received: it.receivedQuantity ?? it.quantity,
      rejected: it.rejectedQuantity ?? 0,
      reason: it.reason ?? "",
    })),
  );
  const [error, setError] = useState<string | null>(null);

  const update = (id: string, patch: Partial<(typeof rows)[number]>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const handleSubmit = async () => {
    setError(null);
    for (const r of rows) {
      if (r.received + r.rejected !== r.qty) {
        setError(`Baris ${r.id.slice(0, 8)}: diterima + ditolak harus = ${r.qty}`);
        return;
      }
      if (r.rejected > 0 && !r.reason.trim()) {
        setError(`Baris ${r.id.slice(0, 8)}: alasan penolakan wajib diisi`);
        return;
      }
    }
    await onSubmit(
      rows.map((r) => ({
        id: r.id,
        receivedQuantity: r.received,
        rejectedQuantity: r.rejected,
        reason: r.reason || undefined,
      })),
    );
  };

  return (
    <div className="space-y-3">
      {error && <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">{error}</div>}
      <p className="text-sm text-muted-foreground">
        Isi jumlah yang diterima dan ditolak per item. Total (diterima + ditolak) harus sama dengan jumlah janji.
      </p>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-4 text-sm font-medium">{r.id.slice(0, 8)}…</div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground">Janji</label>
              <input value={r.qty} disabled className="h-8 w-full rounded-md border bg-muted px-2 text-sm text-right" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground">Diterima</label>
              <input
                type="number"
                min={0}
                value={r.received}
                onChange={(e) => update(r.id, { received: Number(e.target.value) })}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-right"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground">Ditolak</label>
              <input
                type="number"
                min={0}
                value={r.rejected}
                onChange={(e) => update(r.id, { rejected: Number(e.target.value) })}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-right"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground">Alasan</label>
              <input
                value={r.reason}
                onChange={(e) => update(r.id, { reason: e.target.value })}
                disabled={r.rejected === 0}
                placeholder={r.rejected > 0 ? "Wajib" : "—"}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="h-9 px-4 rounded-md border text-sm">
          Batal
        </button>
        <button
          onClick={handleSubmit}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
        >
          Selesaikan Review
        </button>
      </div>
    </div>
  );
}
