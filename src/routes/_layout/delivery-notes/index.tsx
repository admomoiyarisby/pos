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
  getDeliveryNotes,
  createDeliveryNote,
  shipDeliveryNote,
  reviewDeliveryNote,
  generateSCMInvoice,
} from "#/lib/server/scm";
import { getBranches } from "#/lib/server/branches";
import { getIngredients } from "#/lib/server/ingredients";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Truck, CheckCircle, DollarSign, AlertCircle } from "lucide-react";

interface DNRow {
  id: string;
  code: string;
  fromBranchId: string;
  toBranchId: string;
  status: "Draft" | "Picking" | "In Transit" | "Partial Received" | "Received" | "Cancelled";
  driverName: string | null;
  reviewedByAdminPusat: boolean;
  createdAt: Date;
}

const statusColors: Record<
  string,
  "default" | "warning" | "success" | "destructive" | "secondary"
> = {
  Draft: "secondary",
  Picking: "default",
  "In Transit": "warning",
  "Partial Received": "warning",
  Received: "success",
  Cancelled: "destructive",
};

export const Route = createFileRoute("/_layout/delivery-notes/")({
  component: DNPage,
  loader: async () => {
    const dns = await getDeliveryNotes({ data: {} });
    const branches = await getBranches({ data: {} });
    const ingredients = await getIngredients({ data: {} });
    return { dns, branches, ingredients };
  },
});

