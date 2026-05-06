import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { Badge } from "#/components/ui/badge";

export const Route = createFileRoute("/_layout/cancel-requests")({
  component: CancelRequestsPage,
});

function CancelRequestsPage() {
  const [requests] = useState([
    {
      id: "1",
      orderId: "ORD-001",
      reason: "Salah Input",
      requestedBy: "Hans",
      status: "Pending",
      createdAt: "2026-05-02 10:30",
    },
  ]);
  usePageTitle("Permintaan Pembatalan", "Review dan approve permintaan cancel order dari kasir");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager"]}>
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Waktu</th>
              <th className="px-4 py-3 text-left font-medium">Order ID</th>
              <th className="px-4 py-3 text-left font-medium">Alasan</th>
              <th className="px-4 py-3 text-left font-medium">Diajukan Oleh</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="px-4 py-3 text-muted-foreground">{r.createdAt}</td>
                <td className="px-4 py-3 font-medium">{r.orderId}</td>
                <td className="px-4 py-3">{r.reason}</td>
                <td className="px-4 py-3">{r.requestedBy}</td>
                <td className="px-4 py-3">
                  <Badge
                    variant={
                      r.status === "Pending"
                        ? "warning"
                        : r.status === "Approved"
                          ? "success"
                          : "secondary"
                    }
                  >
                    {r.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {r.status === "Pending" && (
                    <div className="flex justify-end gap-2">
                      <button className="h-8 px-3 rounded-md border text-xs hover:bg-muted">
                        Reject
                      </button>
                      <button className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs">
                        Approve
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={6} className="h-24 text-center text-muted-foreground">
                  Tidak ada permintaan pembatalan
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </RoleGuard>
  );
}
