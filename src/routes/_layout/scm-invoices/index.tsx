import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import {
  getSCMInvoices,
  generateSCMInvoice,
  paySCMInvoice,
  cancelSCMInvoice,
} from "#/lib/server/scm";
import { getDeliveryNotes } from "#/lib/server/scm";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

interface InvRow {
  id: string;
  code: string;
  totalAmount: number;
  status: "Unpaid" | "Paid" | "Cancelled";
  createdAt: Date;
}

const statusColors: Record<string, "default" | "warning" | "success" | "destructive"> = {
  Unpaid: "warning",
  Paid: "success",
  Cancelled: "destructive",
};

export const Route = createFileRoute("/_layout/scm-invoices/")({
  component: SCMInvoicePage,
  loader: async () => {
    const invoices = await getSCMInvoices({ data: {} });
    const dns = await getDeliveryNotes({ data: {} });
    return { invoices, dns };
  },
});

function SCMInvoicePage() {
  const { invoices: initial, dns } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [generateModal, setGenerateModal] = useState(false);
  const [selectedDn, setSelectedDn] = useState("");

  const { data: invoices } = useQuery({
    queryKey: ["scm-invoices"],
    queryFn: () => getSCMInvoices({ data: {} }),
    initialData: initial,
  });

  const generateMutation = useMutation({
    mutationFn: generateSCMInvoice,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scm-invoices"] });
      setGenerateModal(false);
      setSelectedDn("");
    },
  });

  const payMutation = useMutation({
    mutationFn: paySCMInvoice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scm-invoices"] }),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelSCMInvoice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scm-invoices"] }),
  });

  const receivedDns = dns.filter((d) => d.status === "Received");

  const columns: Column<InvRow>[] = [
    { key: "code", header: "Kode Invoice", width: "w-32", sortable: true },
    {
      key: "totalAmount",
      header: "Total",
      align: "right",
      sortable: true,
      render: (r) => `Rp ${r.totalAmount.toLocaleString("id-ID")}`,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (r) => (
        <Badge
          variant={
            (statusColors[r.status] ?? "default") as
              | "default"
              | "success"
              | "warning"
              | "destructive"
          }
        >
          {r.status}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Dibuat",
      sortable: true,
      render: (r) => new Date(r.createdAt).toLocaleDateString("id-ID"),
    },
    {
      key: "id",
      header: "",
      width: "w-32",
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          {r.status === "Unpaid" && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void payMutation.mutateAsync({ data: { id: r.id } });
                }}
                className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-[10px] font-medium"
              >
                Bayar
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("Yakin ingin membatalkan invoice ini?")) {
                    void cancelMutation.mutateAsync({ data: { id: r.id } });
                  }
                }}
                className="h-7 px-2 rounded-md bg-red-600 text-white text-[10px] font-medium"
              >
                Batal
              </button>
            </>
          )}
          <Link
            to="/scm-invoices/$invId"
            params={{ invId: r.id }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
          >
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ),
    },
  ];
  usePageTitle("Invoice SCM", "Invoice berdasarkan penerimaan barang");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <PageHeader action={{ label: "Buat Invoice", onClick: () => setGenerateModal(true) }} />

      <DataTable columns={columns} data={invoices} keyExtractor={(r) => r.id} />

      <div
        className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 ${generateModal ? "" : "hidden"}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setGenerateModal(false);
        }}
      >
        <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
          <h2 className="text-lg font-semibold mb-4">Generate Invoice dari SJ</h2>
          <div className="space-y-4">
            <select
              value={selectedDn}
              onChange={(e) => setSelectedDn(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Pilih Surat Jalan (Received)...</option>
              {receivedDns.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setGenerateModal(false)}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  if (selectedDn) void generateMutation.mutateAsync({ data: { dnId: selectedDn } });
                }}
                disabled={!selectedDn || generateMutation.isPending}
                className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
              >
                Generate
              </button>
            </div>
          </div>
        </div>
      </div>
    </RoleGuard>
  );
}