function DNPage() {
  const { user } = useAuth();
  const { dns: initial, branches, ingredients } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [dnItems, setDnItems] = useState<
    { ingredientId: string; quantity: number; readyQuantity: number }[]
  >([]);
  const [reviewSJ, setReviewSJ] = useState<DNRow | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: dns } = useQuery({
    queryKey: ["delivery-notes"],
    queryFn: () => getDeliveryNotes({ data: {} }),
    initialData: initial,
  });

  const { status: statusFilter } = Route.useSearch() as { status?: string };
  const filteredDns = statusFilter ? dns.filter((d) => d.status === statusFilter) : dns;

  const createMutation = useMutation({
    mutationFn: createDeliveryNote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      setModalOpen(false);
      setDnItems([]);
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal membuat SJ");
    },
  });

  const shipMutation = useMutation({
    mutationFn: shipDeliveryNote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal mengirim SJ");
    },
  });

  const reviewMutation = useMutation({
    mutationFn: reviewDeliveryNote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      setReviewSJ(null);
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal mereview SJ");
    },
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: generateSCMInvoice,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      void queryClient.invalidateQueries({ queryKey: ["scm-invoices"] });
      setInvoiceError(null);
    },
    onError: (err) => {
      setInvoiceError(err instanceof Error ? err.message : "Gagal membuat invoice");
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      code: fd.get("code") as string,
      fromBranchId: fd.get("fromBranchId") as string,
      toBranchId: fd.get("toBranchId") as string,
      driverName: fd.get("driverName") as string,
      vehicleNumber: fd.get("vehicleNumber") as string,
      items: dnItems,
    };
    void createMutation.mutateAsync({ data });
  };

  const columns: Column<DNRow>[] = [
    { key: "code", header: "Kode SJ", width: "w-28", sortable: true },
    {
      key: "fromBranchId",
      header: "Dari",
      sortable: true,
      render: (r) =>
        branches.find((b) => b.id === r.fromBranchId)?.name ?? r.fromBranchId.slice(0, 8),
    },
    {
      key: "toBranchId",
      header: "Ke",
      sortable: true,
      render: (r) => branches.find((b) => b.id === r.toBranchId)?.name ?? r.toBranchId.slice(0, 8),
    },
    { key: "driverName", header: "Driver", sortable: true, render: (r) => r.driverName ?? "-" },
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
      width: "w-48",
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          {["super_admin", "admin_pusat"].includes(user?.role ?? "") && r.status === "Picking" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void shipMutation.mutateAsync({ data: { dnId: r.id } });
              }}
              className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-[10px] font-medium"
            >
              <Truck className="h-3 w-3 inline mr-1" />
              Kirim
            </button>
          )}
          {["super_admin", "admin_pusat"].includes(user?.role ?? "") && r.status === "Received" && (
            <>
              {!r.reviewedByAdminPusat ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setReviewSJ(r);
                  }}
                  className="h-7 px-2 rounded-md bg-amber-500 text-white text-[10px] font-medium flex items-center gap-1"
                >
                  <CheckCircle className="h-3 w-3" />
                  Review SJ
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setInvoiceError(null);
                    void generateInvoiceMutation.mutateAsync({ data: { dnId: r.id } });
                  }}
                  className="h-7 px-2 rounded-md bg-success text-success-foreground text-[10px] font-medium flex items-center gap-1"
                >
                  <DollarSign className="h-3 w-3" />
                  Buat Invoice
                </button>
              )}
            </>
          )}
          <Link
            to="/delivery-notes/$dnId"
            params={{ dnId: r.id }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
          >
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ),
    },
  ];
  usePageTitle("Surat Jalan", "Dokumen pengiriman barang");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <PageHeader
        action={
          ["super_admin", "admin_pusat"].includes(user?.role ?? "")
            ? { label: "Buat SJ", onClick: () => setModalOpen(true) }
            : undefined
        }
      />

      {invoiceError && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{invoiceError}</span>
          <button
            onClick={() => setInvoiceError(null)}
            className="text-destructive/70 hover:text-destructive"
          >
            ✕
          </button>
        </div>
      )}

      <DataTable columns={columns} data={filteredDns} keyExtractor={(r) => r.id} />

      {/* Review SJ Modal */}
      <Modal
        open={!!reviewSJ}
        onClose={() => setReviewSJ(null)}
        title={`Review Surat Jalan: ${reviewSJ?.code ?? ""}`}
        size="lg"
      >
        {reviewSJ && (
          <div className="space-y-4">
            <div className="bg-info/10 border border-info/20 p-3 rounded-lg">
              <p className="text-sm font-medium text-info-foreground">Review Data Surat Jalan</p>
              <p className="text-xs text-info-foreground/80 mt-1">
                Pastikan semua data pengiriman dan penerimaan sudah benar. Setelah di-review, Anda
                dapat membuat Invoice Internal.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground uppercase">Rute</p>
                <p className="font-medium">
                  {branches.find((b) => b.id === reviewSJ.fromBranchId)?.name ??
                    reviewSJ.fromBranchId}{" "}
                  →{" "}
                  {branches.find((b) => b.id === reviewSJ.toBranchId)?.name ?? reviewSJ.toBranchId}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground uppercase">Status</p>
                <Badge variant="success">{reviewSJ.status}</Badge>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Setelah dikonfirmasi, status review akan tercatat dan tombol "Buat Invoice" akan
              muncul.
            </p>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setReviewSJ(null)}
                className="flex-1 h-9 rounded-md border text-sm"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  if (reviewSJ) {
                    void reviewMutation.mutateAsync({ data: { dnId: reviewSJ.id } });
                  }
                }}
                disabled={reviewMutation.isPending}
                className="flex-1 h-9 rounded-md bg-success text-success-foreground text-sm font-medium disabled:opacity-50"
              >
                {reviewMutation.isPending ? "Memproses..." : "Konfirmasi Review"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSubmitError(null);
        }}
        title="Buat Surat Jalan"
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
              <label className="text-sm font-medium">Kode SJ</label>
              <input
                name="code"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Driver</label>
              <input
                name="driverName"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <label className="text-sm font-medium">No. Kendaraan</label>
            <input
              name="vehicleNumber"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Item (Diorder | Ready)</label>
            <div className="flex gap-2">
              <select
                id="dn-ing"
                className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Pilih bahan...</option>
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <input
                id="dn-qty"
                type="number"
                min={1}
                placeholder="Order"
                className="h-9 w-20 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                id="dn-ready"
                type="number"
                min={0}
                placeholder="Ready"
                className="h-9 w-20 rounded-md border border-input bg-background px-3 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  const ing = (document.getElementById("dn-ing") as HTMLSelectElement).value;
                  const qty = (document.getElementById("dn-qty") as HTMLInputElement).value;
                  const ready = (document.getElementById("dn-ready") as HTMLInputElement).value;
                  if (ing && qty) {
                    setDnItems([
                      ...dnItems,
                      {
                        ingredientId: ing,
                        quantity: Number(qty),
                        readyQuantity: Number(ready || qty),
                      },
                    ]);
                  }
                }}
                className="h-9 px-3 rounded-md border text-sm"
              >
                +
              </button>
            </div>
            {dnItems.length > 0 && (
              <div className="rounded-md border divide-y text-sm">
                {dnItems.map((item, idx) => {
                  const ing = ingredients.find((i) => i.id === item.ingredientId);
                  return (
                    <div key={idx} className="flex items-center justify-between px-3 py-2">
                      <span>
                        {ing?.name} — Order: {item.quantity} | Ready: {item.readyQuantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDnItems(dnItems.filter((_, i) => i !== idx))}
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
              disabled={dnItems.length === 0}
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
