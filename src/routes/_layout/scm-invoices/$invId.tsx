import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { getSCMInvoice } from "#/lib/server/scm";
import { Badge } from "#/components/ui/badge";

export const Route = createFileRoute("/_layout/scm-invoices/$invId")({
  component: SCMInvoiceDetailPage,
  loader: async ({ params }) => {
    const invoice = await getSCMInvoice({ data: { id: params.invId } });
    return { invoice };
  },
});

function SCMInvoiceDetailPage() {
  const { invoice: initial } = Route.useLoaderData();
  const { invId } = Route.useParams();

  const { data: invoice } = useQuery({
    queryKey: ["scm-invoice", invId],
    queryFn: () => getSCMInvoice({ data: { id: invId } }),
    initialData: initial,
  });

  if (!invoice) return <div className="text-muted-foreground">Invoice tidak ditemukan</div>;

  const statusColors: Record<string, "default" | "warning" | "success" | "destructive"> = {
    Unpaid: "warning",
    Paid: "success",
    Cancelled: "destructive",
  };

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{invoice.code}</h1>
            <p className="text-sm text-muted-foreground">Invoice SCM</p>
          </div>
          <Badge
            variant={
              (statusColors[invoice.status] ?? "default") as
                | "default"
                | "success"
                | "warning"
                | "destructive"
            }
          >
            {invoice.status}
          </Badge>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Total</p>
            <p className="font-medium mt-1">Rp {invoice.totalAmount.toLocaleString("id-ID")}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Dari</p>
            <p className="font-medium mt-1">{invoice.fromBranchId.slice(0, 8)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Ke</p>
            <p className="font-medium mt-1">{invoice.toBranchId.slice(0, 8)}</p>
          </div>
        </div>

        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Bahan</th>
                <th className="px-4 py-3 text-right font-medium">Qty</th>
                <th className="px-4 py-3 text-right font-medium">Harga Satuan</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map(
                (item: {
                  id: string;
                  ingredientName: string | null;
                  quantity: number;
                  unitPrice: number;
                  totalPrice: number;
                }) => (
                  <tr key={item.id} className="border-b">
                    <td className="px-4 py-3">{item.ingredientName}</td>
                    <td className="px-4 py-3 text-right">{item.quantity}</td>
                    <td className="px-4 py-3 text-right">
                      Rp {item.unitPrice.toLocaleString("id-ID")}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      Rp {item.totalPrice.toLocaleString("id-ID")}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </RoleGuard>
  );
}
