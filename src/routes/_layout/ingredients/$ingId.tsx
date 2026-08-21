import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useState } from "react";
import { useGoBackToList } from "#/hooks/useGoBackToList";
import { formText } from "#/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { lookupLabel } from "#/lib/label-lookup";
import { getIngredient, updateIngredient } from "#/lib/server/ingredients";
import { getBranches } from "#/lib/server/branches";
import { toast } from "sonner";
import MoneyInput from "#/components/MoneyInput";
import { Separator } from "#/components/ui/separator";
import { Switch } from "#/components/ui/switch";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_layout/ingredients/$ingId")({
  component: IngredientDetailPage,
  loader: async ({ params }) => {
    const [ingredient, branches] = await Promise.all([
      getIngredient({ data: { id: params.ingId } }),
      getBranches({ data: {} }),
    ]);
    return { ingredient, branches };
  },
});

function IngredientDetailPage() {
  const { ingredient: initial, branches } = Route.useLoaderData();
  const { ingId } = Route.useParams();
  const goBack = useGoBackToList("/ingredients");
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>(initial?.branchIds ?? []);
  const [isBranchVisible, setIsBranchVisible] = useState<boolean>(
    initial?.isBranchVisible ?? false,
  );

  const { data: ingredient } = useQuery({
    queryKey: ["ingredient", ingId],
    queryFn: () => getIngredient({ data: { id: ingId } }),
    initialData: initial,
  });

  const updateMutation = useMutation({
    mutationFn: updateIngredient,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ingredient", ingId] });
      void queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      setIsEditing(false);
      toast.success("Bahan baku berhasil diperbarui");
    },
    onError: (error: Error) => {
      toast.error("Gagal memperbarui bahan baku", { description: error.message });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      id: ingId,
      code: formText(fd, "code"),
      name: formText(fd, "name"),
      category: z.enum(["Fresh", "Dry", "Packaging"]).parse(formText(fd, "category")),
      skuType: z.enum(["RM", "SFG", "FG"]).parse(formText(fd, "skuType")),
      purchaseUnit: formText(fd, "purchaseUnit"),
      stockUnit: formText(fd, "stockUnit"),
      conversionFactor: Number(fd.get("conversionFactor")),
      averageCost: Number(fd.get("averageCost")),
      rop: Number(fd.get("rop")),
      moq: Number(fd.get("moq")),
      isBranchVisible,
      // Central-only (toggle off) ⇒ no branch links; branch-visible ⇒ honor selection.
      branchIds: isBranchVisible ? selectedBranchIds : [],
    };
    void updateMutation.mutateAsync({ data });
  };

  if (!ingredient) {
    return <div className="text-muted-foreground">Bahan tidak ditemukan</div>;
  }

  const skuLabels = {
    RM: "Raw Material",
    SFG: "Semi-Finished",
    FG: "Finished Goods",
  } satisfies Record<string, string>;

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "central_kitchen"]}>
      <div className="space-y-6">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali ke Daftar Bahan
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{ingredient.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">Kode: {ingredient.code}</p>
          </div>
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="h-10 md:h-9 px-4 rounded-md border text-sm font-medium"
          >
            {isEditing ? "Batal" : "Edit"}
          </button>
        </div>

        <Separator />

        {isEditing ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Kode</label>
                <input
                  name="code"
                  defaultValue={ingredient.code}
                  required
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Nama</label>
                <input
                  name="name"
                  defaultValue={ingredient.name}
                  required
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Tipe SKU</label>
                <select
                  name="skuType"
                  defaultValue={ingredient.skuType}
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="RM">Raw Material</option>
                  <option value="SFG">Semi-Finished Good</option>
                  <option value="FG">Finished Good</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Kategori</label>
                <select
                  name="category"
                  defaultValue={ingredient.category}
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="Fresh">Fresh</option>
                  <option value="Dry">Dry</option>
                  <option value="Packaging">Packaging</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Satuan Beli</label>
                <input
                  name="purchaseUnit"
                  defaultValue={ingredient.purchaseUnit}
                  required
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Satuan Stok</label>
                <input
                  name="stockUnit"
                  defaultValue={ingredient.stockUnit}
                  required
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Konversi</label>
                <input
                  name="conversionFactor"
                  type="number"
                  min={1}
                  defaultValue={ingredient.conversionFactor}
                  required
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">HPP (Rp)</label>
                <MoneyInput
                  name="averageCost"
                  defaultValue={ingredient.averageCost}
                  required
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">ROP</label>
                <input
                  name="rop"
                  type="number"
                  min={0}
                  defaultValue={ingredient.rop}
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">MOQ</label>
                <input
                  name="moq"
                  type="number"
                  min={1}
                  defaultValue={ingredient.moq}
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">Tampil di Cabang</p>
                <p className="text-xs text-muted-foreground">
                  Aktif = masuk katalog cabang (terlihat branch_admin). Nonaktif = hanya Gudang
                  Pusat &amp; manajemen.
                </p>
              </div>
              <Switch
                checked={isBranchVisible}
                onCheckedChange={(checked) => {
                  setIsBranchVisible(checked);
                  // Auto-sync the branch option: turning ON defaults to "all branches".
                  if (checked) setSelectedBranchIds([]);
                }}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Ketersediaan Cabang</label>
              <p className="text-xs text-muted-foreground">
                Pilih cabang yang boleh melihat & memilih bahan ini. Kosong = semua cabang.
              </p>
              {!isBranchVisible && (
                <p className="text-xs text-amber-600">
                  Nonaktif: bahan hanya untuk Gudang Pusat &amp; manajemen, pilihan cabang
                  diabaikan.
                </p>
              )}
              <div className="rounded-lg border p-4 space-y-3">
                <label
                  className={
                    "flex items-center gap-3 " +
                    (isBranchVisible ? "cursor-pointer" : "cursor-not-allowed opacity-60")
                  }
                >
                  <input
                    type="checkbox"
                    disabled={!isBranchVisible}
                    checked={selectedBranchIds.length === 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedBranchIds([]);
                      } else {
                        setSelectedBranchIds(branches.map((b) => b.id));
                      }
                    }}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <div>
                    <span className="text-sm font-medium">Semua cabang</span>
                    <p className="text-xs text-muted-foreground">Bahan tersedia di semua cabang</p>
                  </div>
                </label>
              </div>
              {selectedBranchIds.length > 0 && isBranchVisible && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Pilih cabang:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {branches.map((b) => (
                      <label
                        key={b.id}
                        className="flex items-center gap-2 rounded-md border p-3 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          disabled={!isBranchVisible}
                          checked={selectedBranchIds.includes(b.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedBranchIds([...selectedBranchIds, b.id]);
                            } else {
                              setSelectedBranchIds(selectedBranchIds.filter((id) => id !== b.id));
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        {b.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="submit"
                className="h-10 md:h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
              >
                Simpan
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground uppercase">Tipe SKU</p>
                <p className="font-medium mt-1">
                  {lookupLabel(skuLabels, ingredient.skuType) ?? "-"}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground uppercase">Kategori</p>
                <p className="font-medium mt-1">{ingredient.category}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground uppercase">Satuan Beli</p>
                <p className="font-medium mt-1">{ingredient.purchaseUnit}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground uppercase">Satuan Stok</p>
                <p className="font-medium mt-1">{ingredient.stockUnit}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground uppercase">Konversi</p>
                <p className="font-medium mt-1">
                  1 {ingredient.purchaseUnit} = {ingredient.conversionFactor} {ingredient.stockUnit}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground uppercase">HPP</p>
                <p className="font-medium mt-1">
                  Rp {ingredient.averageCost.toLocaleString("id-ID")}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground uppercase">ROP</p>
                <p className="font-medium mt-1">{ingredient.rop}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground uppercase">MOQ</p>
                <p className="font-medium mt-1">{ingredient.moq}</p>
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground uppercase">Visibilitas</p>
              <p className="font-medium mt-1">
                {ingredient.isBranchVisible ? "Tampil di Cabang" : "Gudang Pusat & Manajemen"}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground uppercase">Ketersediaan Cabang</p>
              {ingredient.branchIds.length === 0 ? (
                <p className="font-medium mt-1">Semua cabang</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {ingredient.branchIds.map((id) => {
                    const branch = branches.find((b) => b.id === id);
                    if (!branch) return null;
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium"
                      >
                        {branch.name}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </RoleGuard>
  );
}
