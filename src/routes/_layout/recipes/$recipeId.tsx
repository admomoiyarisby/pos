import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import {
  getRecipeDetail,
  updateRecipe,
  deleteRecipe,
  assignRecipeStock,
  getRecipeInventory,
} from "#/lib/server/recipes";
import { getBrands } from "#/lib/server/brands";
import { getModifierGroups } from "#/lib/server/modifier-groups";
import { getBranches } from "#/lib/server/branches";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge";
import { Card } from "#/components/ui/card";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import Modal from "#/components/ui/Modal";
import { RecipeWizard } from "#/components/RecipeWizard";
import { usePageTitle } from "#/hooks/usePageTitle";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  AlertTriangle,
  TrendingUp,
  Package,
  Store,
  Tag,
  Factory,
} from "lucide-react";

export const Route = createFileRoute("/_layout/recipes/$recipeId")({
  component: RecipeDetailPage,
  loader: async ({ params }) => {
    const recipe = await getRecipeDetail({ data: { id: params.recipeId } });
    const brands = await getBrands({ data: {} });
    const modifierGroups = await getModifierGroups({ data: {} });
    const branches = await getBranches({ data: {} });
    return { recipe, brands, modifierGroups, branches };
  },
});

function RecipeDetailPage() {
  const { recipe: initial, brands, modifierGroups, branches } = Route.useLoaderData();
  const { recipeId } = Route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const { data: recipe } = useQuery({
    queryKey: ["recipe", recipeId],
    queryFn: () => getRecipeDetail({ data: { id: recipeId } }),
    initialData: initial,
  });

  const { data: allModifierGroups } = useQuery({
    queryKey: ["modifier-groups"],
    queryFn: () => modifierGroups,
    initialData: modifierGroups,
  });

  const { data: allBrands } = useQuery({
    queryKey: ["brands"],
    queryFn: () => brands,
    initialData: brands,
  });

  const { data: allBranches } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branches,
    initialData: branches,
  });

  const { data: allRecipes } = useQuery({
    queryKey: ["recipes"],
    queryFn: () => import("#/lib/server/recipes").then((m) => m.getRecipes({ data: {} })),
  });

  // Current finished-good stock for this recipe (per branch).
  const { data: recipeStock } = useQuery({
    queryKey: ["recipe-stock", recipeId],
    queryFn: () => getRecipeInventory({ data: { recipeId } }),
    enabled: !!recipeId,
  });

  // Produce / assign stock modal state.
  const [showProduceModal, setShowProduceModal] = useState(false);
  const [produceQty, setProduceQty] = useState("1");
  const [produceBranchId, setProduceBranchId] = useState("");
  const [produceNotes, setProduceNotes] = useState("");

  const produceMutation = useMutation({
    mutationFn: assignRecipeStock,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipe-stock", recipeId] });
      setShowProduceModal(false);
      setProduceQty("1");
      setProduceBranchId("");
      setProduceNotes("");
      toast.success("Stok resep berhasil ditambahkan");
    },
    onError: (error: Error) => {
      toast.error("Gagal menambah stok resep", { description: error.message });
    },
  });

  const openProduceModal = () => {
    // Default target branch = first Central Warehouse.
    const central = (allBranches ?? []).find((b: any) => b.type === "Central");
    setProduceBranchId(central?.id ?? "");
    setShowProduceModal(true);
  };

  const handleProduce = async () => {
    const qty = Number(produceQty);
    if (!recipeId || !Number.isFinite(qty) || qty <= 0) {
      toast.error("Jumlah stok harus lebih dari 0");
      return;
    }
    await produceMutation.mutateAsync({
      data: {
        recipeId,
        quantity: qty,
        branchId: produceBranchId || undefined,
        notes: produceNotes.trim() || undefined,
      },
    });
  };

  const updateMutation = useMutation({
    mutationFn: updateRecipe,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setIsEditing(false);
      toast.success("Menu berhasil diperbarui");
    },
    onError: (error: Error) => {
      toast.error("Gagal memperbarui menu", { description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ data }: { data: { id: string; hardDelete: boolean } }) => deleteRecipe({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setShowDeleteModal(false);
      toast.success("Menu berhasil dinonaktifkan");
      void navigate({ to: "/recipes" });
    },
    onError: (error: Error) => {
      toast.error("Gagal menonaktifkan menu", { description: error.message });
    },
  });

  const handleDelete = async () => {
    if (recipeId) {
      await deleteMutation.mutateAsync({
        data: { id: recipeId, hardDelete: false },
      });
    }
  };

  usePageTitle(recipe?.name ?? "Detail Resep", "Bill of Materials & HPP");

  if (!recipe) {
    return <div className="text-muted-foreground">Resep tidak ditemukan</div>;
  }

  // Calculate margin
  const margin =
    recipe.totalCogs > 0 && recipe.basePrice > 0
      ? ((recipe.basePrice - recipe.totalCogs) / recipe.basePrice) * 100
      : 0;
  const isHighHPP = recipe.totalCogs / recipe.basePrice > 0.4;

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <div className="space-y-6">
        {/* Back Navigation */}
        <Link
          to="/recipes"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali ke Daftar Menu
        </Link>

        {/* Header with Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{recipe.name}</h1>
            <p className="text-muted-foreground mt-1">
              {recipe.code} • {recipe.category}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && (
              <Button
                variant="outline"
                onClick={() => setShowDeleteModal(true)}
                className="text-destructive border-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Nonaktifkan
              </Button>
            )}
            <Button
              onClick={() => {
                if (!isEditing) {
                  // Entering edit mode - wizard will use recipe data
                  setIsEditing(true);
                } else {
                  // Cancelling edit
                  setIsEditing(false);
                }
              }}
            >
              {isEditing ? (
                "Batal"
              ) : (
                <>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit Menu
                </>
              )}
            </Button>
          </div>
        </div>

        {isEditing ? (
          /* Edit Mode: Wizard */
          <Card className="p-6">
            <RecipeWizard
              initialData={{
                code: recipe.code,
                name: recipe.name,
                category: recipe.category,
                basePrice: recipe.basePrice,
                brandIds: recipe.brands?.map((b: any) => b.brandId) ?? [],
                ingredients:
                  recipe.ingredients?.map((i: any) => ({
                    ingredientId: i.ingredientId,
                    quantity: i.quantity,
                  })) ?? [],
                branchIds: recipe.branchIds ?? [],
                isBOGO: recipe.isBOGO,
                modifierGroupIds: recipe.modifierGroups?.map((mg: any) => mg.modifierGroupId) ?? [],
                isBundling: recipe.childRecipes?.length > 0,
                childRecipes:
                  recipe.childRecipes?.map((cr: any) => ({
                    recipeId: cr.childRecipeId,
                    quantity: cr.quantity,
                  })) ?? [],
              }}
              brands={allBrands ?? []}
              branches={allBranches ?? []}
              modifierGroups={allModifierGroups ?? []}
              recipes={allRecipes ?? []}
              onSubmit={(data) => {
                void updateMutation.mutateAsync({
                  data: {
                    id: recipeId,
                    ...data,
                  },
                });
              }}
              onCancel={() => setIsEditing(false)}
              isPending={updateMutation.isPending}
              submitLabel="Simpan Perubahan"
            />
          </Card>
        ) : (
          /* View Mode */
          <>
            {/* Key Metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* HPP Card - Highlighted */}
              <Card className={`p-4 ${isHighHPP ? "border-destructive" : ""}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      HPP
                      <span className="ml-1 text-[10px]">(Harga Pokok Penjualan)</span>
                    </p>
                    <p className="text-2xl font-bold mt-1">
                      Rp {recipe.totalCogs.toLocaleString("id-ID")}
                    </p>
                  </div>
                  <TrendingUp
                    className={`h-5 w-5 ${isHighHPP ? "text-destructive" : "text-muted-foreground"}`}
                  />
                </div>
                {recipe.basePrice > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${isHighHPP ? "bg-destructive" : "bg-primary"}`}
                        style={{
                          width: `${Math.min((recipe.totalCogs / recipe.basePrice) * 100, 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs font-medium">
                      {((recipe.totalCogs / recipe.basePrice) * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </Card>

              {/* Margin Card */}
              <Card className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Margin</p>
                    <p
                      className={`text-2xl font-bold mt-1 ${margin < 0 ? "text-destructive" : ""}`}
                    >
                      {margin.toFixed(1)}%
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Harga jual Rp {recipe.basePrice.toLocaleString("id-ID")}
                </p>
              </Card>

              {/* Category & Status */}
              <Card className="p-4">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      <Tag className="h-3 w-3 inline mr-1" />
                      Kategori
                    </p>
                    <p className="font-medium capitalize">{recipe.category}</p>
                  </div>
                  <div>
                    <Badge
                      variant={recipe.status === "Active" ? "success" : "secondary"}
                      className="text-xs"
                    >
                      {recipe.status === "Active" ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </div>
                </div>
              </Card>

              {/* Features */}
              <Card className="p-4">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      <Package className="h-3 w-3 inline mr-1" />
                      Fitur
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {recipe.isSubRecipe && (
                        <Badge variant="outline" className="text-xs">
                          Sub-resep
                        </Badge>
                      )}
                      {recipe.isBOGO && (
                        <Badge variant="warning" className="text-xs">
                          BOGO
                        </Badge>
                      )}
                      {recipe.childRecipes?.length > 0 && (
                        <Badge variant="outline" className="text-xs">
                          Paket ({recipe.childRecipes.length} item)
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      <Store className="h-3 w-3 inline mr-1" />
                      Cabang
                    </p>
                    <p className="font-medium">
                      {recipe.branchIds?.length === 0 || !recipe.branchIds
                        ? "Semua cabang"
                        : `${recipe.branchIds.length} cabang`}
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Stok & Produksi (finished-good stock) */}
            <Card>
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Stok &amp; Produksi</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Stok jadi resep per cabang (tercatat di Kartu Stok)
                  </p>
                </div>
                <Button onClick={openProduceModal}>
                  <Factory className="h-4 w-4 mr-2" />
                  Produksi / Assign Stok
                </Button>
              </div>
              {!recipeStock || recipeStock.length === 0 ? (
                <div className="px-6 py-8 text-center">
                  <Factory className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Belum ada stok jadi</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Klik "Produksi / Assign Stok" untuk mencatat produksi ke Gudang Pusat
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-6 py-3 text-left font-medium">Cabang</th>
                        <th className="px-6 py-3 text-right font-medium">Stok Jadi</th>
                        <th className="px-6 py-3 text-left font-medium">Terakhir Update</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipeStock.map((s: any) => (
                        <tr key={s.branchId} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-6 py-3">
                            {s.branchName ?? s.branchId}
                            {s.branchType === "Central" && (
                              <Badge variant="outline" className="ml-2 text-xs">
                                Pusat
                              </Badge>
                            )}
                          </td>
                          <td className="px-6 py-3 text-right font-medium">
                            {Number(s.quantity).toLocaleString("id-ID")}
                          </td>
                          <td className="px-6 py-3 text-muted-foreground">
                            {new Date(s.lastUpdated).toLocaleString("id-ID", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Ingredients (BOM) */}
            <Card>
              <div className="px-6 py-4 border-b">
                <h2 className="text-lg font-semibold">Bahan (BOM)</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Bill of Materials — bahan dan takaran untuk resep ini
                </p>
              </div>
              {recipe.ingredients.length === 0 ? (
                <div className="px-6 py-8 text-center">
                  <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Belum ada bahan</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Klik "Edit Menu" untuk menambahkan bahan
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-6 py-3 text-left font-medium">Bahan</th>
                        <th className="px-6 py-3 text-right font-medium">Jumlah</th>
                        <th className="px-6 py-3 text-right font-medium">Satuan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipe.ingredients.map((ing: any, i: number) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-6 py-3">{ing.ingredientName ?? ing.ingredientId}</td>
                          <td className="px-6 py-3 text-right font-medium">{ing.quantity}</td>
                          <td className="px-6 py-3 text-right text-muted-foreground">
                            {ing.stockUnit ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Bundling */}
            {recipe.childRecipes?.length > 0 && (
              <Card>
                <div className="px-6 py-4 border-b">
                  <h2 className="text-lg font-semibold">Komposisi Paket (Bundling)</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Menu yang termasuk dalam paket ini
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-6 py-3 text-left font-medium">Menu</th>
                        <th className="px-6 py-3 text-right font-medium">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipe.childRecipes.map((cr: any, i: number) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-6 py-3">{cr.childRecipeName ?? cr.childRecipeId}</td>
                          <td className="px-6 py-3 text-right font-medium">{cr.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Modifier Groups */}
            {recipe.modifierGroups.length > 0 && (
              <Card>
                <div className="px-6 py-4 border-b">
                  <h2 className="text-lg font-semibold">Grup Modifier</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Opsi tambahan yang tersedia untuk menu ini
                  </p>
                </div>
                <div className="divide-y">
                  {recipe.modifierGroups.map((mg: any) => (
                    <div key={mg.modifierGroupId} className="px-6 py-4">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-medium">
                          {mg.modifierGroupName ?? mg.modifierGroupId}
                        </h3>
                        <Badge variant="outline" className="text-xs">
                          min: {mg.minSelection}, max: {mg.maxSelection}
                        </Badge>
                      </div>
                      {mg.modifiers?.length > 0 ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {mg.modifiers.map((m: any) => (
                            <div
                              key={m.id}
                              className="flex items-center justify-between text-sm bg-muted/50 rounded-md px-3 py-2"
                            >
                              <span>
                                {m.name}
                                {m.isExclusion && (
                                  <Badge variant="destructive" className="ml-2 text-[10px]">
                                    Exclusion
                                  </Badge>
                                )}
                              </span>
                              <span className="text-muted-foreground">
                                {m.price > 0 ? `+Rp ${m.price.toLocaleString("id-ID")}` : "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">Tidak ada modifier</p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}

        {/* Produce / Assign Stock Modal */}
        <Modal
          open={showProduceModal}
          onClose={() => setShowProduceModal(false)}
          title="Produksi / Assign Stok"
          size="md"
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Catat produksi resep <span className="font-medium">{recipe?.name}</span> ke cabang.
              Pergerakan akan tercatat di Kartu Stok.
            </p>

            <div className="space-y-2">
              <Label htmlFor="produce-branch">Cabang Tujuan</Label>
              <select
                id="produce-branch"
                value={produceBranchId}
                onChange={(e) => setProduceBranchId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">— Pilih Cabang —</option>
                {(allBranches ?? []).map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.type === "Central" ? " (Pusat)" : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Kosongkan untuk default Gudang Pusat (Central).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="produce-qty">Jumlah Stok Jadi</Label>
              <Input
                id="produce-qty"
                type="number"
                min={0.1}
                step={1}
                value={produceQty}
                onChange={(e) => setProduceQty(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="produce-notes">Catatan (opsional)</Label>
              <Input
                id="produce-notes"
                type="text"
                placeholder="mis. Batch pagi"
                value={produceNotes}
                onChange={(e) => setProduceNotes(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowProduceModal(false)}>
                Batal
              </Button>
              <Button type="button" onClick={handleProduce} disabled={produceMutation.isPending}>
                {produceMutation.isPending ? "Menyimpan..." : "Simpan Produksi"}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Delete Modal */}
        <Modal
          open={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title="Nonaktifkan Menu"
          size="sm"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Nonaktifkan menu "{recipe?.name}"?</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Status menu akan diubah menjadi{" "}
                  <code className="mx-1 bg-muted px-1.5 py-0.5 rounded">Inactive</code>. Menu tidak
                  akan muncul di daftar aktif, tetapi data historis tetap tersimpan.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowDeleteModal(false)}>
                Batal
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Menonaktifkan..." : "Nonaktifkan"}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </RoleGuard>
  );
}
