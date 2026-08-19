import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";

import {
  Send,
  Check,
  XCircle,
  Truck,
  PackageCheck,
  ClipboardCheck,
  CreditCard,
  Ban,
  Undo2,
  Printer,
  AlertCircle,
} from "lucide-react";
import {
  submitMutasiTransfer,
  approveMutasiTransfer,
  rejectMutasiTransfer,
  withdrawMutasiTransfer,
  shipMutasiTransfer,
  markDeliveredMutasiTransfer,
  openReceiveMutasiTransfer,
  finishReceiveMutasiTransfer,
  markPaidMutasiTransfer,
  cancelMutasiTransfer,
} from "#/lib/server/scm-transfers";
import { printMutasiSuratJalan, printMutasiInvoice } from "#/lib/server/scm-transfer-print";
import { openPrintWindow } from "#/lib/print-window";
import { lookupLabel } from "#/lib/label-lookup";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Sender/receiver/AM view of a transfer row — the fields these views render. */
export interface TransferRow {
  id: string;
  code: string;
  status: string;
}

/** Transfer line item as rendered by these views. */
export interface TransferItemRow {
  id: string;
  ingredientId: string;
  quantity: number;
  receivedQuantity: number | null;
  rejectedQuantity: number | null;
  unitPrice: number;
  reason: string | null;
}

/** Transfer invoice header — fields these views render. */
export interface TransferInvoiceRow {
  code: string;
  totalAmount: number;
  paidAt: Date | string | null;
}

/** Transfer audit log entry — fields these views render. */
export interface TransferAuditRow {
  id: string;
  event: string;
  fromState: string | null;
  toState: string | null;
  note: string | null;
  createdAt: Date | string;
}

export interface TransferViewProps {
  transfer: TransferRow;
  items: TransferItemRow[];
  invoice: TransferInvoiceRow | null;
  auditLog: TransferAuditRow[];
  branchById: Map<string, { id: string; name: string }>;
  ingredientById: Map<string, { id: string; name: string; stockUnit: string }>;
  /** Whether the current user is the sender branch_admin */
  isSenderBa: boolean;
  /** Whether the current user is the receiver branch_admin */
  isReceiverBa: boolean;
  /** Whether the current user is an area_manager */
  isAm: boolean;
  /** Whether the AM can act on this transfer (both branches in jurisdiction) */
  amInJurisdiction: boolean;
  /** Navigate back to the list page */
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useTransferActions(transferId: string) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

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
  const printSJ = useServerFn(printMutasiSuratJalan);
  const printInv = useServerFn(printMutasiInvoice);

