import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getStockTransfers, createStockTransfer, approveStockTransfer } from "#/lib/server/scm";
import { getBranches } from "#/lib/server/branches";
import { getIngredients } from "#/lib/server/ingredients";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";

interface TRRow {
  id: string;
  code: string;
  fromBranchId: string;
  toBranchId: string;
  ingredientId: string;
  quantity: number;
  status: string;
  createdAt: Date;
}

const statusColors: Record<
  string,
  "default" | "warning" | "success" | "destructive" | "secondary"
> = {
  Pending: "secondary",
  "Pending Approval": "warning",
  Approved: "default",
  Rejected: "destructive",
  "In Transit": "warning",
  Completed: "success",
  Cancelled: "destructive",
};

export const Route = createFileRoute("/_layout/stock-transfers/")({
  component: TransferPage,
  loader: async () => {
    const transfers = await getStockTransfers({ data: {} });
    const branches = await getBranches({ data: {} });
    const ingredients = await getIngredients({ data: {} });
    return { transfers, branches, ingredients };
  },
});

function TransferPage() {
  const { user } = useAuth();
  const { transfers: initial, branches, ingredients } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  const { data: transfers } = useQuery({
    queryKey: ["stock-transfers"],
    queryFn: () => getStockTransfers({ data: {} }),
    initialData: initial,
  });

  const createMutation = useMutation({
    mutationFn: createStockTransfer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      setModalOpen(false);
    },
  });

  const approveMutation = useMutation({
    mutationFn: approveStockTransfer,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stock-transfers"] }),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void createMutation.mutateAsync({
      data: {
        code: fd.get("code") as string,
        fromBranchId: fd.get("fromBranchId") as string,
        toBranchId: fd.get("toBranchId") as string,
        ingredientId: fd.get("ingredientId") as string,
        quantity: Number(fd.get("quantity")),
      },
    });
  };

  const columns: Column<TRRow>[] = [
    { key: "code", header: "Kode", width: "w-28" },
    {
      key: "fromBranchId",
      header: "Dari",
      render: (r) =>
        branches.find((b) => b.id === r.fromBranchId)?.name ?? r.fromBranchId.slice(0, 8),
    },
    {
      key: "toBranchId",
      header: "Ke",
      render: (r) => branches.find((b) => b.id === r.toBranchId)?.name ?? r.toBranchId.slice(0, 8),
    },
    {
      key: "ingredientId",
      header: "Bahan",
      render: (r) =>
        ingredients.find((i) => i.id === r.ingredientId)?.name ?? r.ingredientId.slice(0, 8),
    },
    {
      key: "quantity",
      header: "Qty",
      align: "right",
      width: "w-20",
      render: (r) => r.quantity.toLocaleString("id-ID"),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge
          variant={
            (statusColors[r.status] ?? "default") as
              | "default"
              | "success"
              | "warning"
              | "destructive"
              | "secondary"
          }
        >
          {r.status}
        </Badge>
      ),
    },
    {
      key: "id",
      header: "",
      width: "w-32",
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          {r.status === "Pending Approval" &&
            ["super_admin", "area_manager"].includes(user?.role ?? "") && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void approveMutation.mutateAsync({ data: { transferId: r.id } });
                }}
                className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-[10px] font-medium"
              >
                <Check className="h-3 w-3 inline mr-1" />
                Approve
              </button>
            )}
          <Link
            to="/stock-transfers/$trId"
            params={{ trId: r.id }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
          >
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ),
    },
  ];

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <PageHeader
        title="Mutasi Stok"
        description="Transfer antar cabang dengan approval"
        action={{ label: "Ajukan Mutasi", onClick: () => setModalOpen(true) }}
      />

      <DataTable columns={columns} data={transfers} keyExtractor={(r) => r.id} />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Ajukan Mutasi Stok"
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Kode</label>
              <input
                name="code"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Bahan</label>
              <select
                name="ingredientId"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Dari Cabang</label>
              <select
                name="fromBranchId"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Ke Cabang</label>
              <select
                name="toBranchId"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Jumlah</label>
            <input
              name="quantity"
              type="number"
              min={1}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
            >
              Ajukan
            </button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
