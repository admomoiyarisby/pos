import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  getProcurement,
  getProcurementItems,
} from "#/lib/server/scm-queries";
import { getBranches } from "#/lib/server/branches";
import { Button } from "#/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";

export const Route = createFileRoute(
  "/_layout/scm-procurements/$procurementId/print-sj",
)({
  component: PrintSuratJalan,
});

function PrintSuratJalan() {
  const { procurementId } = Route.useParams();

  const procQ = useQuery({
    queryKey: ["scm-procurement", procurementId],
    queryFn: () => getProcurement({ data: { id: procurementId } }),
  });
  const itemsQ = useQuery({
    queryKey: ["scm-procurement-items", procurementId],
    queryFn: () => getProcurementItems({ data: { procurementId } }),
    enabled: !!procQ.data,
  });
  const branchesQ = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches({ data: {} }),
  });

  if (procQ.isLoading || itemsQ.isLoading || branchesQ.isLoading) {
    return <div className="p-6">Loading...</div>;
  }
  if (!procQ.data) return <div className="p-6">Procurement tidak ditemukan</div>;

  const proc = procQ.data;
  const items = itemsQ.data ?? [];
  const branches = (branchesQ.data ?? []) as Array<{ id: string; code: string; name: string }>;
  const destBranch = branches.find((b) => b.id === proc.branchId);
  const centralBranch = branches.find((b: Record<string, unknown>) => b.type === "Central");

  const shipItems = items.filter(
    (it: Record<string, unknown>) => (it.pickedQuantity as number) > 0,
  );

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 print:p-4">
      {/* On-screen controls (hidden when printing) */}
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
            <h1 className="text-2xl font-bold">SURAT JALAN</h1>
            <p className="text-sm text-muted-foreground">Omoiyari POS</p>
          </div>
          <div className="text-right text-sm">
            <p><strong>No:</strong> {proc.code as string}</p>
            <p><strong>Tanggal:</strong> {new Date(proc.shippedAt as unknown as string | Date ?? proc.createdAt as unknown as string | Date).toLocaleDateString("id-ID")}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Dari:</p>
            <p className="font-medium">{centralBranch?.name ?? "Central Kitchen"}</p>
            <p className="text-muted-foreground">{centralBranch?.code ?? ""}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Kepada:</p>
            <p className="font-medium">{destBranch?.name ?? "-"}</p>
            <p className="text-muted-foreground">{destBranch?.code ?? ""}</p>
          </div>
        </div>

        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="py-2 text-left">No</th>
              <th className="py-2 text-left">Bahan</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-left">Satuan</th>
              <th className="py-2 text-left">Keterangan</th>
            </tr>
          </thead>
          <tbody>
            {shipItems.map((it: Record<string, unknown>, idx: number) => (
              <tr key={it.id as string} className="border-b border-border">
                <td className="py-2">{idx + 1}</td>
                <td className="py-2">{it.ingredientName as string}</td>
                <td className="py-2 text-right font-mono">{it.pickedQuantity as number}</td>
                <td className="py-2">{""}</td>
                <td className="py-2"></td>
              </tr>
            ))}
            {shipItems.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-center text-muted-foreground">
                  Tidak ada item yang dikirim.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
          <div className="text-center">
            <p>Pengirim,</p>
            <div className="mt-16 border-t border-border pt-1">
              ({centralBranch?.name ?? "Central Kitchen"})
            </div>
          </div>
          <div className="text-center">
            <p>Penerima,</p>
            <div className="mt-16 border-t border-border pt-1">
              ({destBranch?.name ?? "Cabang"})
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
