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
import { ArrowRight, Lock, Unlock, AlertTriangle, CheckCircle2 } from "lucide-react";

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
            <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800 space-y-1">
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
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                <p className="font-medium">Exhaustive Verification</p>
                <p>Verifikasi wajib harus lolos sebelum periode dapat ditutup.</p>
              </div>

              {closeResult && (
                <div
                  className={`rounded-md p-3 text-sm ${closeResult.success ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-800"}`}
                >
                  <p className="font-medium">{closeResult.message}</p>
                </div>
              )}

              {closeResult?.checks && (
                <div className="space-y-2">
                  {closeResult.checks.map((check) => (
                    <div
                      key={check.name}
                      className={`flex items-center gap-3 rounded-md border p-3 ${check.passed ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}
                    >
                      {check.passed ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                      )}
                      <div>
                        <p className="font-medium text-sm">{check.name}</p>
                        <p className="text-xs text-muted-foreground">{check.message}</p>
                      </div>
                    </div>
                  ))}
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
