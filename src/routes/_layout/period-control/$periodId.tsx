import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { getPeriodDetail } from "#/lib/server/finance";
import { Badge } from "#/components/ui/badge";

export const Route = createFileRoute("/_layout/period-control/$periodId")({
  component: PeriodDetailPage,
  loader: async ({ params }) => {
    const period = await getPeriodDetail({ data: { id: params.periodId } });
    return { period };
  },
});

function PeriodDetailPage() {
  const { period: initial } = Route.useLoaderData();
  const { periodId } = Route.useParams();

  const { data: period } = useQuery({
    queryKey: ["period", periodId],
    queryFn: () => getPeriodDetail({ data: { id: periodId } }),
    initialData: initial,
  });

  if (!period) return <div className="text-muted-foreground">Periode tidak ditemukan</div>;

  const openingBalances = period.balances.filter((b) => b.balanceType === "opening");
  const closingBalances = period.balances.filter((b) => b.balanceType === "closing");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{period.periodName}</h1>
            <p className="text-sm text-muted-foreground">
              Dibuka: {new Date(period.openedAt).toLocaleString("id-ID")}
            </p>
          </div>
          <Badge variant={period.status === "Open" ? "success" : "secondary"}>
            {period.status === "Open" ? "Terbuka" : "Tertutup"}
          </Badge>
        </div>

        {period.closedAt && (
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Ditutup</p>
            <p className="font-medium">{new Date(period.closedAt).toLocaleString("id-ID")}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-6">
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold mb-3">
              Opening Balance ({openingBalances.length} item)
            </h3>
            <div className="rounded-md border max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Branch</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {openingBalances.slice(0, 20).map((b, i) => (
                    <tr key={i} className="border-b">
                      <td className="px-3 py-2 text-xs font-mono">{b.branchId.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-right">{b.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold mb-3">
              Closing Balance ({closingBalances.length} item)
            </h3>
            {closingBalances.length > 0 ? (
              <div className="rounded-md border max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Branch</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closingBalances.slice(0, 20).map((b, i) => (
                      <tr key={i} className="border-b">
                        <td className="px-3 py-2 text-xs font-mono">{b.branchId.slice(0, 8)}</td>
                        <td className="px-3 py-2 text-right">{b.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Periode masih terbuka</p>
            )}
          </div>
        </div>
      </div>
    </RoleGuard>
  );
}
