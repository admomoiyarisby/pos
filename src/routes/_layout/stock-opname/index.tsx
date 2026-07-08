import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getStockOpnames, triggerStockOpname, getAssignedBranchIds } from "#/lib/server/inventory";
import { getBranches } from "#/lib/server/branches";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { ArrowRight } from "lucide-react";

interface SORow {
  id: string;
  branchId: string;
  date: string;
  status: "Submitted" | "Approved" | "Under Investigation";
  branchName: string | null;
  createdAt: Date;
}

const statusColors: Record<string, "default" | "warning" | "success"> = {
  Submitted: "default",
  Approved: "success",
  "Under Investigation": "warning",
};

const columns: Column<SORow>[] = [
  { key: "date", header: "Tanggal", sortable: true },
  { key: "branchName", header: "Cabang", sortable: true },
  {
    key: "status",
    header: "Status",
    sortable: true,
    render: (r) => (
      <Badge variant={statusColors[r.status] ?? "default"}>
        {r.status === "Under Investigation" ? "Investigasi" : r.status}
      </Badge>
    ),
  },
  {
    key: "createdAt",
    header: "Dibuat",
    sortable: true,
    render: (r) =>
      new Date(r.createdAt).toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
  },
  {
    key: "id",
    header: "",
    width: "w-12",
    render: (r) => (
      <Link
        to="/stock-opname/$soId"
        params={{ soId: r.id }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
      >
        <ArrowRight className="h-4 w-4" />
      </Link>
    ),
  },
];

export const Route = createFileRoute("/_layout/stock-opname/")({
  component: StockOpnamePage,
  loader: async () => {
    const opnames = await getStockOpnames({ data: {} });
    const branches = await getBranches({ data: {} });
    return { opnames, branches };
  },
});

function StockOpnamePage() {
  const { user } = useAuth();
  const { opnames: initial, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const [triggerModal, setTriggerModal] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);

  const { data: assignedBranchIds } = useQuery({
    queryKey: ["assigned-branch-ids"],
    queryFn: getAssignedBranchIds,
    enabled: user?.role === "area_manager",
  });

  // Compute visible branches for the trigger modal based on role
  const visibleBranches = branches.filter((b) => {
    if (user?.role === "admin_pusat") return b.type === "Central";
    if (user?.role === "area_manager") return assignedBranchIds?.includes(b.id);
    return true; // super_admin sees all
  });

  useEffect(() => {
    if (visibleBranches.length === 1 && !selectedBranch) {
      setSelectedBranch(visibleBranches[0].id);
    }
  }, [visibleBranches, selectedBranch]);

  const canTrigger = ["super_admin", "admin_pusat", "area_manager", "branch_admin"].includes(user?.role ?? "");

  const { data: opnames } = useQuery({
    queryKey: ["stock-opnames"],
    queryFn: () => getStockOpnames({ data: {} }),
    initialData: initial,
  });

  const triggerMutation = useMutation({
    mutationFn: triggerStockOpname,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["stock-opnames"] });
      void navigate({ to: "/stock-opname/$soId", params: { soId: result.id } });
    },
  });

  const handleTrigger = () => {
    if (!selectedBranch || !selectedDate) return;
    void triggerMutation.mutateAsync({
      data: { branchId: selectedBranch, date: selectedDate },
    });
  };
  const { status: statusFilter } = Route.useSearch() as { status?: string };
  const filteredOpnames = statusFilter ? opnames.filter((o) => o.status === statusFilter) : opnames;
  usePageTitle("Opname Stok", "Verifikasi fisik stok per cabang");

  return (
    <RoleGuard
      allowedRoles={[
        "super_admin",
        "admin_pusat",
        "area_manager",
        "branch_admin",
        "central_kitchen",
      ]}
    >
      <PageHeader
        action={
          canTrigger ? { label: "Trigger SO", onClick: () => setTriggerModal(true) } : undefined
        }
      />

      <DataTable columns={columns} data={filteredOpnames} keyExtractor={(r) => r.id} />

      {filteredOpnames.length === 0 && (
        <div className="rounded-md border p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Tidak ada Stock Opname yang aktif untuk cabang Anda.
          </p>
          <p className="text-muted-foreground text-xs mt-1">
            Hubungi Area Manager untuk memulai proses Stock Opname.
          </p>
        </div>
      )}

      <Modal
        open={triggerModal}
        onClose={() => setTriggerModal(false)}
        title="Trigger Stock Opname"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Cabang</label>
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Pilih cabang...</option>
              {visibleBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Tanggal</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <button
            onClick={handleTrigger}
            disabled={!selectedBranch || triggerMutation.isPending}
            className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {triggerMutation.isPending ? "Memproses..." : "Trigger SO"}
          </button>
        </div>
      </Modal>
    </RoleGuard>
  );
}