  async function run<T>(fn: () => Promise<T>) {
    setError(null);
    try {
      await fn();
      void queryClient.invalidateQueries({ queryKey: ["scm-transfer", transferId] });
      void queryClient.invalidateQueries({ queryKey: ["scm-transfers"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aksi gagal");
    }
  }

  return {
    error,
    setError,
    run,
    actions: {
      submit: () => run(() => submitMut({ data: { transferId } })),
      approve: () => run(() => approveMut({ data: { transferId } })),
      reject: (reason: string) => run(() => rejectMut({ data: { transferId, reason } })),
      withdraw: () => run(() => withdrawMut({ data: { transferId } })),
      ship: () => run(() => shipMut({ data: { transferId } })),
      markDelivered: () => run(() => markDeliveredMut({ data: { transferId } })),
      openReceive: () => run(() => openReceiveMut({ data: { transferId } })),
      finishReceive: (
        items: Array<{
          id: string;
          receivedQuantity: number;
          rejectedQuantity: number;
          reason?: string;
        }>,
      ) => run(() => finishReceiveMut({ data: { transferId, items } })),
      markPaid: () => run(() => markPaidMut({ data: { transferId } })),
      cancel: (reason: string) => run(() => cancelMut({ data: { transferId, reason } })),
      printSJ: async () => {
        const html = await printSJ({ data: { transferId } });
        openPrintWindow(html);
      },
      printInvoice: async () => {
        const html = await printInv({ data: { transferId } });
        openPrintWindow(html);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Shared layout primitives
// ---------------------------------------------------------------------------

/** Section with consistent vertical rhythm */
function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`space-y-3 ${className}`}>{children}</div>;
}

/** Section heading — lighter than a Card title, used outside Cards */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-medium text-muted-foreground">{children}</h3>;
}

/** Primary action bar — no Card wrapper, visually subordinate to content */
function ActionBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 pt-2">{children}</div>;
}

/** Divider between major sections */
function SectionDivider() {
  return <hr className="border-border" />;
}

/** Render items in read-only mode */
function ReadOnlyItems({
  items,
  ingredientById,
}: {
  items: TransferItemRow[];
  ingredientById: Map<string, { id: string; name: string; stockUnit: string }>;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Belum ada item.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <div className="divide-y">
        {items.map((it) => {
          const ing = ingredientById.get(it.ingredientId);
          return (
            <div key={it.id} className="flex items-center gap-4 p-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {ing?.name ?? it.ingredientId.slice(0, 8) + "..."}
                </p>
                <p className="text-xs text-muted-foreground">
                  Qty janji: {it.quantity} {ing?.stockUnit ?? ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm">
                  Diterima: <strong>{it.receivedQuantity ?? "—"}</strong>
                </p>
                <p className="text-sm">
                  Ditolak: <strong>{it.rejectedQuantity ?? "—"}</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  @ Rp {it.unitPrice.toLocaleString("id-ID")}/{ing?.stockUnit ?? "unit"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Status labels for audit log display */
const auditStatusLabels = {
  SuratJalanDraft: "Draft SJ",
  PendingAMReview: "Menunggu AM",
  Approved: "Disetujui",
  InTransit: "Dalam Pengiriman",
  Delivered: "Diterima",
  ReviewingSJ: "Review Penerima",
  WaitingForPayment: "Menunggu Bayar",
  Finished: "Lunas",
  Rejected: "Ditolak",
  Cancelled: "Dibatalkan",
};

/** Event labels for audit log display */
const auditEventLabels = {
  submit: "Diajukan",
  approve: "Disetujui",
  reject: "Ditolak",
  withdraw: "Ditarik",
  ship: "Dikirim",
  "mark-delivered": "Ditandai Diterima",
  "open-receive": "Review Dibuka",
  "finish-receive": "Review Selesai",
  "mark-paid": "Ditandai Lunas",
  cancel: "Dibatalkan",
  "item-update": "Item Diperbarui",
};

/** Render the audit log */
function AuditLog({ rows }: { rows: TransferAuditRow[] }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="rounded-md border">
      <div className="border-b p-4">
        <h3 className="text-sm font-medium">Riwayat</h3>
      </div>
      <div className="divide-y">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-3 p-3 text-sm">
            <span className="w-32 text-xs text-muted-foreground">
              {new Date(row.createdAt).toLocaleString("id-ID")}
            </span>
            <span className="font-medium">
              {lookupLabel(auditEventLabels, String(row.event)) ?? String(row.event)}
            </span>
            <span className="text-muted-foreground">
              {lookupLabel(auditStatusLabels, String(row.fromState)) ?? String(row.fromState)}
              {" → "}
              {lookupLabel(auditStatusLabels, String(row.toState)) ?? String(row.toState)}
            </span>
            {row.note ? (
              <span className="truncate text-xs italic text-muted-foreground">{row.note}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Print buttons (shown from Approved onwards) */
function PrintButtons({
  onPrintSJ,
  onPrintInvoice,
  showInvoice,
}: {
  onPrintSJ: () => void;
  onPrintInvoice: () => void;
  showInvoice: boolean;
}) {
  return (
    <div className="flex gap-2">
      <Button variant="outline" onClick={onPrintSJ}>
        <Printer className="mr-1 h-4 w-4" />
        Cetak SJ
      </Button>
      {showInvoice && (
        <Button variant="outline" onClick={onPrintInvoice}>
          <Printer className="mr-1 h-4 w-4" />
          Cetak Invoice
        </Button>
      )}
    </div>
  );
}

/** Error banner */
function ErrorBanner({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">{error}</span>
      <button onClick={onDismiss} className="text-destructive/70">
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminal views (shared across all roles)
// ---------------------------------------------------------------------------

export function FinishedView(props: TransferViewProps) {
  return (
    <Section>
      <div>
        <SectionHeading>Item</SectionHeading>
        <ReadOnlyItems items={props.items} ingredientById={props.ingredientById} />
      </div>

      {props.invoice && (
        <>
          <SectionDivider />
          <InvoiceCard invoice={props.invoice} />
        </>
      )}

      {props.auditLog.length > 0 && (
        <>
          <SectionDivider />
          <AuditLog rows={props.auditLog} />
        </>
      )}
    </Section>
  );
}

export function RejectedView(props: TransferViewProps) {
  return (
    <Section>
      <div>
        <SectionHeading>Item</SectionHeading>
        <ReadOnlyItems items={props.items} ingredientById={props.ingredientById} />
      </div>

      {props.auditLog.length > 0 && (
        <>
          <SectionDivider />
          <AuditLog rows={props.auditLog} />
        </>
      )}
    </Section>
  );
}

export function CancelledView(props: TransferViewProps) {
  return (
    <Section>
      <div>
        <SectionHeading>Item</SectionHeading>
        <ReadOnlyItems items={props.items} ingredientById={props.ingredientById} />
      </div>

      {props.auditLog.length > 0 && (
        <>
          <SectionDivider />
          <AuditLog rows={props.auditLog} />
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Invoice card (used by WaitingForPayment and Finished)
// ---------------------------------------------------------------------------

function InvoiceCard({ invoice }: { invoice: TransferInvoiceRow }) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b p-4">
        <h3 className="text-sm font-medium">Invoice</h3>
        <Badge variant={invoice.paidAt ? "success" : "warning"}>
          {invoice.paidAt ? "Lunas" : "Belum Dibayar"}
        </Badge>
      </div>
      <div className="p-4">
        <p className="text-sm">Kode: {String(invoice.code)}</p>
        <p className="text-2xl font-bold">Rp {invoice.totalAmount.toLocaleString("id-ID")}</p>
        {invoice.paidAt ? (
          <p className="text-xs text-muted-foreground">
            Dibayar: {new Date(invoice.paidAt).toLocaleDateString("id-ID")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sender BA views
// ---------------------------------------------------------------------------

export function DraftSenderForm(props: TransferViewProps) {
  const { transfer, items, ingredientById, auditLog } = props;
  const { error, setError, actions } = useTransferActions(transfer.id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  return (
    <Section>
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <div>
        <SectionHeading>Item</SectionHeading>
        <ReadOnlyItems items={items} ingredientById={ingredientById} />
      </div>

      <SectionDivider />

      <div>
        <SectionHeading>Aksi</SectionHeading>
        <p className="text-sm text-muted-foreground mb-3">
          Kirim Surat Jalan ini ke Area Manager untuk persetujuan. Pastikan item dan jumlah sudah
          benar.
        </p>
        <ActionBar>
          <Button
            onClick={async () => {
              await actions.submit();
              toast.success("Mutasi dikirim ke AM untuk review.");
            }}
          >
            <Send className="mr-1 h-4 w-4" />
            Kirim ke AM
          </Button>
          <Button variant="destructive" onClick={() => setCancelOpen(true)}>
            <Ban className="mr-1 h-4 w-4" />
            Batalkan
          </Button>
        </ActionBar>
      </div>

      {auditLog.length > 0 && (
        <>
          <SectionDivider />
          <AuditLog rows={auditLog} />
        </>
      )}

      {cancelOpen && (
        <CancelModal
          code={transfer.code}
          reason={cancelReason}
          onReasonChange={setCancelReason}
          onCancel={() => {
            setCancelOpen(false);
            setCancelReason("");
          }}
          onConfirm={async () => {
            if (!cancelReason.trim()) {
              setError("Alasan pembatalan wajib diisi");
              return;
            }
            await actions.cancel(cancelReason);
            setCancelOpen(false);
            setCancelReason("");
            toast.success("Mutasi dibatalkan.");
          }}
          status={transfer.status}
        />
      )}
    </Section>
  );
}

export function PendingSenderWaiting(props: TransferViewProps) {
  const { transfer, items, ingredientById, auditLog } = props;
  const { error, setError, actions } = useTransferActions(transfer.id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  return (
    <Section>
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <div>
        <SectionHeading>Item</SectionHeading>
        <ReadOnlyItems items={items} ingredientById={ingredientById} />
      </div>

      <SectionDivider />

      <div>
        <SectionHeading>Menunggu Review</SectionHeading>
        <p className="text-sm text-muted-foreground mb-3">
          Mutasi ini sedang menunggu review dari Area Manager. Anda dapat menarik kembali ke Draft
          jika perlu mengubah.
        </p>
        <ActionBar>
          <Button
            variant="outline"
            onClick={async () => {
              await actions.withdraw();
              toast.success("Mutasi ditarik kembali ke Draft.");
            }}
          >
            <Undo2 className="mr-1 h-4 w-4" />
            Tarik Kembali ke Draft
          </Button>
          <Button variant="destructive" onClick={() => setCancelOpen(true)}>
            <Ban className="mr-1 h-4 w-4" />
            Batalkan
          </Button>
        </ActionBar>
      </div>

      {auditLog.length > 0 && (
        <>
          <SectionDivider />
          <AuditLog rows={auditLog} />
        </>
      )}

      {cancelOpen && (
        <CancelModal
          code={transfer.code}
          reason={cancelReason}
          onReasonChange={setCancelReason}
          onCancel={() => {
            setCancelOpen(false);
            setCancelReason("");
          }}
          onConfirm={async () => {
            if (!cancelReason.trim()) {
              setError("Alasan pembatalan wajib diisi");
              return;
            }
            await actions.cancel(cancelReason);
            setCancelOpen(false);
            setCancelReason("");
            toast.success("Mutasi dibatalkan.");
          }}
          status={transfer.status}
        />
      )}
    </Section>
  );
}

export function ApprovedSenderShip(props: TransferViewProps) {
  const { transfer, items, ingredientById, invoice, auditLog } = props;
  const { error, setError, actions } = useTransferActions(transfer.id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  return (
    <Section>
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <div>
        <SectionHeading>Item</SectionHeading>
        <ReadOnlyItems items={items} ingredientById={ingredientById} />
      </div>

      <SectionDivider />

      <div>
        <SectionHeading>Siap Dikirim</SectionHeading>
        <p className="text-sm text-muted-foreground mb-3">
          Mutasi telah disetujui oleh Area Manager. Kirim barang ke cabang penerima. Stok akan
          dikurangi dari inventaris Anda.
        </p>
        <ActionBar>
          <Button
            onClick={async () => {
              await actions.ship();
              toast.success("Barang dikirim. Stok dipindahkan ke in-transit.");
            }}
          >
            <Truck className="mr-1 h-4 w-4" />
            Kirim
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await actions.withdraw();
              toast.success("Mutasi ditarik kembali ke Draft.");
            }}
          >
            <Undo2 className="mr-1 h-4 w-4" />
            Tarik ke Draft
          </Button>
          <PrintButtons
            onPrintSJ={actions.printSJ}
            onPrintInvoice={actions.printInvoice}
            showInvoice={!!invoice}
          />
        </ActionBar>
      </div>

      {auditLog.length > 0 && (
        <>
          <SectionDivider />
          <AuditLog rows={auditLog} />
        </>
      )}

      {cancelOpen && (
        <CancelModal
          code={transfer.code}
          reason={cancelReason}
          onReasonChange={setCancelReason}
          onCancel={() => {
            setCancelOpen(false);
            setCancelReason("");
          }}
          onConfirm={async () => {
            if (!cancelReason.trim()) {
              setError("Alasan pembatalan wajib diisi");
              return;
            }
            await actions.cancel(cancelReason);
            setCancelOpen(false);
            setCancelReason("");
            toast.success("Mutasi dibatalkan.");
          }}
          status={transfer.status}
        />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Area Manager views
// ---------------------------------------------------------------------------

export function PendingAmReview(props: TransferViewProps) {
  const { transfer, items, ingredientById, auditLog } = props;
  const { error, setError, actions } = useTransferActions(transfer.id);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  return (
    <Section>
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <div>
        <SectionHeading>Item</SectionHeading>
        <ReadOnlyItems items={items} ingredientById={ingredientById} />
      </div>

      <SectionDivider />

      <div>
        <SectionHeading>Review Area Manager</SectionHeading>
        <p className="text-sm text-muted-foreground mb-3">
          Mutasi ini menunggu persetujuan Anda. Setujui untuk melanjutkan proses pengiriman, atau
          tolak dengan alasan.
        </p>
        <ActionBar>
          <Button
            onClick={async () => {
              await actions.approve();
              toast.success("Mutasi disetujui.");
            }}
          >
            <Check className="mr-1 h-4 w-4" />
            Setujui
          </Button>
          <Button variant="destructive" onClick={() => setRejectOpen(true)}>
            <XCircle className="mr-1 h-4 w-4" />
            Tolak
          </Button>
        </ActionBar>
      </div>

      {auditLog.length > 0 && (
        <>
          <SectionDivider />
          <AuditLog rows={auditLog} />
        </>
      )}

      {rejectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
            <h3 className="text-lg font-semibold">Tolak Mutasi</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Tolak mutasi <strong>{transfer.code}</strong>?
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Alasan penolakan (wajib)"
              rows={3}
              className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setRejectOpen(false);
                  setRejectReason("");
                }}
                className="h-9 rounded-md border px-4 text-sm"
              >
                Batal
              </button>
              <button
                onClick={async () => {
                  if (!rejectReason.trim()) {
                    setError("Alasan penolakan wajib diisi");
                    return;
                  }
                  await actions.reject(rejectReason);
                  setRejectOpen(false);
                  setRejectReason("");
                  toast.success("Mutasi ditolak.");
                }}
                className="h-9 rounded-md bg-destructive px-4 text-sm text-destructive-foreground"
              >
                Tolak
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Receiver BA views
// ---------------------------------------------------------------------------

export function InTransitReceiverTracking(props: TransferViewProps) {
  const { transfer, items, ingredientById, auditLog } = props;
  const { error, setError, actions } = useTransferActions(transfer.id);

  return (
    <Section>
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <div>
        <SectionHeading>Item</SectionHeading>
        <ReadOnlyItems items={items} ingredientById={ingredientById} />
      </div>

      <SectionDivider />

      <div>
        <SectionHeading>Dalam Perjalanan</SectionHeading>
        <p className="text-sm text-muted-foreground mb-3">
          Barang sedang dalam perjalanan dari cabang pengirim. Tandai sebagai diterima setelah
          barang tiba.
        </p>
        <ActionBar>
          <Button
            onClick={async () => {
              await actions.markDelivered();
              toast.success("Barang ditandai diterima.");
            }}
          >
            <PackageCheck className="mr-1 h-4 w-4" />
            Tandai Diterima
          </Button>
        </ActionBar>
      </div>

      {auditLog.length > 0 && (
        <>
          <SectionDivider />
          <AuditLog rows={auditLog} />
        </>
      )}
    </Section>
  );
}

export function DeliveredReceiverForm(props: TransferViewProps) {
  const { transfer, items, ingredientById, auditLog } = props;
  const { error, setError, actions } = useTransferActions(transfer.id);

  return (
    <Section>
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <div>
        <SectionHeading>Item</SectionHeading>
        <ReadOnlyItems items={items} ingredientById={ingredientById} />
      </div>

      <SectionDivider />

      <div>
        <SectionHeading>Barang Diterima</SectionHeading>
        <p className="text-sm text-muted-foreground mb-3">
          Barang telah tiba di cabang Anda. Mulai review untuk memeriksa jumlah yang diterima dan
          ditolak.
        </p>
        <ActionBar>
          <Button
            onClick={async () => {
              await actions.openReceive();
              toast.success("Review penerimaan dimulai.");
            }}
          >
            <ClipboardCheck className="mr-1 h-4 w-4" />
            Mulai Review
          </Button>
        </ActionBar>
      </div>

      {auditLog.length > 0 && (
        <>
          <SectionDivider />
          <AuditLog rows={auditLog} />
        </>
      )}
    </Section>
  );
}

export function ReviewingReceiverInteractive(props: TransferViewProps) {
  const { transfer, items, ingredientById, auditLog } = props;
  const { error, setError, actions } = useTransferActions(transfer.id);
  const [reviewEdits, setReviewEdits] = useState<
    Record<string, { received: number; rejected: number; reason: string }>
  >({});
  const [reviewError, setReviewError] = useState<string | null>(null);

  return (
    <Section>
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <div className="rounded-md border">
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <h3 className="text-sm font-medium">Review Penerimaan</h3>
            <p className="text-xs text-muted-foreground">
              Masukkan jumlah yang diterima dan ditolak untuk setiap item.
            </p>
          </div>
          {reviewError && (
            <span className="text-xs text-destructive bg-destructive/10 px-2 py-1 rounded">
              {reviewError}
            </span>
          )}
        </div>
        <div className="divide-y">
          {items.map((it) => {
            const ing = ingredientById.get(it.ingredientId);
            const edit = reviewEdits[it.id] ?? {
              received: it.receivedQuantity ?? it.quantity,
              rejected: it.rejectedQuantity ?? 0,
              reason: it.reason ?? "",
            };
            const sumOk = edit.received + edit.rejected === it.quantity;
            return (
              <div key={it.id} className="space-y-2 p-4">
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-sm font-medium">
                    {ing?.name ?? it.ingredientId.slice(0, 8) + "..."}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    Janji: {it.quantity} {ing?.stockUnit ?? ""}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-muted-foreground">Diterima</label>
                    <input
                      type="number"
                      min={0}
                      value={edit.received}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setReviewEdits((prev) => ({
                          ...prev,
                          [it.id]: { ...(prev[it.id] ?? edit), received: val },
                        }));
                      }}
                      className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-muted-foreground">Ditolak</label>
                    <input
                      type="number"
                      min={0}
                      value={edit.rejected}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setReviewEdits((prev) => ({
                          ...prev,
                          [it.id]: { ...(prev[it.id] ?? edit), rejected: val },
                        }));
                      }}
                      className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right text-sm"
                    />
                  </div>
                  {edit.rejected > 0 && (
                    <div className="flex items-center gap-1">
                      <label className="text-xs text-muted-foreground">Alasan</label>
                      <input
                        value={edit.reason}
                        onChange={(e) =>
                          setReviewEdits((prev) => ({
                            ...prev,
                            [it.id]: {
                              ...(prev[it.id] ?? edit),
                              reason: e.target.value,
                            },
                          }))
                        }
                        placeholder="Wajib"
                        className="h-8 w-40 rounded-md border border-input bg-background px-2 text-sm"
                      />
                    </div>
                  )}
                  {!sumOk && (
                    <span className="text-xs text-destructive">
                      {edit.received + edit.rejected} ≠ {it.quantity}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {/* Summary row */}
        <div className="border-t bg-muted/30 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total: {items.length} item</span>
            <div className="flex items-center gap-4">
              <span>
                Janji: <strong>{items.reduce((s, it) => s + it.quantity, 0)}</strong>
              </span>
              <span>
                Diterima:{" "}
                <strong>
                  {items.reduce((s, it) => {
                    const edit = reviewEdits[it.id];
                    return s + (edit?.received ?? it.receivedQuantity ?? it.quantity);
                  }, 0)}
                </strong>
              </span>
              <span>
                Ditolak:{" "}
                <strong>
                  {items.reduce((s, it) => {
                    const edit = reviewEdits[it.id];
                    return s + (edit?.rejected ?? it.rejectedQuantity ?? 0);
                  }, 0)}
                </strong>
              </span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" onClick={() => setReviewEdits({})}>
            Batal
          </Button>
          <Button
            onClick={async () => {
              setReviewError(null);
              const payload: Array<{
                id: string;
                receivedQuantity: number;
                rejectedQuantity: number;
                reason?: string;
              }> = [];
              for (const it of items) {
                const edit = reviewEdits[it.id] ?? {
                  received: it.receivedQuantity ?? it.quantity,
                  rejected: it.rejectedQuantity ?? 0,
                  reason: it.reason ?? "",
                };
                if (edit.received + edit.rejected !== it.quantity) {
                  const ing = ingredientById.get(it.ingredientId);
                  setReviewError(
                    `${ing?.name ?? it.ingredientId.slice(0, 8)}: diterima + ditolak harus = ${it.quantity}`,
                  );
                  return;
                }
                if (edit.rejected > 0 && !edit.reason.trim()) {
                  const ing = ingredientById.get(it.ingredientId);
                  setReviewError(
                    `${ing?.name ?? it.ingredientId.slice(0, 8)}: alasan penolakan wajib diisi`,
                  );
                  return;
                }
                payload.push({
                  id: it.id,
                  receivedQuantity: edit.received,
                  rejectedQuantity: edit.rejected,
                  reason: edit.reason || undefined,
                });
              }
              try {
                await actions.finishReceive(payload);
                toast.success("Penerimaan Mutasi Stok berhasil. Stok telah diperbarui.");
              } catch (err) {
                toast.error(
                  `Gagal memperbarui stok: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
              setReviewEdits({});
              setReviewError(null);
            }}
          >
            <Check className="mr-1 h-4 w-4" />
            Simpan Review
          </Button>
        </div>
      </div>

      {auditLog.length > 0 && (
        <>
          <SectionDivider />
          <AuditLog rows={auditLog} />
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Shared views (no role-specific logic)
// ---------------------------------------------------------------------------

export function WaitingInvoice(props: TransferViewProps) {
  const { transfer, items, ingredientById, invoice, auditLog } = props;
  const { error, setError, actions } = useTransferActions(transfer.id);

  return (
    <Section>
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <div>
        <SectionHeading>Item</SectionHeading>
        <ReadOnlyItems items={items} ingredientById={ingredientById} />
      </div>

      {invoice && (
        <>
          <SectionDivider />
          <InvoiceCard invoice={invoice} />
        </>
      )}

      {props.isSenderBa && (
        <>
          <SectionDivider />
          <div>
            <SectionHeading>Pembayaran</SectionHeading>
            <p className="text-sm text-muted-foreground mb-3">
              Invoice telah diterbitkan. Tandai lunas setelah menerima pembayaran dari cabang
              penerima.
            </p>
            <ActionBar>
              <Button
                onClick={async () => {
                  await actions.markPaid();
                  toast.success("Invoice ditandai lunas.");
                }}
              >
                <CreditCard className="mr-1 h-4 w-4" />
                Tandai Lunas
              </Button>
              <PrintButtons
                onPrintSJ={actions.printSJ}
                onPrintInvoice={actions.printInvoice}
                showInvoice={!!invoice}
              />
            </ActionBar>
          </div>
        </>
      )}

      {props.amInJurisdiction && (
        <>
          <SectionDivider />
          <div>
            <SectionHeading>Aksi AM</SectionHeading>
            <CancelAction
              code={transfer.code}
              status={transfer.status}
              onCancel={async (reason) => {
                await actions.cancel(reason);
                toast.success("Mutasi dibatalkan.");
              }}
              onError={(msg) => setError(msg)}
            />
          </div>
        </>
      )}

      {auditLog.length > 0 && (
        <>
          <SectionDivider />
          <AuditLog rows={auditLog} />
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Shared cancel action (inline, not modal — used by AM at multiple states)
// ---------------------------------------------------------------------------

function CancelAction({
  code,
  status,
  onCancel,
  onError,
}: {
  code: string;
  status: string;
  onCancel: (reason: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <Ban className="mr-1 h-4 w-4" />
        Batalkan
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Batalkan mutasi <strong>{code}</strong>?
      </p>
      {status === "InTransit" && (
        <p className="text-xs text-muted-foreground">
          Stok yang sedang dalam perjalanan akan dikembalikan ke cabang pengirim.
        </p>
      )}
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Alasan pembatalan (wajib)"
        rows={3}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
          className="h-9 rounded-md border px-4 text-sm"
        >
          Tutup
        </button>
        <button
          onClick={async () => {
            if (!reason.trim()) {
              onError("Alasan pembatalan wajib diisi");
              return;
            }
            await onCancel(reason);
            setOpen(false);
            setReason("");
          }}
          className="h-9 rounded-md bg-destructive px-4 text-sm text-destructive-foreground"
        >
          Batalkan
        </button>
      </div>
    </div>
  );
}

/** Cancel modal (used by sender BA views) */
function CancelModal({
  code,
  reason,
  onReasonChange,
  onCancel,
  onConfirm,
  status,
}: {
  code: string;
  reason: string;
  onReasonChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  status: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h3 className="text-lg font-semibold">Batalkan Mutasi</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Batalkan mutasi <strong>{code}</strong>?
        </p>
        {status === "InTransit" && (
          <p className="mt-1 text-xs text-muted-foreground">
            Stok yang sedang dalam perjalanan akan dikembalikan ke cabang pengirim.
          </p>
        )}
        <textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Alasan pembatalan (wajib)"
          rows={3}
          className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="h-9 rounded-md border px-4 text-sm">
            Tutup
          </button>
          <button
            onClick={onConfirm}
            className="h-9 rounded-md bg-destructive px-4 text-sm text-destructive-foreground"
          >
            Batalkan
          </button>
        </div>
      </div>
    </div>
  );
}
