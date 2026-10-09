import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import Modal from "#/components/ui/Modal";
import { getInventory } from "#/lib/server/inventory";

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
  updateMutasiTransferDraftItems,
} from "#/lib/server/scm-transfers";
import { printMutasiSuratJalan, printMutasiInvoice } from "#/lib/server/scm-transfer-print";
import { openPrintWindow } from "#/lib/print-window";
import { lookupLabel } from "#/lib/label-lookup";
import { formatQuantity } from "#/lib/utils";
import { toast } from "sonner";

/** What happens to a rejected line's stock (issue #93 follow-up). */
type RejectionDisposition = "Return to Source" | "Scrap" | "Quarantine";

const DISPOSITION_OPTIONS: Array<{ value: RejectionDisposition; label: string }> = [
  { value: "Return to Source", label: "Return ke Pengirim" },
  { value: "Scrap", label: "Scrap / Buang" },
  { value: "Quarantine", label: "Karantina" },
];

function toDisposition(value: string): RejectionDisposition {
  return value === "Scrap" || value === "Quarantine" ? value : "Return to Source";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Sender/receiver/AM view of a transfer row — the fields these views render. */
export interface TransferRow {
  id: string;
  code: string;
  status: string;
  /** Sender branch — the draft editor reads its stock for the hard guardrail hint. */
  fromBranchId: string;
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
  /** Receiver BA's chosen disposition for the rejected qty. */
  rejectionDisposition?: RejectionDisposition | null;
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
  /**
   * Whether the current user is a super_admin. Emergency override (ADR 0006):
   * the FSM permits it on every transition and `assertTransferAccess` lets it
   * act on any branch's transfer, so it is shown the action views of whichever
   * actor owns the current state — sender BA, receiver BA, or AM.
   */
  isSuperAdmin: boolean;
  /** Navigate back to the list page */
  onBack: () => void;
  /**
   * Per-unit prices are the HPP snapshot — hidden for branch_admin.
   * Defaults to true (non-BA roles see prices).
   */
  showPrices?: boolean;
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
  const saveDraftItemsMut = useServerFn(updateMutasiTransferDraftItems);
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
          rejectionDisposition?: RejectionDisposition;
        }>,
        opts: { acceptedAllWithoutCount?: boolean } = {},
      ) =>
        run(() =>
          finishReceiveMut({
            data: { transferId, items, acceptedAllWithoutCount: opts.acceptedAllWithoutCount },
          }),
        ),
      markPaid: () => run(() => markPaidMut({ data: { transferId } })),
      cancel: (reason: string) => run(() => cancelMut({ data: { transferId, reason } })),
      /**
       * Edit draft line quantities. Re-throws on failure so the caller can tell
       * success (clear edits, toast) from the banner error `setError` shows.
       */
      saveDraftItems: async (items: Array<{ id: string; quantity: number }>) => {
        setError(null);
        try {
          await saveDraftItemsMut({ data: { transferId, items } });
          void queryClient.invalidateQueries({ queryKey: ["scm-transfer", transferId] });
          void queryClient.invalidateQueries({ queryKey: ["scm-transfers"] });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Aksi gagal");
          throw err;
        }
      },
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
  showPrices = true,
}: {
  items: TransferItemRow[];
  ingredientById: Map<string, { id: string; name: string; stockUnit: string }>;
  showPrices?: boolean;
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
                  {ing?.stockUnit ? (
                    <span className="text-xs text-muted-foreground"> ({ing.stockUnit})</span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  Qty janji: {formatQuantity(it.quantity)} {ing?.stockUnit ?? ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm">
                  Diterima:{" "}
                  <strong>
                    {it.receivedQuantity != null ? formatQuantity(it.receivedQuantity) : "—"}
                  </strong>
                  {ing?.stockUnit ? ` ${ing.stockUnit}` : ""}
                </p>
                <p className="text-sm">
                  Ditolak:{" "}
                  <strong>
                    {it.rejectedQuantity != null ? formatQuantity(it.rejectedQuantity) : "—"}
                  </strong>
                  {ing?.stockUnit ? ` ${ing.stockUnit}` : ""}
                  {(it.rejectedQuantity ?? 0) > 0 && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({it.rejectionDisposition === "Scrap" ? "Scrap" : "Return ke Pengirim"})
                    </span>
                  )}
                </p>
                {showPrices && (
                  <p className="text-xs text-muted-foreground">
                    @ Rp {it.unitPrice.toLocaleString("id-ID")}/{ing?.stockUnit ?? "unit"}
                  </p>
                )}
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
        <ReadOnlyItems
          items={props.items}
          ingredientById={props.ingredientById}
          showPrices={props.showPrices ?? true}
        />
      </div>

      {props.invoice && (
        <>
          <SectionDivider />
          <InvoiceCard invoice={props.invoice} showPrices={props.showPrices ?? true} />
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
        <ReadOnlyItems
          items={props.items}
          ingredientById={props.ingredientById}
          showPrices={props.showPrices ?? true}
        />
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
        <ReadOnlyItems
          items={props.items}
          ingredientById={props.ingredientById}
          showPrices={props.showPrices ?? true}
        />
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

function InvoiceCard({
  invoice,
  showPrices,
}: {
  invoice: TransferInvoiceRow;
  showPrices?: boolean;
}) {
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
        {/* ID15: the invoice total is money — hidden from branch_admin along
            with the per-unit HPP snapshot. */}
        {showPrices && (
          <p className="text-2xl font-bold">Rp {invoice.totalAmount.toLocaleString("id-ID")}</p>
        )}
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

/**
 * Editable line quantities for a `SuratJalanDraft`.
 *
 * The promised quantity is the number every later stage is measured against,
 * so it has to be correctable *before* the AM sees it. Editing lives here
 * rather than in the shared `ReadOnlyItems` because only this state permits it
 * — the server rejects the same call in any other state.
 */
function EditableDraftItems({
  items,
  ingredientById,
  edits,
  onEdit,
  stockByIngredient,
  showPrices = true,
}: {
  items: TransferItemRow[];
  ingredientById: Map<string, { id: string; name: string; stockUnit: string }>;
  /** Raw input values by item id; a missing key means "as stored". */
  edits: Record<string, string>;
  onEdit: (itemId: string, value: string) => void;
  stockByIngredient: Map<string, number>;
  /** Per-unit HPP snapshot — hidden for branch_admin, same rule everywhere else. */
  showPrices?: boolean;
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
          const raw = edits[it.id] ?? String(it.quantity);
          const value = Number(raw);
          const invalid = !Number.isFinite(value) || value <= 0;
          const available = stockByIngredient.get(it.ingredientId);
          // Mirrors new.tsx's over-stock warning. The server enforces the same
          // ceiling on save (hardStockCheck); this only avoids a failed save.
          const overStock = available != null && !invalid && value > available + 1e-9;
          return (
            <div key={it.id} className="flex items-center gap-4 p-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {ing?.name ?? it.ingredientId.slice(0, 8) + "..."}
                  {ing?.stockUnit ? (
                    <span className="text-xs text-muted-foreground"> ({ing.stockUnit})</span>
                  ) : null}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <label
                  className={`block text-[11px] ${invalid ? "text-destructive" : "text-muted-foreground"}`}
                >
                  Jumlah
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={raw}
                  aria-label={`Jumlah ${ing?.name ?? it.ingredientId.slice(0, 8)}`}
                  onChange={(e) => onEdit(it.id, e.target.value)}
                  className={`h-9 w-24 rounded-md border px-2 text-sm text-right ${
                    invalid || overStock
                      ? "border-destructive bg-destructive/5 text-destructive"
                      : "border-input bg-background"
                  }`}
                />
                <span
                  className={`mt-0.5 block text-[10px] ${
                    overStock ? "text-destructive font-medium" : "text-muted-foreground"
                  }`}
                >
                  {overStock ? "melebihi stok" : "tersedia"}{" "}
                  {available != null ? formatQuantity(available) : "?"}
                  {ing?.stockUnit ? ` ${ing.stockUnit}` : ""}
                </span>
                {showPrices && (
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    @ Rp {it.unitPrice.toLocaleString("id-ID")}
                    {ing?.stockUnit ? `/${ing.stockUnit}` : ""}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DraftSenderForm(props: TransferViewProps) {
  const { transfer, items, ingredientById, auditLog } = props;
  const { error, setError, actions } = useTransferActions(transfer.id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  // In-place quantity edits. Keyed by item id; absent = keep the stored value.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // The sender's stock, so the form can flag a line that the server's
  // hardStockCheck would refuse before the user hits save.
  const { data: inventoryResult } = useQuery({
    queryKey: ["inventory-branch", transfer.fromBranchId],
    queryFn: () => getInventory({ data: { branchId: transfer.fromBranchId, limit: 1000 } }),
  });
  const stockByIngredient = useMemo(() => {
    const m = new Map<string, number>();
    for (const inv of inventoryResult?.data ?? []) m.set(inv.ingredientId, inv.quantity);
    return m;
  }, [inventoryResult]);

  const parsed = items.map((it) => ({
    id: it.id,
    quantity: Number(edits[it.id] ?? String(it.quantity)),
  }));
  const hasInvalid = parsed.some((p) => !Number.isFinite(p.quantity) || p.quantity <= 0);
  const hasChanges = items.some(
    (it) => Number(edits[it.id] ?? String(it.quantity)) !== it.quantity,
  );

  const saveQuantities = async () => {
    setError(null);
    if (hasInvalid) {
      setError("Jumlah harus berupa angka lebih dari 0");
      return;
    }
    if (!hasChanges) return;
    setIsSaving(true);
    try {
      await actions.saveDraftItems(parsed);
      setEdits({});
      toast.success("Jumlah item draft diperbarui.");
    } catch {
      // The server message is already in the banner (set by the action).
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Section>
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <div>
        <SectionHeading>Item</SectionHeading>
        <EditableDraftItems
          items={items}
          ingredientById={ingredientById}
          edits={edits}
          onEdit={(itemId, value) => setEdits((prev) => ({ ...prev, [itemId]: value }))}
          stockByIngredient={stockByIngredient}
          showPrices={props.showPrices ?? true}
        />
        <ActionBar>
          <Button
            variant="outline"
            size="sm"
            onClick={saveQuantities}
            disabled={isSaving || !hasChanges || hasInvalid}
          >
            Simpan Jumlah
          </Button>
          {hasChanges && (
            <Button variant="ghost" size="sm" onClick={() => setEdits({})} disabled={isSaving}>
              Batalkan Perubahan
            </Button>
          )}
        </ActionBar>
        {/* The save button is disabled while a line is invalid, so the reason
            has to be stated rather than left to the red border. */}
        {hasInvalid && (
          <p className="text-xs text-destructive">
            Jumlah setiap item harus berupa angka lebih dari 0.
          </p>
        )}
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
        <ReadOnlyItems
          items={items}
          ingredientById={ingredientById}
          showPrices={props.showPrices ?? true}
        />
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
        <ReadOnlyItems
          items={items}
          ingredientById={ingredientById}
          showPrices={props.showPrices ?? true}
        />
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
        <ReadOnlyItems
          items={items}
          ingredientById={ingredientById}
          showPrices={props.showPrices ?? true}
        />
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
        <ReadOnlyItems
          items={items}
          ingredientById={ingredientById}
          showPrices={props.showPrices ?? true}
        />
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
        <ReadOnlyItems
          items={items}
          ingredientById={ingredientById}
          showPrices={props.showPrices ?? true}
        />
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

/**
 * Resolving a line's current review state.
 *
 * `received` defaults to **0**, never to the promised `quantity`. It used to
 * default to `it.quantity`, which meant a receiver who opened the form and
 * clicked Submit — never touching a field — recorded a perfect delivery. All 22
 * transfers in the database were received that way: 100% credited,
 * `rejectedQuantity` 0 on every line, so a physical shortage was never once
 * representable and `inventory` drifted above what actually arrived. See
 * ADR 0019.
 *
 * A partially-reviewed transfer (one where `finish-receive` already ran, e.g.
 * re-opened) keeps whatever was previously recorded.
 */
type ReviewEdit = {
  received: number;
  rejected: number;
  reason: string;
  disposition: RejectionDisposition;
};

function resolveReviewEdit(it: TransferItemRow, override?: ReviewEdit): ReviewEdit {
  if (override) return override;
  if (it.receivedQuantity != null) {
    return {
      received: it.receivedQuantity,
      rejected: it.rejectedQuantity ?? 0,
      reason: it.reason ?? "",
      disposition: toDisposition(it.rejectionDisposition ?? "Return to Source"),
    };
  }
  return {
    received: 0,
    rejected: 0,
    reason: "",
    disposition: "Return to Source",
  };
}

export function ReviewingReceiverInteractive(props: TransferViewProps) {
  const { transfer, items, ingredientById, auditLog } = props;
  const { error, setError, actions } = useTransferActions(transfer.id);
  const [reviewEdits, setReviewEdits] = useState<Record<string, ReviewEdit>>({});
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [confirmFullReject, setConfirmFullReject] = useState(false);
  // Mirror of the Jambangan-incident guard on the reject side: accepting a
  // whole delivery without counting is the exact gesture that hid the Royal
  // Plaza gaps, so it gets its own explicit confirmation.
  const [confirmAcceptAll, setConfirmAcceptAll] = useState(false);
  const [acceptAllWithoutCount, setAcceptAllWithoutCount] = useState(false);

  const editFor = (it: TransferItemRow): ReviewEdit => resolveReviewEdit(it, reviewEdits[it.id]);

  /** Every line at 100% accepted, nothing rejected — the ambiguous case. */
  const isWholeDeliveryAccepted = () =>
    items.length > 0 &&
    items.every((it) => {
      const e = editFor(it);
      return e.rejected === 0 && e.received === it.quantity;
    });

  /** Has the receiver touched this line, or is it still the untouched 0 default? */
  const untouchedCount = () =>
    items.filter((it) => reviewEdits[it.id] === undefined && it.receivedQuantity == null).length;

  const submitReview = async (opts: { withoutCount?: boolean } = {}) => {
    setReviewError(null);
    const payload: Array<{
      id: string;
      receivedQuantity: number;
      rejectedQuantity: number;
      reason?: string;
      rejectionDisposition?: RejectionDisposition;
    }> = [];
    for (const it of items) {
      const edit = editFor(it);
      if (edit.received + edit.rejected !== it.quantity) {
        const ing = ingredientById.get(it.ingredientId);
        setReviewError(
          `${ing?.name ?? it.ingredientId.slice(0, 8)}: diterima + ditolak harus = ${it.quantity}`,
        );
        return;
      }
      if (edit.rejected > 0 && !edit.reason.trim()) {
        const ing = ingredientById.get(it.ingredientId);
        setReviewError(`${ing?.name ?? it.ingredientId.slice(0, 8)}: alasan penolakan wajib diisi`);
        return;
      }
      payload.push({
        id: it.id,
        receivedQuantity: edit.received,
        rejectedQuantity: edit.rejected,
        reason: edit.reason || undefined,
        rejectionDisposition: edit.rejected > 0 ? edit.disposition : undefined,
      });
    }
    try {
      await actions.finishReceive(payload, {
        acceptedAllWithoutCount: opts.withoutCount === true,
      });
      toast.success("Penerimaan Mutasi Stok berhasil. Stok telah diperbarui.");
    } catch (err) {
      toast.error(`Gagal memperbarui stok: ${err instanceof Error ? err.message : String(err)}`);
    }
    setReviewEdits({});
    setReviewError(null);
    setConfirmAcceptAll(false);
    setAcceptAllWithoutCount(false);
  };

  /**
   * Fill every line with the promised quantity. Deliberately a separate,
   * named action rather than a default, so "we didn't count" is a decision the
   * receiver makes in front of them and is recorded as one.
   */
  const fillAllAsPromised = () => {
    const next: Record<string, ReviewEdit> = {};
    for (const it of items) {
      const base = editFor(it);
      next[it.id] = { ...base, received: it.quantity, rejected: 0 };
    }
    setReviewEdits(next);
    setReviewError(null);
  };

  return (
    <Section>
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <div className="rounded-md border">
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <h3 className="text-sm font-medium">Review Penerimaan</h3>
            <p className="text-xs text-muted-foreground">
              Hitung jumlah yang benar-benar tiba untuk setiap item, lalu isi kolom diterima dan
              ditolak. Kolom dimulai kosong — sistem tidak boleh mencatat lebih dari yang ada.
            </p>
          </div>
          {reviewError && (
            <span className="text-xs text-destructive bg-destructive/10 px-2 py-1 rounded">
              {reviewError}
            </span>
          )}
        </div>

        {untouchedCount() > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-amber-500/5 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              {untouchedCount()} dari {items.length} item belum dihitung. Kalau barang tidak sempat
              dihitung, gunakan tombol di bawah — pilihan ini akan dicatat di log dokumen.
            </p>
            <Button variant="outline" size="sm" onClick={fillAllAsPromised}>
              Terima semua sesuai janji
            </Button>
          </div>
        )}
        <div className="divide-y">
          {items.map((it) => {
            const ing = ingredientById.get(it.ingredientId);
            const edit = editFor(it);
            const sumOk = edit.received + edit.rejected === it.quantity;
            return (
              <div key={it.id} className="space-y-2 p-4">
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-sm font-medium">
                    {ing?.name ?? it.ingredientId.slice(0, 8) + "..."}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    Janji: {formatQuantity(it.quantity)} {ing?.stockUnit ?? ""}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-muted-foreground">
                      Diterima{ing?.stockUnit ? ` (${ing.stockUnit})` : ""}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={edit.received}
                      onChange={(e) => {
                        const val = e.target.value === "" ? 0 : Number(e.target.value);
                        setReviewEdits((prev) => ({
                          ...prev,
                          [it.id]: { ...edit, received: val },
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
                      step="any"
                      value={edit.rejected}
                      onChange={(e) => {
                        const val = e.target.value === "" ? 0 : Number(e.target.value);
                        setReviewEdits((prev) => ({
                          ...prev,
                          [it.id]: { ...edit, rejected: val },
                        }));
                      }}
                      className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right text-sm"
                    />
                  </div>
                  {edit.rejected > 0 && (
                    <>
                      <div className="flex items-center gap-1">
                        <label className="text-xs text-muted-foreground">Alasan</label>
                        <input
                          value={edit.reason}
                          onChange={(e) =>
                            setReviewEdits((prev) => ({
                              ...prev,
                              [it.id]: { ...edit, reason: e.target.value },
                            }))
                          }
                          placeholder="Wajib"
                          className="h-8 w-40 rounded-md border border-input bg-background px-2 text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="text-xs text-muted-foreground">Barang ditolak</label>
                        <select
                          value={edit.disposition}
                          onChange={(e) =>
                            setReviewEdits((prev) => ({
                              ...prev,
                              [it.id]: { ...edit, disposition: toDisposition(e.target.value) },
                            }))
                          }
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          {DISPOSITION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                  {!sumOk && (
                    <span className="text-xs text-destructive">
                      {formatQuantity(edit.received + edit.rejected)} ≠{" "}
                      {formatQuantity(it.quantity)}
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
                Janji:{" "}
                <strong>{formatQuantity(items.reduce((s, it) => s + it.quantity, 0))}</strong>
              </span>
              <span>
                Diterima:{" "}
                <strong>
                  {formatQuantity(items.reduce((s, it) => s + editFor(it).received, 0))}
                </strong>
              </span>
              <span>
                Ditolak:{" "}
                <strong>
                  {formatQuantity(
                    items.reduce((s, it) => {
                      const edit = reviewEdits[it.id];
                      return s + (edit?.rejected ?? it.rejectedQuantity ?? 0);
                    }, 0),
                  )}
                </strong>
              </span>
              <span className="text-muted-foreground">
                (
                {[
                  ...new Set(
                    items
                      .map((it) => ingredientById.get(it.ingredientId)?.stockUnit)
                      .filter(Boolean),
                  ),
                ].join(", ")}
                )
              </span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" onClick={() => setReviewEdits({})}>
            Batal
          </Button>
          <Button
            onClick={() => {
              // Jambangan-incident guard: rejecting EVERY line requires an
              // explicit confirmation click before anything is submitted.
              const effectiveRejected =
                items.some((it) => editFor(it).rejected > 0) &&
                items.every((it) => editFor(it).rejected >= it.quantity);
              if (effectiveRejected) {
                setConfirmFullReject(true);
                return;
              }
              // Mirror guard on the accept side: accepting every line in full
              // is the gesture that hid the Royal Plaza gaps, so it must be a
              // deliberate choice, and we ask whether anything was counted.
              if (isWholeDeliveryAccepted() && !acceptAllWithoutCount) {
                setConfirmAcceptAll(true);
                return;
              }
              void submitReview({ withoutCount: acceptAllWithoutCount });
            }}
          >
            <Check className="mr-1 h-4 w-4" />
            Simpan Review
          </Button>
        </div>
      </div>

      <Modal
        open={confirmAcceptAll}
        onClose={() => setConfirmAcceptAll(false)}
        title="Terima 100% sesuai janji?"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Semua {items.length} item akan dicatat <strong>diterima penuh</strong> sesuai jumlah
            yang dijanjikan, tanpa ada yang ditolak. Kalau barangnya kurang, catat sekarang —
            setelah disimpan, stok tidak bisa dikoreksi lagi lewat penerimaan ini.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={acceptAllWithoutCount}
              onChange={(e) => setAcceptAllWithoutCount(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Barang <strong>tidak dihitung</strong> — saya hanya menyalin jumlah janji.
              <span className="block text-xs text-muted-foreground">
                Centang ini akan tercatat pada log dokumen, sehingga selisih stok yang baru ketahuan
                nanti bisa ditelusuri ke penerimaan ini.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmAcceptAll(false)}>
              Periksa lagi
            </Button>
            <Button
              onClick={() => {
                setConfirmAcceptAll(false);
                void submitReview({ withoutCount: acceptAllWithoutCount });
              }}
            >
              Ya, terima semua
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={confirmFullReject}
        onClose={() => setConfirmFullReject(false)}
        title="Tolak semua barang?"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Semua barang pada mutasi ini akan ditandai <strong>ditolak</strong> dan dikembalikan ke
            cabang pengirim. Stok tidak akan masuk ke cabang Anda. Yakin ingin melanjutkan?
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmFullReject(false)}>
              Periksa lagi
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmFullReject(false);
                void submitReview();
              }}
            >
              Ya, tolak semua
            </Button>
          </div>
        </div>{" "}
      </Modal>

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
        <ReadOnlyItems
          items={items}
          ingredientById={ingredientById}
          showPrices={props.showPrices ?? true}
        />
      </div>

      {invoice && (
        <>
          <SectionDivider />
          <InvoiceCard invoice={invoice} />
        </>
      )}

      {(props.isSenderBa || props.isSuperAdmin) && (
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

      {(props.amInJurisdiction || props.isSuperAdmin) && (
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
