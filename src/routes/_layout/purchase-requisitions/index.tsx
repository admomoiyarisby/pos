import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import {
  getPurchaseRequisitions,
  createPurchaseRequisition,
  updatePurchaseRequisition,
} from "#/lib/server/scm";
import { getIngredients } from "#/lib/server/ingredients";
import { getBranches } from "#/lib/server/branches";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Plus } from "lucide-react";

interface PRRow {
  id: string;
  code: string;
  branchName: string | null;
  status: "Draft" | "Pending" | "Approved" | "Processed" | "Rejected" | "Fulfilled";
  createdAt: Date;
}

const statusColors: Record<
  string,
  "default" | "warning" | "success" | "destructive" | "secondary"
> = {
  Draft: "secondary",
  Pending: "warning",
  Approved: "default",
  Processed: "success",
  Rejected: "destructive",
  Fulfilled: "success",
};

export const Route = createFileRoute("/_layout/purchase-requisitions/")({
  component: PRPage,
  loader: async () => {
    const prs = await getPurchaseRequisitions({ data: {} });
    const ingredients = await getIngredients({ data: {} });
    const branches = await getBranches({ data: {} });
    return { prs, ingredients, branches };
  },
});

function PRPage() {
  const { user } = useAuth();
  const { prs: initial, ingredients, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [prItems, setPrItems] = useState<{ ingredientId: string; quantity: number }[]>([]);

  const { data: prs } = useQuery({
    queryKey: ["purchase-requisitions"],
    queryFn: () => getPurchaseRequisitions({ data: {} }),
    initialData: initial,
  });

  const createMutation = useMutation({
    mutationFn: createPurchaseRequisition,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      setModalOpen(false);
      setPrItems([]);
    },
  });

  const updateMutation = useMutation({
    mutationFn: updatePurchaseRequisition,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-requisitions"] });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const code = fd.get("code") as string;
    const branchId = fd.get("branchId") as string;
    if (prItems.length === 0) return;
    void createMutation.mutateAsync({ data: { code, branchId, items: prItems } });
  };

  const handleProcess = (id: string) => {
    void updateMutation.mutateAsync({ data: { id, status: "Processed" } });
  };

  const columns: Column<PRRow>[] = [
    { key: "code", header: "Kode PR", width: "w-28" },
    { key: "branchName", header: "Cabang" },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge variant={statusColors[r.status] ?? "default"}>{r.status}</Badge>,
    },
    {
      key: "createdAt",
      header: "Dibuat",
      render: (r) => new Date(r.createdAt).toLocaleDateString("id-ID"),
    },
    {
      key: "id",
      header: "",
      width: "w-24",
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          {["super_admin", "admin_pusat"].includes(user?.role ?? "") && r.status === "Pending" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleProcess(r.id);
              }}
              className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-[10px] font-medium"
            >
              Proses
            </button>
          )}
          <Link
            to="/purchase-requisitions/$prId"
            params={{ prId: r.id }}
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
        title="Purchase Requisition"
        description="Permintaan order barang dari cabang ke pusat"
        action={{ label: "Buat PR", onClick: () => setModalOpen(true) }}
      />

      <DataTable columns={columns} data={prs} keyExtractor={(r) => r.id} />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Buat Purchase Requisition"
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Kode PR</label>
              <input
                name="code"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Cabang</label>
              <select
                name="branchId"
                defaultValue={user?.branchId ?? ""}
                disabled={!!user?.branchId}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
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
            <label className="text-sm font-medium">Item</label>
            <div className="flex gap-2">
              <select
                id="pr-ingredient"
                className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Pilih bahan...</option>
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.stockUnit})
                  </option>
                ))}
              </select>
              <input
                id="pr-qty"
                type="number"
                min={1}
                placeholder="Qty"
                className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  const ingEl = document.getElementById("pr-ingredient") as HTMLSelectElement;
                  const qtyEl = document.getElementById("pr-qty") as HTMLInputElement;
                  if (ingEl.value && qtyEl.value) {
                    setPrItems([
                      ...prItems,
                      { ingredientId: ingEl.value, quantity: Number(qtyEl.value) },
                    ]);
                    ingEl.value = "";
                    qtyEl.value = "";
                  }
                }}
                className="h-9 px-3 rounded-md border text-sm"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {prItems.length > 0 && (
              <div className="rounded-md border divide-y">
                {prItems.map((item, idx) => {
                  const ing = ingredients.find((i) => i.id === item.ingredientId);
                  return (
                    <div key={idx} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>
                        {ing?.name} × {item.quantity} {ing?.stockUnit}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPrItems(prItems.filter((_, i) => i !== idx))}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
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
              disabled={prItems.length === 0}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              Simpan
            </button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
