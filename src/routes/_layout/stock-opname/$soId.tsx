import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import Modal from "#/components/ui/Modal";
import {
  getStockOpnameDetail,
  submitStockOpname,
  approveStockOpname,
} from "#/lib/server/inventory";
import { Badge } from "#/components/ui/badge";

interface SOItem {
  id: string;
  ingredientId: string;
  ingredientName: string | null;
  ingredientCode: string | null;
  systemStock: number;
  physicalStock: number;
  variance: number;
  variancePercentage: string | null;
  investigationNote: string | null;
}

const statusColors: Record<string, "default" | "warning" | "success"> = {
  Submitted: "default",
  Approved: "success",
  "Under Investigation": "warning",
};

export const Route = createFileRoute("/_layout/stock-opname/$soId")({
  component: StockOpnameDetailPage,
  loader: async ({ params }) => {
    const detail = await getStockOpnameDetail({ data: { id: params.soId } });
    return { detail };
  },
});

function StockOpnameDetailPage() {
  const { user } = useAuth();
  const { detail: initial } = Route.useLoaderData();
  const { soId } = Route.useParams();
  const queryClient = useQueryClient();
  const [physicalInputs, setPhysicalInputs] = useState<Record<string, string>>({});
  const [investigationNote, setInvestigationNote] = useState("");
  const [approveModal, setApproveModal] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const { data: detail } = useQuery({
    queryKey: ["stock-opname", soId],
    queryFn: () => getStockOpnameDetail({ data: { id: soId } }),
    initialData: initial,
  });

  const submitMutation = useMutation({
    mutationFn: submitStockOpname,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stock-opname", soId] });
      void queryClient.invalidateQueries({ queryKey: ["stock-opnames"] });
      setSubmitError("");
    },
  });

  const approveMutation = useMutation({
    mutationFn: approveStockOpname,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stock-opname", soId] });
      void queryClient.invalidateQueries({ queryKey: ["stock-opnames"] });
      setApproveModal(false);
    },
  });

  if (!detail) {
    return <div className="text-muted-foreground">Stock opname tidak ditemukan</div>;
  }

  const isBlind = detail.isBlind;
  const canApprove =
    ["super_admin", "area_manager"].includes(user?.role ?? "") && detail.status !== "Approved";
  const canSubmit = detail.status === "Submitted" || detail.status === "Under Investigation";

  const handleInputChange = (itemId: string, value: string) => {
    setPhysicalInputs((prev) => ({ ...prev, [itemId]: value }));
  };

  const handleSubmit = () => {
    // Validate no blanks
    const items = detail.items.map((item: SOItem) => ({
      itemId: item.id,
      physicalStock: Number(physicalInputs[item.id] ?? item.physicalStock),
    }));

    const hasBlank = items.some((i) => isNaN(i.physicalStock));
    if (hasBlank) {
      setSubmitError("Semua item harus diisi. Tidak boleh kosong.");
      return;
    }

    void submitMutation.mutateAsync({ data: { soId, items } });
  };

  const handleApprove = () => {
    void approveMutation.mutateAsync({
      data: { soId, investigationNote },
    });
  };

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
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Opname Stok</h1>
            <p className="text-sm text-muted-foreground">
              Tanggal: {detail.date} · Cabang: {detail.branchId.slice(0, 8)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={statusColors[detail.status] ?? "default"}>
              {detail.status === "Under Investigation" ? "Investigasi" : detail.status}
            </Badge>
            {isBlind && <Badge variant="outline">Blind SO</Badge>}
          </div>
        </div>

        {submitError && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {submitError}
          </div>
        )}

        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">No</th>
                <th className="px-4 py-3 text-left font-medium">Kode</th>
                <th className="px-4 py-3 text-left font-medium">Nama Item</th>
                {!isBlind && <th className="px-4 py-3 text-right font-medium">Stok Sistem</th>}
                <th className="px-4 py-3 text-right font-medium">Stok Fisik</th>
                {!isBlind && <th className="px-4 py-3 text-right font-medium">Selisih</th>}
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item: SOItem, idx: number) => {
                const inputValue =
                  physicalInputs[item.id] ??
                  (item.physicalStock > 0 ? String(item.physicalStock) : "");
                const variance = !isBlind ? Number(inputValue) - item.systemStock : 0;
                const hasVariance = !isBlind && variance !== 0;

                return (
                  <tr key={item.id} className={`border-b ${hasVariance ? "bg-amber-50" : ""}`}>
                    <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>
                    <td className="px-4 py-3 font-mono text-xs">{item.ingredientCode}</td>
                    <td className="px-4 py-3">{item.ingredientName}</td>
                    {!isBlind && (
                      <td className="px-4 py-3 text-right">
                        {item.systemStock.toLocaleString("id-ID")}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        value={inputValue}
                        onChange={(e) => handleInputChange(item.id, e.target.value)}
                        disabled={detail.status === "Approved"}
                        className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm text-right disabled:opacity-50"
                      />
                    </td>
                    {!isBlind && (
                      <td
                        className={`px-4 py-3 text-right font-medium ${variance > 0 ? "text-green-600" : variance < 0 ? "text-red-600" : ""}`}
                      >
                        {variance > 0 ? "+" : ""}
                        {variance.toLocaleString("id-ID")}
                      </td>
                    )}
                  </tr>
                );
              })}
              {detail.items.length === 0 && (
                <tr>
                  <td colSpan={isBlind ? 4 : 6} className="h-24 text-center text-muted-foreground">
                    Tidak ada item
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          {canSubmit && (
            <button
              onClick={handleSubmit}
              disabled={submitMutation.isPending}
              className="h-10 px-6 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {submitMutation.isPending ? "Menyimpan..." : "Kirim Opname"}
            </button>
          )}

          {canApprove && detail.status !== "Approved" && (
            <button
              onClick={() => setApproveModal(true)}
              className="h-10 px-6 rounded-md bg-primary text-primary-foreground text-sm font-medium"
            >
              Setujui & Sesuaikan
            </button>
          )}
        </div>
      </div>

      <Modal open={approveModal} onClose={() => setApproveModal(false)} title="Setujui Opname Stok">
        <div className="space-y-4">
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">Perhatian</p>
            <p>Approval akan menyesuaikan stok sistem ke stok fisik dan membuat jurnal ledger.</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Catatan Investigasi (opsional)</label>
            <textarea
              value={investigationNote}
              onChange={(e) => setInvestigationNote(e.target.value)}
              placeholder="Alasan selisih..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setApproveModal(false)}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              onClick={handleApprove}
              disabled={approveMutation.isPending}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {approveMutation.isPending ? "Memproses..." : "Approve"}
            </button>
          </div>
        </div>
      </Modal>
    </RoleGuard>
  );
}
