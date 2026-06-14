import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  getProcurement,
  getProcurementInvoice,
} from "#/lib/server/scm-queries";
import { getBranches } from "#/lib/server/branches";
import { Button } from "#/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";

export const Route = createFileRoute(
  "/_layout/scm-procurements/$procurementId/print-invoice",
)({
  component: PrintInvoice,
});

interface InvoiceLineItem {
  itemId: string;
  ingredientId: string;
  ingredientName: string;
  receivedQuantity: number;
  rejectedQuantity: number;
  unitPrice: number;
  lineTotal: number;
  baDecision: string;
  reason: string | null;
}

function PrintInvoice() {
  const { procurementId } = Route.useParams();

  const procQ = useQuery({
    queryKey: ["scm-procurement", procurementId],
    queryFn: () => getProcurement({ data: { id: procurementId } }),
  });
  const invoiceQ = useQuery({
    queryKey: ["scm-procurement-invoice", procurementId],
    queryFn: () => getProcurementInvoice({ data: { procurementId } }),
    enabled: !!procQ.data,
    retry: false,
  });
  const branchesQ = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches({ data: {} }),
  });

  if (procQ.isLoading || invoiceQ.isLoading || branchesQ.isLoading) {
    return <div className="p-6">Loading...</div>;
  }
  if (!procQ.data) return <div className="p-6">Procurement tidak ditemukan</div>;
  if (!invoiceQ.data) return <div className="p-6">Invoice belum dibuat untuk pengadaan ini.</div>;

  const proc = procQ.data;
  const invoice = invoiceQ.data;
  const lineItems = (invoice.lineItems ?? []) as InvoiceLineItem[];
  const branches = (branchesQ.data ?? []) as Array<{ id: string; code: string; name: string }>;
  const destBranch = branches.find((b) => b.id === proc.branchId);
  const centralBranch = branches.find((b: Record<string, unknown>) => b.type === "Central");

  // Diterima items: lineTotal > 0
  const acceptedItems = lineItems.filter((li) => li.lineTotal > 0);
  // Ditolak items: rejectedQuantity > 0
  const rejectedItems = lineItems.filter((li) => li.rejectedQuantity > 0);

  const totalQtyAccepted = acceptedItems.reduce((s, li) => s + li.receivedQuantity, 0);
  const totalQtyRejected = rejectedItems.reduce((s, li) => s + li.rejectedQuantity, 0);
  const totalAmount = invoice.totalAmount as number;

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 print:p-4">
      {/* On-screen controls */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link to="/scm-procurements/$procurementId" params={{ procurementId }}>
          <Button variant="ghost">
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Button>
        </Link>
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Cetak
        </Button>
      </div>

      {/* Printable document */}
      <div className="print-only border border-border p-8">
        <div className="flex items-start justify-between border-b border-border pb-4">
          <div>
            <h1 className="text-2xl font-bold">INVOICE</h1>
            <p className="text-sm text-muted-foreground">Omoiyari POS</p>
          </div>
          <div className="text-right text-sm">
            <p><strong>No Invoice:</strong> INV-{proc.code as string}</p>
            <p><strong>No Pengadaan:</strong> {proc.code as string}</p>
            <p><strong>Tanggal:</strong> {new Date(invoice.generatedAt as unknown as string | Date).toLocaleDateString("id-ID")}</p>
            {invoice.paidAt ? (
              <p className="text-green-700">
                <strong>Lunas:</strong> {new Date(invoice.paidAt as unknown as string | Date).toLocaleDateString("id-ID")}
              </p>
            ) : (
              <p className="text-amber-700">Belum Dibayar</p>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Dari:</p>
            <p className="font-medium">{centralBranch?.name ?? "Central Kitchen"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Kepada:</p>
            <p className="font-medium">{destBranch?.name ?? "-"}</p>
          </div>
        </div>

        {/* Accepted items */}
        <h2 className="mt-6 text-base font-semibold">Diterima</h2>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="py-2 text-left">No</th>
              <th className="py-2 text-left">Bahan</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Harga</th>
              <th className="py-2 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {acceptedItems.map((li, idx) => (
              <tr key={li.itemId} className="border-b border-border">
                <td className="py-2">{idx + 1}</td>
                <td className="py-2">{li.ingredientName}</td>
                <td className="py-2 text-right font-mono">{li.receivedQuantity}</td>
                <td className="py-2 text-right font-mono">Rp {li.unitPrice.toLocaleString("id-ID")}</td>
                <td className="py-2 text-right font-mono">Rp {li.lineTotal.toLocaleString("id-ID")}</td>
              </tr>
            ))}
            <tr className="border-b border-border bg-muted/20">
              <td colSpan={2} className="py-2 text-right font-medium">Subtotal diterima ({totalQtyAccepted}):</td>
              <td colSpan={3} className="py-2 text-right font-mono">Rp {totalAmount.toLocaleString("id-ID")}</td>
            </tr>
          </tbody>
        </table>

        {/* Rejected items */}
        {rejectedItems.length > 0 ? (
          <>
            <h2 className="mt-6 text-base font-semibold">Ditolak (Rp 0)</h2>
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="py-2 text-left">No</th>
                  <th className="py-2 text-left">Bahan</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-left">Alasan</th>
                </tr>
              </thead>
              <tbody>
                {rejectedItems.map((li, idx) => (
                  <tr key={`r-${li.itemId}`} className="border-b border-border">
                    <td className="py-2">{idx + 1}</td>
                    <td className="py-2">{li.ingredientName}</td>
                    <td className="py-2 text-right font-mono">{li.rejectedQuantity}</td>
                    <td className="py-2 text-muted-foreground">{li.reason ?? "-"}</td>
                  </tr>
                ))}
                <tr className="border-b border-border bg-muted/20">
                  <td colSpan={2} className="py-2 text-right font-medium">Subtotal ditolak ({totalQtyRejected}):</td>
                  <td colSpan={2} className="py-2 text-right font-mono">Rp 0</td>
                </tr>
              </tbody>
            </table>
          </>
        ) : null}

        {/* Grand total */}
        <div className="mt-6 flex justify-end border-t border-border pt-4">
          <div className="w-64 text-sm">
            <div className="flex justify-between text-base font-semibold">
              <span>TOTAL:</span>
              <span className="font-mono">Rp {totalAmount.toLocaleString("id-ID")}</span>
            </div>
          </div>
        </div>

        {/* Footer / signature */}
        <div className="mt-12 grid grid-cols-2 gap-8 text-sm">
          <div className="text-center">
            <p>Diterima oleh,</p>
            <div className="mt-16 border-t border-border pt-1">
              ({destBranch?.name ?? "Cabang"})
            </div>
          </div>
          <div className="text-center">
            <p>Dibayar oleh,</p>
            <div className="mt-16 border-t border-border pt-1">
              ({centralBranch?.name ?? "Central Kitchen"})
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
