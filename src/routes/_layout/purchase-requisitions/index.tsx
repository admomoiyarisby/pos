import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { AlertCircle } from "lucide-react";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "#/components/ui/combobox";
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
  const [selectedPrBranchId, setSelectedPrBranchId] = useState(
    user?.branchId ?? (branches.length > 0 ? branches[0].id : ""),
  );
  const [processPr, setProcessPr] = useState<PRRow | null>(null);
  const [rejectPr, setRejectPr] = useState<PRRow | null>(null);
  const [createSJPrompt, setCreateSJPrompt] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isBranchAdmin = user?.role === "branch_admin";
  const isApprover =
    user?.role === "super_admin" || user?.role === "admin_pusat" || user?.role === "area_manager";
  const canCreatePR =
    user?.role === "super_admin" || user?.role === "admin_pusat" || user?.role === "branch_admin";

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

  const { status: statusFilter } = Route.useSearch() as { status?: string };
  const filteredPrs = statusFilter
    ? prs.filter((p) => p.status === statusFilter)
    : prs;

  const createMutation = useMutation({
    mutationFn: createPurchaseRequisition,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      setModalOpen(false);
      setPrItems([]);
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal membuat PR");
    },
  });

  const processMutation = useMutation({
    mutationFn: processPurchaseRequisition,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      setProcessPr(null);
      setCreateSJPrompt(false);
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal memproses PR");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: updatePurchaseRequisition,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      setRejectPr(null);
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal menolak PR");
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

  const ingredientOptions = useMemo(() => {
    return ingredients.map((i) => {
      const invItem = branchInventory.find((inv) => inv.ingredientId === i.id);
      const invQty = invItem ? invItem.quantity : 0;
      const isLow = i.rop > 0 && invQty <= i.rop;
      return {
        id: i.id,
        value: i.id,
        name: i.name,
        label: i.name,
        code: i.code,
        stockUnit: i.stockUnit,
        stockQty: invQty,
        moq: i.moq,
        rop: i.rop,
        isLow,
      };
    });
  }, [ingredients, branchInventory]);

  const [selectedIngredient, setSelectedIngredient] = useState<
    (typeof ingredientOptions)[number] | null
  >(null);
  const [ingredientInputValue, setIngredientInputValue] = useState("");

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
                className="h-7 px-2 rounded-md bg-destructive text-destructive-foreground text-[10px] font-medium whitespace-nowrap"
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
        {canCreatePR && (
          <PageHeader action={{ label: "Buat PR", onClick: () => setModalOpen(true) }} />
        )}
        {!canCreatePR && <div />}
        {canCreatePR && (
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

      <DataTable columns={columns} data={filteredPrs} keyExtractor={(r) => r.id} />

      {/* Create PR Modal */}
      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSubmitError(null);
        }}
        title="Buat Purchase Requisition"
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {submitError && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}
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
                defaultValue={user?.branchId ?? (branches.length > 0 ? branches[0].id : "")}
                disabled={isBranchAdmin}
                required
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
              <Combobox
                value={selectedIngredient}
                onValueChange={(val) => {
                  setSelectedIngredient(val);
                  setIngredientInputValue(val ? val.label : "");
                }}
                inputValue={ingredientInputValue}
                onInputValueChange={setIngredientInputValue}
                items={ingredientOptions}
                itemToStringValue={(item) => item.id}
                itemToStringLabel={(item) => item.label}
                isItemEqualToValue={(a, b) => a?.id === b?.id}
              >
                <ComboboxInput
                  showTrigger
                  showClear={!!selectedIngredient}
                  placeholder="Pilih bahan..."
                  className="flex-1 min-w-0"
                />
                <ComboboxContent>
                  <ComboboxList>
                    {(item: (typeof ingredientOptions)[number]) => (
                      <ComboboxItem key={item.id} value={item}>
                        <div className="flex items-center justify-between w-full">
                          <span>
                            {item.name}{" "}
                            <span className="text-muted-foreground">({item.stockUnit})</span>
                          </span>
                          <span
                            className={
                              "text-xs " +
                              (item.isLow
                                ? "text-destructive font-medium"
                                : "text-muted-foreground")
                            }
                          >
                            Stok: {item.stockQty}
                            {item.moq > 1 && ` (MOQ: ${item.moq})`}
                            {item.isLow && " ⚠️ LOW"}
                          </span>
                        </div>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                  <ComboboxEmpty>Tidak ada bahan yang cocok</ComboboxEmpty>
                </ComboboxContent>
              </Combobox>
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
                    const qtyEl = document.getElementById("pr-qty") as HTMLInputElement;
                    if (selectedIngredient && qtyEl.value) {
                      setPrItems([
                        ...prItems,
                        { ingredientId: selectedIngredient.id, quantity: Number(qtyEl.value) },
                      ]);
                      setSelectedIngredient(null);
                      setIngredientInputValue("");
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
                  const isLow = (ing?.rop ?? 0) > 0 && stockQty <= (ing?.rop ?? 0);
                  return (
                    <div key={idx} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div className="flex-1 min-w-0">
                        <span>
                          {ing?.name} × {item.quantity} {ing?.stockUnit}
                        </span>
                        <span
                          className={
                            "ml-2 text-xs " +
                            (isLow ? "text-destructive font-medium" : "text-muted-foreground")
                          }
                        >
                          <Package className="inline h-3 w-3 mr-0.5" />
                          Stok: {stockQty}
                          {isLow && " (di bawah ROP)"}
                          {ing && ing.moq > 1 && ` — MOQ: ${ing.moq}`}
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
          setSubmitError(null);
        }}
        title="Proses Purchase Requisition"
      >
        {processPr && (
          <div className="space-y-4">
            {submitError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}
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
            {submitError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}
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
              <button type="submit" className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm">
                Tolak PR
              </button>
            </div>
          </form>
        )}
      </Modal>
    </RoleGuard>
  );
}
