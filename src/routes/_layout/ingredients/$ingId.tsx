import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useState } from "react";
import { useGoBackToList } from "#/hooks/useGoBackToList";
import { formText } from "#/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { lookupLabel } from "#/lib/label-lookup";
import { getIngredient, updateIngredient } from "#/lib/server/ingredients";
import type { CostChangeConfirmation } from "#/lib/server/ingredients";
import { costPerPurchaseUnit } from "#/lib/cost-guard";
import { formatRp } from "#/lib/utils";
import { getBranches } from "#/lib/server/branches";
import { toast } from "sonner";
import MoneyInput from "#/components/MoneyInput";
import Modal from "#/components/ui/Modal";
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
  // Raw integer the cost field currently holds, so the per-purchase-unit hint
  // can update while typing (the number that would have caught Rp 369/ml).
  const [costDraft, setCostDraft] = useState<number | null>(initial?.averageCost ?? null);
  // A large cost edit comes back as a preview instead of a save: nothing is
  // written until the user accepts it here.
  const [costConfirmation, setCostConfirmation] = useState<CostChangeConfirmation | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<
    Parameters<typeof updateIngredient>[0]["data"] | null
  >(null);
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
    onSuccess: (result) => {
      // The cost guard answered instead of saving: show what it would reprice and
      // wait for a second submit with `confirmCostChange`.
      if ("needsConfirmation" in result) {
        setCostConfirmation(result);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["ingredient", ingId] });
      void queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      setIsEditing(false);
      setPendingUpdate(null);
      // Re-seed the draft so reopening the form shows what was actually saved.
      setCostDraft(result.averageCost);
      toast.success("Bahan baku berhasil diperbarui");
    },
    onError: (error: Error) => {
      toast.error("Gagal memperbarui bahan baku", { description: error.message });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const aliasRaw = formText(fd, "alias");
    const data = {
      id: ingId,
      code: formText(fd, "code"),
      name: formText(fd, "name"),
      alias: aliasRaw || null,
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
    setPendingUpdate(data);
    void updateMutation.mutateAsync({ data });
  };

  const confirmCostChange = () => {
    if (!pendingUpdate) return;
    const data = { ...pendingUpdate, confirmCostChange: true };
    setCostConfirmation(null);
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
            <h1 className="text-2xl font-bold tracking-tight">
              {ingredient.alias ?? ingredient.name}
            </h1>
            {ingredient.alias && ingredient.alias !== ingredient.name && (
              <p className="text-sm text-muted-foreground mt-0.5">Nama asli: {ingredient.name}</p>
            )}
            <p className="text-sm text-muted-foreground mt-1">Kode: {ingredient.code}</p>
          </div>
          <button
            onClick={() => {
              // Reopening the form starts from the saved cost, not from whatever
              // was typed (and abandoned) last time.
              if (!isEditing) setCostDraft(ingredient.averageCost);
              setIsEditing(!isEditing);
            }}
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
            <div className="space-y-2">
              <label className="text-sm font-medium">Alias (opsional)</label>
              <input
                name="alias"
                defaultValue={ingredient.alias ?? ""}
                placeholder="Mask nama asli, contoh: Chicken HOT Level 1"
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <p className="text-xs text-muted-foreground">Kosong = tampilkan nama asli</p>
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
                {/* The unit belongs in the label: this number is rupiah per stock
                    unit, and a bottle price typed here is how a whole day of HPP
                    went wrong. */}
                <label className="text-sm font-medium">HPP per {ingredient.stockUnit}</label>
                <MoneyInput
                  name="averageCost"
                  value={costDraft}
                  onChange={setCostDraft}
                  required
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {ingredient.conversionFactor > 1
                    ? `= ${formatRp(costPerPurchaseUnit(costDraft ?? 0, ingredient.conversionFactor))} per ${ingredient.purchaseUnit} (1 ${ingredient.purchaseUnit} = ${ingredient.conversionFactor} ${ingredient.stockUnit})`
                    : `Rupiah per ${ingredient.stockUnit} — sama dengan per ${ingredient.purchaseUnit}`}
                </p>
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
                {!isBranchVisible && (
                  <p className="text-xs text-warning mt-1">
                    Bahan ini tidak akan muncul di stock opname cabang mana pun. Cabang yang
                    memegangnya tidak akan pernah menghitungnya.
                  </p>
                )}
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

      {/* Cost-change confirmation: nothing is saved until this is accepted. */}
      <Modal
        open={!!costConfirmation}
        onClose={() => setCostConfirmation(null)}
        title="HPP berubah sangat besar"
        size="md"
      >
        {costConfirmation && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {costConfirmation.verdict === "extreme"
                ? "Perubahan ini hampir pasti salah satuan — harga kemasan tertulis sebagai harga per satuan stok."
                : "Perubahan ini besar. Pastikan memang harga barunya, bukan harga kemasan."}
            </p>
            <div className="rounded-lg border p-3 text-sm space-y-1">
              <div className="font-medium">{costConfirmation.name}</div>
              <div className="tabular-nums">
                {formatRp(costConfirmation.previous)} →{" "}
                <span className="font-semibold">{formatRp(costConfirmation.next)}</span> per{" "}
                {costConfirmation.stockUnit}
                {costConfirmation.ratio !== null && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {costConfirmation.ratio >= 1
                      ? `${costConfirmation.ratio.toFixed(1)}× lebih mahal`
                      : `${(1 / costConfirmation.ratio).toFixed(1)}× lebih murah`}
                  </span>
                )}
              </div>
              {costConfirmation.conversionFactor > 1 && (
                <div className="text-xs text-muted-foreground">
                  Setara{" "}
                  {formatRp(
                    costPerPurchaseUnit(costConfirmation.next, costConfirmation.conversionFactor),
                  )}{" "}
                  per {costConfirmation.purchaseUnit} (1 {costConfirmation.purchaseUnit} ={" "}
                  {costConfirmation.conversionFactor} {costConfirmation.stockUnit})
                </div>
              )}
            </div>

            {costConfirmation.affectedMenus > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {costConfirmation.affectedMenus} menu ikut berubah HPP-nya
                  {costConfirmation.biggest.length > 0 ? ", terbesar:" : ""}
                </p>
                <ul className="space-y-1 text-sm">
                  {costConfirmation.biggest.map((menu) => (
                    <li key={menu.recipeId} className="flex justify-between gap-3 tabular-nums">
                      <span className="truncate">{menu.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatRp(menu.cogsBefore)} →{" "}
                        <span className="font-medium text-foreground">
                          {formatRp(menu.cogsAfter)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              HPP penjualan yang sudah terjadi tidak ikut berubah — hanya penjualan berikutnya.
            </p>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button
                type="button"
                onClick={() => setCostConfirmation(null)}
                disabled={updateMutation.isPending}
                className="h-10 sm:h-9 px-4 rounded-md border text-sm disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={confirmCostChange}
                disabled={updateMutation.isPending}
                className="h-10 sm:h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-50"
              >
                {updateMutation.isPending ? "Menyimpan..." : "Tetap simpan"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </RoleGuard>
  );
}
