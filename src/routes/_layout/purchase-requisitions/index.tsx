import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import {
  getPurchaseRequisitions,
  createPurchaseRequisition,
  updatePurchaseRequisition,
  processPurchaseRequisition,
} from "#/lib/server/scm";
import { getIngredients } from "#/lib/server/ingredients";
import { getBranches } from "#/lib/server/branches";
import { getInventory } from "#/lib/server/inventory";
import { generateReorderRecommendations } from "#/lib/server/reorder";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Plus, Package, RefreshCw, Truck } from "lucide-react";

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
  const [selectedPrBranchId, setSelectedPrBranchId] = useState(user?.branchId ?? "");
  const [processPr, setProcessPr] = useState<PRRow | null>(null);
  const [rejectPr, setRejectPr] = useState<PRRow | null>(null);
  const [createSJPrompt, setCreateSJPrompt] = useState(false);

  const isBranchAdmin = user?.role === "branch_admin";
  const isApprover =
    user?.role === "super_admin" || user?.role === "admin_pusat" || user?.role === "area_manager";

  const { data: branchInventoryResult } = useQuery({
    queryKey: ["inventory", selectedPrBranchId],
    queryFn: function () {
      return getInventory({ data: { branchId: selectedPrBranchId } });
    },
    enabled: !!selectedPrBranchId,
  });
  const branchInventory = branchInventoryResult?.data ?? [];

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

  const processMutation = useMutation({
    mutationFn: processPurchaseRequisition,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      setProcessPr(null);
      setCreateSJPrompt(false);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: updatePurchaseRequisition,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      setRejectPr(null);
    },
  });

  const reorderMutation = useMutation({
    mutationFn: generateReorderRecommendations,
    onSuccess: (results) => {
      if (results) {
        const mapped = results.map((r: { ingredientId: string; roq: number }) => ({
          ingredientId: r.ingredientId,
          quantity: r.roq,
        }));
        setPrItems(mapped);
        setModalOpen(true);
      }
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

  const handleProcessClick = (pr: PRRow) => {
    setProcessPr(pr);
    setCreateSJPrompt(true);
  };

  const handleRejectClick = (pr: PRRow) => {
    setRejectPr(pr);
  };

  const confirmProcess = (alsoCreateSJ: boolean) => {
    if (!processPr) return;
    void processMutation.mutateAsync({
      data: { id: processPr.id, alsoCreateSJ },
    });
  };

  const confirmReject = (reason: string) => {
    if (!rejectPr) return;
    void rejectMutation.mutateAsync({
      data: { id: rejectPr.id, status: "Rejected", rejectionReason: reason },
    });
  };

  const columns: Column<PRRow>[] = [
    { key: "code", header: "Kode PR", width: "w-28", sortable: true },
    { key: "branchName", header: "Cabang", sortable: true },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (r) => <Badge variant={statusColors[r.status] ?? "default"}>{r.status}</Badge>,
    },
    {
      key: "createdAt",
      header: "Dibuat",
      sortable: true,
      render: (r) => new Date(r.createdAt).toLocaleDateString("id-ID"),
    },
    {
      key: "id",
      header: "Aksi",
      width: "w-40",
      render: (r) => {
        const canProcess = isApprover && ["Pending", "Approved"].includes(r.status);
        const canReject = isApprover && ["Pending", "Approved"].includes(r.status);
        const canEdit = isBranchAdmin && r.status === "Draft";

        return (
          <div className="flex items-center justify-end gap-1">
            {canProcess && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleProcessClick(r);
                }}
                className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-[10px] font-medium whitespace-nowrap"
              >
                Proses
              </button>
            )}
            {canReject && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRejectClick(r);
                }}
                className="h-7 px-2 rounded-md bg-red-600 text-white text-[10px] font-medium whitespace-nowrap"
              >
                Tolak
              </button>
            )}
            {canEdit && (
              <Link
                to="/purchase-requisitions/$prId"
                params={{ prId: r.id }}
                className="inline-flex h-7 px-2 items-center rounded-md border text-[10px] whitespace-nowrap"
              >
                Edit
              </Link>
            )}
            <Link
              to="/purchase-requisitions/$prId"
              params={{ prId: r.id }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
            >
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        );
      },
    },
  ];
  usePageTitle("Permintaan Pembelian", "Permintaan order barang dari cabang ke pusat");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div className="flex items-center justify-between">
        {isBranchAdmin && (
          <PageHeader action={{ label: "Buat PR", onClick: () => setModalOpen(true) }} />
        )}
        {!isBranchAdmin && <div />}
        {isBranchAdmin && (
          <button
            onClick={() => {
              if (selectedPrBranchId) {
                void reorderMutation.mutateAsync({ data: { branchId: selectedPrBranchId } });
              }
            }}
            disabled={reorderMutation.isPending || !selectedPrBranchId}
            className="h-9 px-3 rounded-md border text-sm flex items-center gap-2 hover:bg-muted disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={"h-4 w-4 " + (reorderMutation.isPending ? "animate-spin" : "")} />
            {reorderMutation.isPending ? "Menghitung..." : "Smart Reordering"}
          </button>
        )}
      </div>

      <DataTable columns={columns} data={prs} keyExtractor={(r) => r.id} />

      {/* Create PR Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Buat Purchase Requisition"
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                disabled={isBranchAdmin}
                onChange={function (e) {
                  setSelectedPrBranchId(e.target.value);
                }}
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
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                id="pr-ingredient"
                className="h-9 flex-1 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Pilih bahan...</option>
                {ingredients.map(function (i) {
                  var invItem = branchInventory.find(function (inv: any) {
                    return inv.ingredientId === i.id;
                  });
                  var invQty = invItem ? invItem.quantity : 0;
                  return (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.stockUnit}) — Stok: {invQty}
                    </option>
                  );
                })}
              </select>
              <div className="flex gap-2 shrink-0">
                <input
                  id="pr-qty"
                  type="number"
                  min={1}
                  placeholder="Qty"
                  className="h-9 w-20 rounded-md border border-input bg-background px-3 text-sm"
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
                  className="h-9 px-3 rounded-md border text-sm shrink-0"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
            {prItems.length > 0 && (
              <div className="rounded-md border divide-y">
                {prItems.map((item, idx) => {
                  const ing = ingredients.find((i) => i.id === item.ingredientId);
                  const invItem = branchInventory.find(
                    (inv: { ingredientId: string }) => inv.ingredientId === item.ingredientId,
                  );
                  const stockQty = invItem?.quantity ?? 0;
                  return (
                    <div key={idx} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div className="flex-1 min-w-0">
                        <span>
                          {ing?.name} × {item.quantity} {ing?.stockUnit}
                        </span>
                        <span
                          className={
                            "ml-2 text-xs " +
                            (stockQty > 0 ? "text-muted-foreground" : "text-destructive")
                          }
                        >
                          <Package className="inline h-3 w-3 mr-0.5" />
                          Stok: {stockQty}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPrItems(prItems.filter((_, i) => i !== idx))}
                        className="text-muted-foreground hover:text-destructive shrink-0 ml-2"
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

      {/* Process Confirmation Modal */}
      <Modal
        open={!!processPr && createSJPrompt}
        onClose={() => {
          setProcessPr(null);
          setCreateSJPrompt(false);
        }}
        title="Proses Purchase Requisition"
      >
        {processPr && (
          <div className="space-y-4">
            <p className="text-sm">
              Proses PR <strong>{processPr.code}</strong>?
            </p>
            <p className="text-sm text-muted-foreground">
              Tindakan ini akan mengubah status PR menjadi <strong>Processed</strong>.
            </p>
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-sm font-medium">Buat Surat Jalan juga?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => confirmProcess(true)}
                  className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm flex items-center gap-2"
                >
                  <Truck className="h-4 w-4" />
                  Ya, Buat SJ
                </button>
                <button
                  onClick={() => confirmProcess(false)}
                  className="h-9 px-4 rounded-md border text-sm"
                >
                  Tidak, Hanya Proses
                </button>
              </div>
            </div>
            <button
              onClick={() => {
                setProcessPr(null);
                setCreateSJPrompt(false);
              }}
              className="h-9 px-4 rounded-md border text-sm w-full"
            >
              Batal
            </button>
          </div>
        )}
      </Modal>

      {/* Reject Confirmation Modal */}
      <Modal open={!!rejectPr} onClose={() => setRejectPr(null)} title="Tolak Purchase Requisition">
        {rejectPr && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              confirmReject(fd.get("reason") as string);
            }}
            className="space-y-4"
          >
            <p className="text-sm">
              Tolak PR <strong>{rejectPr.code}</strong>?
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Alasan Penolakan</label>
              <textarea
                name="reason"
                required
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Contoh: Stok masih mencukupi, tidak perlu pengadaan..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectPr(null)}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Batal
              </button>
              <button type="submit" className="h-9 px-4 rounded-md bg-red-600 text-white text-sm">
                Tolak PR
              </button>
            </div>
          </form>
        )}
      </Modal>
    </RoleGuard>
  );
}
