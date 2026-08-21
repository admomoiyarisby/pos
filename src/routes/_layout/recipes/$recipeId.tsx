import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import {
  getRecipeDetail,
  updateRecipe,
  deleteRecipe,
  deactivateRecipe,
  reactivateRecipe,
  getRecipeDeleteImpact,
  getRecipeReactivateImpact,
} from "#/lib/server/recipes";
import { uploadRecipeImage, deleteRecipeImage } from "#/lib/server/recipe-images";
import { getBrands } from "#/lib/server/brands";
import { getModifierGroups } from "#/lib/server/modifier-groups";
import { getBranches } from "#/lib/server/branches";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge";
import { Card } from "#/components/ui/card";
import { Button } from "#/components/ui/button";
import Modal from "#/components/ui/Modal";
import { Label } from "#/components/ui/label";
import { RecipeWizard, type RecipeWizardHandle } from "#/components/RecipeWizard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { useAuth } from "#/lib/auth-context";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  AlertTriangle,
  EyeOff,
  RotateCcw,
  TrendingUp,
  Package,
  Store,
  Tag,
  Image as ImageIcon,
  Upload,
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
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const [isEditing, setIsEditing] = useState(false);
  const wizardRef = useRef<RecipeWizardHandle>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [showReactivateModal, setShowReactivateModal] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isImagePending, setIsImagePending] = useState(false);

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

  // Per-page save in edit mode: partial update, invalidate, toast — but do NOT
  // close the wizard (the user stays on the page they just saved).
  const savePageMutation = useMutation({
    mutationFn: updateRecipe,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      toast.success("Perubahan tersimpan");
    },
    onError: (error: Error) => {
      toast.error("Gagal menyimpan perubahan", { description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ data }: { data: { id: string } }) => deleteRecipe({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setShowDeleteModal(false);
      toast.success("Menu dihapus secara permanen");
      void navigate({ to: "/recipes" });
    },
    onError: (error: Error) => {
      toast.error("Gagal menghapus menu", { description: error.message });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: ({ data }: { data: { id: string } }) => deactivateRecipe({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setShowDeactivateModal(false);
      toast.success("Menu dinonaktifkan");
    },
    onError: (error: Error) => {
      toast.error("Gagal menonaktifkan menu", { description: error.message });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: ({ data }: { data: { id: string } }) => reactivateRecipe({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setShowReactivateModal(false);
      toast.success("Menu diaktifkan");
    },
    onError: (error: Error) => {
      toast.error("Gagal mengaktifkan menu", { description: error.message });
    },
  });

  // ADR-0009: impact data for the confirm modals.
  const deleteImpactQuery = useQuery({
    queryKey: ["recipe-delete-impact", recipeId],
    queryFn: () => getRecipeDeleteImpact({ data: { id: recipeId } }),
    enabled: showDeleteModal,
  });
  const reactivateImpactQuery = useQuery({
    queryKey: ["recipe-reactivate-impact", recipeId],
    queryFn: () => getRecipeReactivateImpact({ data: { id: recipeId } }),
    enabled: showReactivateModal,
  });
  const impact = deleteImpactQuery.data;
  const reactivateImpact = reactivateImpactQuery.data;
  const blocked = (impact?.activeBundleCount ?? 0) > 0;

  const openImageModal = () => {
    setImageFile(null);
    setImagePreviewUrl(recipe?.imageUrl ?? null);
    setShowImageModal(true);
  };

  const handleUploadImage = async () => {
    if (!imageFile) return;
    setIsImagePending(true);
    try {
      const fd = new FormData();
      fd.set("recipeId", recipeId);
      fd.set("file", imageFile);
      await uploadRecipeImage({ data: fd });
      void queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setShowImageModal(false);
      toast.success("Gambar resep berhasil diperbarui");
    } catch (err) {
      toast.error("Gagal mengunggah gambar", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsImagePending(false);
    }
  };

  const handleRemoveImage = async () => {
    setIsImagePending(true);
    try {
      await deleteRecipeImage({ data: { recipeId } });
      void queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setShowImageModal(false);
      toast.success("Gambar resep dihapus");
    } catch (err) {
      toast.error("Gagal menghapus gambar", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsImagePending(false);
    }
  };

  const handleDelete = async () => {
    if (recipeId) {
      await deleteMutation.mutateAsync({ data: { id: recipeId } });
    }
  };

  const handleDeactivate = async () => {
    if (recipeId) {
      await deactivateMutation.mutateAsync({ data: { id: recipeId } });
    }
  };

  const handleReactivate = async () => {
    if (recipeId) {
      await reactivateMutation.mutateAsync({ data: { id: recipeId } });
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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border bg-muted">
              {recipe.imageUrl ? (
                <img
                  src={recipe.imageUrl}
                  alt={recipe.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  Belum ada
                </div>
              )}
            </div>
            <div>
              <p className="text-muted-foreground mt-1">
                {recipe.code} • {recipe.categoryName ?? "—"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isEditing && (
              <Button variant="outline" size="sm" onClick={openImageModal}>
                <ImageIcon className="h-4 w-4" />
                {recipe.imageUrl ? "Ganti Gambar" : "Tambah Gambar"}
              </Button>
            )}
            {!isEditing && recipe.status === "Active" && (
              <Button
                variant="outline"
                onClick={() => setShowDeactivateModal(true)}
                className="text-muted-foreground"
              >
                <EyeOff className="h-4 w-4 mr-2" />
                Nonaktifkan
              </Button>
            )}
            {!isEditing && recipe.status === "Inactive" && (
              <>
                <Button variant="outline" onClick={() => setShowReactivateModal(true)}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Aktifkan
                </Button>
                {isSuperAdmin && (
                  <Button
                    variant="outline"
                    onClick={() => setShowDeleteModal(true)}
                    className="text-destructive border-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Hapus
                  </Button>
                )}
              </>
            )}
            <Button
              onClick={async () => {
                if (!isEditing) {
                  setIsEditing(true);
                  return;
                }
                // Persist the current step before leaving edit mode — never
                // drop edits silently. A failed save keeps the wizard open.
                if (await wizardRef.current?.saveCurrentStep()) {
                  setIsEditing(false);
                }
              }}
              disabled={isEditing && savePageMutation.isPending}
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
              ref={wizardRef}
              initialData={{
                code: recipe.code,
                name: recipe.name,
                categoryId: recipe.categoryId,
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
              isEditMode={isEditing}
              onSubmit={async (data) => {
                await updateMutation.mutateAsync({ data: { id: recipeId, ...data } });
              }}
              onSavePage={async (partial) => {
                await savePageMutation.mutateAsync({ data: { id: recipeId, ...partial } });
              }}
              onCancel={() => setIsEditing(false)}
              isPending={savePageMutation.isPending}
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
                    <p className="font-medium">{recipe.categoryName ?? "—"}</p>
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

        {/* Delete Modal — heavy confirm (ADR-0009) */}
        <Modal
          open={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title="Hapus Menu"
          size="md"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Hapus menu "{recipe?.name}"?</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Resep akan dihapus secara permanen dari antarmuka. Tindakan ini{" "}
                  <span className="font-medium text-foreground">
                    tidak dapat dibatalkan lewat UI
                  </span>{" "}
                  (pemulihan hanya via database). Data historis — pesanan, HPP, dan log audit —
                  tetap tersimpan.
                </p>
              </div>
            </div>

            {impact &&
              (impact.orderCount > 0 ||
                impact.bundleCount > 0 ||
                impact.modifierGroupCount > 0 ||
                impact.branchStockCount > 0) && (
                <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                  <p className="font-medium text-muted-foreground">Resep masih terkait dengan:</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {impact.orderCount > 0 && <li>{impact.orderCount} pesanan historis</li>}
                    {impact.bundleCount > 0 && (
                      <li>
                        {impact.bundleCount} paket
                        {impact.activeBundleCount > 0 && (
                          <span className="text-destructive">
                            {" "}
                            ({impact.activeBundleCount} aktif — penghapusan diblokir)
                          </span>
                        )}
                      </li>
                    )}
                    {impact.modifierGroupCount > 0 && (
                      <li>{impact.modifierGroupCount} grup modifier</li>
                    )}
                    {impact.branchStockCount > 0 && (
                      <li>stok di {impact.branchStockCount} cabang</li>
                    )}
                  </ul>
                </div>
              )}

            {blocked && (
              <p className="text-sm text-destructive">
                Tidak dapat dihapus: resep digunakan dalam {impact?.activeBundleCount} paket aktif.
                Nonaktifkan paket tersebut terlebih dahulu.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowDeleteModal(false)}>
                Batal
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending || blocked}
              >
                {deleteMutation.isPending ? "Menghapus..." : "Hapus"}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Deactivate Modal — light confirm */}
        <Modal
          open={showDeactivateModal}
          onClose={() => setShowDeactivateModal(false)}
          title="Nonaktifkan Menu"
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm">
              Nonaktifkan menu "{recipe?.name}"? Menu tetap ditampilkan dengan badge{" "}
              <code className="mx-1 bg-muted px-1.5 py-0.5 rounded">Nonaktif</code> dan dapat
              diaktifkan kembali kapan saja.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowDeactivateModal(false)}>
                Batal
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDeactivate}
                disabled={deactivateMutation.isPending}
              >
                {deactivateMutation.isPending ? "Menonaktifkan..." : "Nonaktifkan"}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Reactivate Modal — light confirm with optional bundle warning (ADR-0009) */}
        <Modal
          open={showReactivateModal}
          onClose={() => setShowReactivateModal(false)}
          title="Aktifkan Menu"
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm">
              Aktifkan kembali menu "{recipe?.name}"? Menu akan kembali dapat dijual.
            </p>
            {reactivateImpact &&
              (reactivateImpact.deletedChildCount > 0 ||
                reactivateImpact.inactiveChildCount > 0) && (
                <div className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 p-3">
                  <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                  <p className="text-sm">
                    Perhatian: paket ini berisi {reactivateImpact.deletedChildCount} resep yang
                    dihapus dan {reactivateImpact.inactiveChildCount} yang nonaktif. Resep tersebut
                    tidak akan tersedia saat paket dipesan.
                  </p>
                </div>
              )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowReactivateModal(false)}>
                Batal
              </Button>
              <Button
                type="button"
                onClick={handleReactivate}
                disabled={reactivateMutation.isPending}
              >
                {reactivateMutation.isPending ? "Mengaktifkan..." : "Aktifkan"}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Recipe image modal — dedicated image management, separate from editing recipe info */}
        <Modal
          open={showImageModal}
          onClose={() => setShowImageModal(false)}
          title="Gambar Resep"
          size="md"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-28 w-28 shrink-0 overflow-hidden rounded-lg border bg-muted">
                {imagePreviewUrl ? (
                  <img
                    src={imagePreviewUrl}
                    alt={recipe.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    Belum ada
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Pilih Gambar</Label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setImageFile(f);
                      setImagePreviewUrl(URL.createObjectURL(f));
                    } else {
                      setImageFile(null);
                      setImagePreviewUrl(recipe.imageUrl ?? null);
                    }
                  }}
                  className="block w-full max-w-xs text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground hover:file:opacity-90"
                />
                <span className="block text-xs text-muted-foreground">
                  JPEG / PNG / WebP, maks 2 MB
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t pt-4">
              <div>
                {recipe.imageUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive hover:bg-destructive/10"
                    onClick={handleRemoveImage}
                    disabled={isImagePending}
                  >
                    <Trash2 className="h-4 w-4" />
                    Hapus Gambar
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setShowImageModal(false)}>
                  Batal
                </Button>
                <Button onClick={handleUploadImage} disabled={!imageFile || isImagePending}>
                  <Upload className="h-4 w-4" />
                  {isImagePending ? "Menyimpan..." : "Unggah"}
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      </div>
    </RoleGuard>
  );
}
