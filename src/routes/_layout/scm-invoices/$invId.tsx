import { createFileRoute } from "@tanstack/react-router";
import { badgeVariant } from "#/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import { getSCMInvoice, paySCMInvoice, cancelSCMInvoice } from "#/lib/server/scm";
import { Badge } from "#/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_layout/scm-invoices/$invId")({
  component: SCMInvoiceDetailPage,
  loader: async ({ params }) => {
    const invoice = await getSCMInvoice({ data: { id: params.invId } });
    return { invoice };
  },
});

function SCMInvoiceDetailPage() {
  const { user } = useAuth();
  const { invoice: initial } = Route.useLoaderData();
  const { invId } = Route.useParams();
  const queryClient = useQueryClient();

  const { data: invoice } = useQuery({
    queryKey: ["scm-invoice", invId],
    queryFn: () => getSCMInvoice({ data: { id: invId } }),
    initialData: initial,
  });

  const payMutation = useMutation({
    mutationFn: paySCMInvoice,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scm-invoice", invId] });
      void queryClient.invalidateQueries({ queryKey: ["scm-invoices"] });
    },

    // Without this the failure is silent: call sites discard the rejected
    // promise with `void ...mutateAsync()`, so a refused action looked
    // exactly like an unresponsive control.
    onError: (error: Error) => {
      toast.error("Gagal menandai invoice lunas", { description: error.message });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelSCMInvoice,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scm-invoice", invId] });
      void queryClient.invalidateQueries({ queryKey: ["scm-invoices"] });
    },

    // Without this the failure is silent: call sites discard the rejected
    // promise with `void ...mutateAsync()`, so a refused action looked
    // exactly like an unresponsive control.
    onError: (error: Error) => {
      toast.error("Gagal membatalkan invoice", { description: error.message });
    },
  });

  if (!invoice) return <div className="text-muted-foreground">Invoice tidak ditemukan</div>;

  const canAct =
    invoice.status === "Unpaid" && ["super_admin", "admin_pusat"].includes(user?.role ?? "");

  // Per-unit prices are the HPP snapshot — hidden for branch_admin. Line
  // totals and the grand total are transaction amounts and stay visible.
  const showUnitPrice = user?.role !== "branch_admin";

  const statusColors = {
    Unpaid: "warning",
    Paid: "success",
    Cancelled: "destructive",
  } satisfies Record<string, "default" | "warning" | "success" | "destructive">;

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">{invoice.code}</h1>
            <p className="text-sm text-muted-foreground">Invoice SCM</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={badgeVariant(statusColors[invoice.status])}>{invoice.status}</Badge>
            {canAct && (
              <>
                <button
                  onClick={() => void payMutation.mutateAsync({ data: { id: invoice.id } })}
                  disabled={payMutation.isPending}
                  className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                >
                  {payMutation.isPending ? "Memproses..." : "Bayar"}
                </button>
                <button
                  onClick={() => {
                    if (confirm("Yakin ingin membatalkan invoice ini?")) {
                      void cancelMutation.mutateAsync({ data: { id: invoice.id } });
                    }
                  }}
                  disabled={cancelMutation.isPending}
                  className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
                >
                  {cancelMutation.isPending ? "Memproses..." : "Batal"}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

        {/* Mobile cards — own everything below lg: at md (768px) the fixed 16rem
            sidebar leaves only ~460px of content, less than the table's
            min-w-[480px], so the table would scroll sideways. */}
        <div className="lg:hidden space-y-2.5 -mx-4 px-4">
          {invoice.items.map(
            (item: {
              id: string;
              ingredientName: string | null;
              quantity: number;
              unitPrice: number;
              totalPrice: number;
            }) => (
              <div key={item.id} className="rounded-xl border bg-card p-3.5 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 text-sm font-medium">{item.ingredientName}</div>
                  <div className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    Qty {item.quantity}
                  </div>
                </div>
                <div className="mt-2.5 flex items-end justify-between gap-3 border-t pt-2.5">
                  <div className="min-w-0 text-xs text-muted-foreground">
                    {showUnitPrice ? (
                      <>
                        Harga satuan{" "}
                        <span className="font-medium text-foreground tabular-nums">
                          Rp {item.unitPrice.toLocaleString("id-ID")}
                        </span>
                      </>
                    ) : (
                      "Total"
                    )}
                  </div>
                  <div className="shrink-0 text-sm font-semibold tabular-nums">
                    Rp {item.totalPrice.toLocaleString("id-ID")}
                  </div>
                </div>
              </div>
            ),
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden lg:block rounded-md border overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Bahan</th>
                <th className="px-4 py-3 text-right font-medium">Qty</th>
                {showUnitPrice && (
                  <th className="px-4 py-3 text-right font-medium">Harga Satuan</th>
                )}
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
                    {showUnitPrice && (
                      <td className="px-4 py-3 text-right">
                        Rp {item.unitPrice.toLocaleString("id-ID")}
                      </td>
                    )}
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
