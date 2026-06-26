import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getPeriods, openPeriod, closePeriod } from "#/lib/server/finance";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Lock, Unlock, AlertTriangle } from "lucide-react";

interface PeriodRow {
  id: string;
  periodName: string;
  status: "Open" | "Closed";
  openedAt: Date;
  closedAt: Date | null;
  openedBy: string;
  closedBy: string | null;
}

export const Route = createFileRoute("/_layout/period-control/")({
  component: PeriodControlPage,
  loader: async () => {
    const periods = await getPeriods();
    return { periods };
  },
});

function PeriodControlPage() {
  const { periods: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [openModal, setOpenModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodRow | null>(null);
  const [periodName, setPeriodName] = useState("");
  const [closeResult, setCloseResult] = useState<{
    success: boolean;
    checks?: { name: string; passed: boolean; message: string }[];
    message?: string;
  } | null>(null);

  const { data: periods } = useQuery({
    queryKey: ["periods"],
    queryFn: () => getPeriods(),
    initialData: initial,
  });

  const openMutation = useMutation({
    mutationFn: openPeriod,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["periods"] });
      setOpenModal(false);
      setPeriodName("");
    },
  });

  const closeMutation = useMutation({
    mutationFn: closePeriod,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["periods"] });
      setCloseResult(data);
      if (data.success) setCloseModal(false);
    },
  });

  const openPeriodCount = periods.filter((p) => p.status === "Open").length;

  const columns: Column<PeriodRow>[] = [
    { key: "periodName", header: "Nama Periode", sortable: true },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (r) => (
        <Badge variant={r.status === "Open" ? "success" : "secondary"}>
          {r.status === "Open" ? "Terbuka" : "Tertutup"}
        </Badge>
      ),
    },
    {
      key: "openedAt",
      header: "Dibuka",
      sortable: true,
      render: (r) => new Date(r.openedAt).toLocaleDateString("id-ID"),
    },
    {
      key: "closedAt",
      header: "Ditutup",
      sortable: true,
      render: (r) => (r.closedAt ? new Date(r.closedAt).toLocaleDateString("id-ID") : "-"),
    },
    {
      key: "id",
      header: "",
      width: "w-12",
      render: (r) => (
        <Link
          to="/period-control/$periodId"
          params={{ periodId: r.id }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
        >
          <ArrowRight className="h-4 w-4" />
        </Link>
      ),
    },
  ];
  usePageTitle("Kontrol Periode", "Kendali pembukaan & penutupan buku fiskal");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <PageHeader
          action={
            openPeriodCount === 0
              ? { label: "Buka Periode", onClick: () => setOpenModal(true) }
              : undefined
          }
        />

        {openPeriodCount > 0 && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 flex items-center gap-2 text-sm text-amber-800">
            <Unlock className="h-4 w-4" />
            Ada periode yang sedang terbuka. Tutup periode aktif sebelum membuka periode baru.
          </div>
        )}

        <DataTable columns={columns} data={periods} keyExtractor={(r) => r.id} />

        {/* Open Period Modal */}
        <Modal open={openModal} onClose={() => setOpenModal(false)} title="Buka Periode Baru">
          <div className="space-y-4">
            <div className="rounded-md bg-info/10 border border-info/20 p-3 text-sm text-info-foreground space-y-1">
              <p className="font-medium">Pre-Open Report</p>
              <p>Sistem akan menyalin saldo stok saat ini sebagai opening balance.</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Nama Periode</label>
              <input
                value={periodName}
                onChange={(e) => setPeriodName(e.target.value)}
                placeholder="Contoh: Mei 2026"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <button
              onClick={() => {
                if (periodName) void openMutation.mutateAsync({ data: { periodName } });
              }}
              disabled={!periodName || openMutation.isPending}
              className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {openMutation.isPending ? "Memproses..." : "Buka Periode"}
            </button>
          </div>
        </Modal>

        {/* Close Period Modal */}
        {selectedPeriod && (
          <Modal
            open={closeModal}
            onClose={() => {
              setCloseModal(false);
              setCloseResult(null);
            }}
            title={`Tutup Periode: ${selectedPeriod.periodName}`}
            size="lg"
          >
            <div className="space-y-4">
              <div className="rounded-md bg-warning/10 border border-warning/20 p-3 text-sm text-warning-foreground">
                <p className="font-medium">Exhaustive Verification</p>
                <p>Verifikasi wajib harus lolos sebelum periode dapat ditutup.</p>
              </div>

              {closeResult && (
                <div
                  className={`rounded-md p-3 text-sm ${closeResult.success ? "bg-success/10 border border-success/20 text-success-foreground" : "bg-destructive/10 border border-destructive/20 text-destructive"}`}
                >
                  <p className="font-medium">{closeResult.message}</p>
                </div>
              )}

              {closeResult?.checks && (
                <div className="space-y-2">
                  {closeResult.checks
                    .filter((check) => !check.passed)
                    .map((check) => {
                      // Build link for failed checks when possible
                      const name = check.name.toLowerCase();
                      let linkTo: {
                        to: string;
                        label: string;
                        search?: Record<string, string>;
                      } | null = null;
                      if (name.includes("stock opname"))
                        linkTo = {
                          to: "/stock-opname",
                          label: "Buka Stock Opname",
                          search: { status: "Under Investigation" },
                        };
                      else if (name.includes("cancel request"))
                        linkTo = {
                          to: "/cancel-requests",
                          label: "Buka Cancel Request",
                          search: { status: "Pending" },
                        };
                      else if (
                        name.includes("invoice scm") ||
                        (name.includes("invoice") && name.includes("scm"))
                      )
                        linkTo = {
                          to: "/scm-invoices",
                          label: "Buka Invoice SCM",
                          search: { status: "Unpaid" },
                        };
                      else if (name.includes("delivery note") || name.includes("surat jalan"))
                        linkTo = {
                          to: "/delivery-notes",
                          label: "Buka Surat Jalan",
                          search: { status: "In Transit" },
                        };
                      else if (name.includes("purchase requisition") || name.includes("pr"))
                        linkTo = {
                          to: "/purchase-requisitions",
                          label: "Buka Purchase Requisition",
                          search: { status: "Pending" },
                        };
                      else if (name.includes("pending order") || name.includes("pesanan"))
                        linkTo = {
                          to: "/order-history",
                          label: "Buka Riwayat Pesanan",
                          search: { status: "Cancel Requested" },
                        };
                      else if (name.includes("mutasi stok"))
                        linkTo = {
                          to: "/stock-transfers",
                          label: "Buka Mutasi Stok",
                          search: { status: "In Transit" },
                        };
                      else if (name.includes("waste investigation") || name.includes("waste"))
                        linkTo = {
                          to: "/waste",
                          label: "Buka Waste",
                          search: { noInvestigation: "true" },
                        };
                      else if (
                        name.includes("inventory") ||
                        (name.includes("stok") && !name.includes("mutasi"))
                      )
                        linkTo = {
                          to: "/inventory",
                          label: "Buka Inventory",
                          search: { negative: "true" },
                        };
                      return (
                        <div
                          key={check.name}
                          className="flex items-center gap-3 rounded-md border p-3 bg-destructive/10 border-destructive/20"
                        >
                          <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{check.name}</p>
                            <p className="text-xs text-muted-foreground">{check.message}</p>
                          </div>
                          {linkTo && (
                            <Link
                              to={linkTo.to}
                              search={linkTo.search as any}
                              className="shrink-0 h-7 px-2 rounded-md bg-primary/10 text-primary text-[10px] font-medium flex items-center gap-1 hover:bg-primary/20"
                            >
                              {linkTo.label} <ArrowRight className="h-3 w-3" />
                            </Link>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setCloseModal(false);
                    setCloseResult(null);
                  }}
                  className="h-9 px-4 rounded-md border text-sm"
                >
                  Batal
                </button>
                <button
                  onClick={() =>
                    void closeMutation.mutateAsync({ data: { periodId: selectedPeriod.id } })
                  }
                  disabled={closeMutation.isPending}
                  className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                >
                  {closeMutation.isPending ? "Memproses..." : "Finalize & Lock"}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Close button for open periods */}
        {periods
          .filter((p) => p.status === "Open")
          .map((p) => (
            <div key={p.id} className="rounded-lg border p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">{p.periodName}</p>
                <p className="text-sm text-muted-foreground">
                  Dibuka {new Date(p.openedAt).toLocaleDateString("id-ID")}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedPeriod(p);
                  setCloseResult(null);
                  setCloseModal(true);
                }}
                className="h-9 px-4 rounded-md border text-sm font-medium hover:bg-muted flex items-center gap-2"
              >
                <Lock className="h-4 w-4" />
                Tutup Periode
              </button>
            </div>
          ))}
      </div>
    </RoleGuard>
  );
}
