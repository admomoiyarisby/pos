import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getYieldConversions, createYieldConversion } from "#/lib/server/yield";
import { getIngredients } from "#/lib/server/ingredients";
import { getBranches } from "#/lib/server/branches";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { ArrowRightLeft, TrendingDown, TrendingUp, Plus, X } from "lucide-react";

interface YieldRow {
  id: string;
  createdAt: Date;
  sourceName: string | null;
  sourceQuantity: number | null;
  targetName: string | null;
  targetQuantity: number;
  yieldPercentage: string | null;
  shrinkageQuantity: number;
  notes: string | null;
  sources?: { ingredientId: string; quantity: number; ingredientName: string | null }[];
}

interface SourceItem {
  ingredientId: string;
  quantity: number;
}

export const Route = createFileRoute("/_layout/yield-tracking")({
  component: YieldTrackingPage,
  loader: async () => {
    const conversions = await getYieldConversions({ data: {} });
    const ingredients = await getIngredients({ data: {} });
    const branches = await getBranches({ data: {} });
    return { conversions, ingredients, branches };
  },
});

function YieldTrackingPage() {
  const { conversions: initial, ingredients, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [result, setResult] = useState<{
    newTargetCost: number;
    yieldPercentage: number;
    shrinkageQuantity: number;
  } | null>(null);
  const [sourceItems, setSourceItems] = useState<SourceItem[]>([
    { ingredientId: "", quantity: 0 },
  ]);

  const { data: rawConversions } = useQuery({
    queryKey: ["yield-conversions"],
    queryFn: () => getYieldConversions({ data: {} }),
    initialData: initial,
  });

  // Sort by Waktu descending (newest first)
  const conversions = [...rawConversions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const createMutation = useMutation({
    mutationFn: createYieldConversion,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["yield-conversions"] });
      void queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setModalOpen(false);
      setResult({
        newTargetCost: data.newTargetCost,
        yieldPercentage: data.yieldPercentage,
        shrinkageQuantity: data.shrinkageQuantity,
      });
      setSourceItems([{ ingredientId: "", quantity: 0 }]);
      setTimeout(() => setResult(null), 5000);
    },
  });

  const addSourceRow = () => {
    setSourceItems((prev) => [...prev, { ingredientId: "", quantity: 0 }]);
  };

  const removeSourceRow = (idx: number) => {
    setSourceItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSourceItem = (idx: number, field: keyof SourceItem, value: string | number) => {
    setSourceItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)),
    );
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    // Build multi-source payload
    const validSources = sourceItems.filter(
      (s) => s.ingredientId && s.quantity > 0,
    );

    void createMutation.mutateAsync({
      data: {
        branchId: fd.get("branchId") as string,
        sources: validSources,
        targetIngredientId: fd.get("targetIngredientId") as string,
        targetQuantity: Number(fd.get("targetQuantity")),
        notes: (fd.get("notes") as string) || undefined,
      },
    });
  };

  const resetForm = () => {
    setSourceItems([{ ingredientId: "", quantity: 0 }]);
  };

  const rmIngredients = ingredients.filter((i) => i.skuType === "RM");
  const sfgFgIngredients = ingredients.filter((i) => i.skuType === "SFG" || i.skuType === "FG");

  const columns: Column<YieldRow>[] = [
    {
      key: "createdAt",
      header: "Waktu",
      width: "w-36",
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
      key: "sourceName",
      header: "Bahan Mentah",
      sortable: true,
      render: (r) => {
        const hasSources = r.sources && r.sources.length > 0;
        return (
          <div>
            {hasSources && r.sources!.length > 1 ? (
              <div className="space-y-0.5">
                {r.sources!.map((s, i) => (
                  <div key={i}>
                    <span className="font-medium">{s.ingredientName}</span>
                    <span className="text-muted-foreground ml-2">
                      {s.quantity.toLocaleString("id-ID")} unit
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <span className="font-medium">{r.sourceName}</span>
                <span className="text-muted-foreground ml-2">
                  {(r.sourceQuantity ?? 0).toLocaleString("id-ID")} unit
                </span>
              </>
            )}
          </div>
        );
      },
    },
    {
      key: "targetName",
      header: "Hasil Produksi",
      sortable: true,
      render: (r) => (
        <div>
          <span className="font-medium">{r.targetName}</span>
          <span className="text-muted-foreground ml-2">
            {r.targetQuantity.toLocaleString("id-ID")} unit
          </span>
        </div>
      ),
    },
    {
      key: "yieldPercentage",
      header: "Yield",
      width: "w-24",
      align: "right",
      sortable: true,
      render: (r) => (
        <Badge
          variant={
            Number(r.yieldPercentage) >= 80
              ? "success"
              : Number(r.yieldPercentage) >= 50
                ? "warning"
                : "destructive"
          }
        >
          {r.yieldPercentage}%
        </Badge>
      ),
    },
    {
      key: "shrinkageQuantity",
      header: "Shrinkage",
      align: "right",
      width: "w-24",
      sortable: true,
      render: (r) => (
        <span className="text-destructive font-medium">
          -{r.shrinkageQuantity.toLocaleString("id-ID")}
        </span>
      ),
    },
  ];
  usePageTitle("Tracking Produksi", "Tracking produksi & yield bahan mentah ke matang");

  return (
    <RoleGuard allowedRoles={["super_admin", "central_kitchen"]}>
      <div className="space-y-6">
        <PageHeader action={{ label: "Input Produksi", onClick: () => setModalOpen(true) }} />

        {result && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            <p className="font-medium">Produksi berhasil dicatat!</p>
            <p>
              HPP hasil baru: Rp {result.newTargetCost.toLocaleString("id-ID")} / unit · Yield:{" "}
              {result.yieldPercentage}% · Shrinkage:{" "}
              {result.shrinkageQuantity.toLocaleString("id-ID")} unit
            </p>
            <p className="text-xs mt-1">
              Semua resep yang menggunakan bahan hasil telah di-update secara otomatis.
            </p>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase">Total Produksi</span>
            </div>
            <p className="text-2xl font-bold mt-2">{conversions.length}</p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground uppercase">Avg Yield</span>
            </div>
            <p className="text-2xl font-bold mt-2">
              {conversions.length > 0
                ? (
                    conversions.reduce((sum, c) => sum + Number(c.yieldPercentage ?? 0), 0) /
                    conversions.length
                  ).toFixed(1)
                : 0}
              %
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-500" />
              <span className="text-xs text-muted-foreground uppercase">Total Shrinkage</span>
            </div>
            <p className="text-2xl font-bold mt-2">
              {conversions.reduce((sum, c) => sum + Math.max(0, c.shrinkageQuantity ?? 0), 0).toLocaleString("id-ID")}
            </p>
          </div>
        </div>

        <DataTable columns={columns} data={conversions} keyExtractor={(r) => r.id} pageSize={15} />

        <Modal
          open={modalOpen}
          onClose={() => {
            setModalOpen(false);
            resetForm();
          }}
          title="Input Produksi (Yield)"
          size="lg"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cabang / Gudang</label>
              <select
                name="branchId"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {branches
                  .filter((b) => b.type === "Central")
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="rounded-md border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Input Bahan Mentah (RM)</h3>
                <button
                  type="button"
                  onClick={addSourceRow}
                  className="h-7 px-2 rounded-md border text-xs flex items-center gap-1 hover:bg-muted"
                >
                  <Plus className="h-3 w-3" />
                  Tambah Bahan
                </button>
              </div>
              {sourceItems.map((item, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="flex-1 space-y-2">
                    {idx === 0 && <label className="text-xs text-muted-foreground">Bahan</label>}
                    <select
                      value={item.ingredientId}
                      onChange={(e) => updateSourceItem(idx, "ingredientId", e.target.value)}
                      required
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Pilih bahan mentah...</option>
                      {rmIngredients.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} (HPP: Rp {i.averageCost.toLocaleString("id-ID")} / {i.stockUnit})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-36 space-y-2">
                    {idx === 0 && <label className="text-xs text-muted-foreground">Jumlah</label>}
                    <input
                      value={item.quantity > 0 ? item.quantity : ""}
                      onChange={(e) =>
                        updateSourceItem(idx, "quantity", Number(e.target.value))
                      }
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      required
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      placeholder="Contoh: 5000"
                    />
                  </div>
                  {sourceItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSourceRow(idx)}
                      className="mt-6 h-9 w-9 rounded-md border flex items-center justify-center text-muted-foreground hover:bg-muted"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center">
              <div className="rounded-full bg-muted p-2">
                <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            <div className="rounded-md border p-4 space-y-4">
              <h3 className="text-sm font-semibold">Output Hasil Produksi</h3>
              <div className="space-y-2">
                <label className="text-sm font-medium">Hasil Matang (SFG/FG)</label>
                <select
                  name="targetIngredientId"
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Pilih hasil produksi...</option>
                  {sfgFgIngredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} (HPP saat ini: Rp {i.averageCost.toLocaleString("id-ID")} /{" "}
                      {i.stockUnit})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Jumlah Hasil ({sfgFgIngredients[0]?.stockUnit ?? "unit"})
                </label>
                <input
                  name="targetQuantity"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="Contoh: 8000"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Catatan Produksi</label>
              <textarea
                name="notes"
                placeholder="Contoh: Pengolahan 10kg ayam mentah..."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none"
              />
            </div>

            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              <p className="font-medium">Perhitungan Otomatis</p>
              <p>
                Sistem akan menghitung ulang HPP hasil berdasarkan: Total Biaya Semua Bahan / Jumlah
                Hasil. Semua resep yang menggunakan bahan hasil akan di-update otomatis.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  resetForm();
                }}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                {createMutation.isPending ? "Memproses..." : "Catat Produksi"}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </RoleGuard>
  );
}
