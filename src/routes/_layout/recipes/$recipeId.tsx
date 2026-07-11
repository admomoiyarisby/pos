import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { getRecipeDetail, updateRecipe, deleteRecipe } from "#/lib/server/recipes";
import { getBrands } from "#/lib/server/brands";
import { getModifierGroups } from "#/lib/server/modifier-groups";
import { getBranches } from "#/lib/server/branches";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge";
import { Card } from "#/components/ui/card";
import { Button } from "#/components/ui/button";
import Modal from "#/components/ui/Modal";
import { Label } from "#/components/ui/label";
import { Separator } from "#/components/ui/separator";
import { Checkbox } from "#/components/ui/checkbox";
import { usePageTitle } from "#/hooks/usePageTitle";
import { Plus, Trash2, Save, AlertTriangle } from "lucide-react";

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
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isBundling, setIsBundling] = useState(false);
  const [childRecipes, setChildRecipes] = useState<any[]>([]);
  const [isBOGO, setIsBOGO] = useState(false);
  const [linkedModifierGroupIds, setLinkedModifierGroupIds] = useState<string[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);

  const { data: recipe } = useQuery({
    queryKey: ["recipe", recipeId],
    queryFn: () => getRecipeDetail({ data: { id: recipeId } }),
    initialData: initial,
  });

  usePageTitle(recipe?.name ?? "Detail Resep", "Bill of Materials & HPP");

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

  const navigate = useNavigate();

  const deleteMutation = useMutation({
    mutationFn: ({ data }: { data: { id: string; hardDelete: boolean } }) => deleteRecipe({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setShowDeleteModal(false);
      toast.success("Menu berhasil dinonaktifkan");
      void navigate({ to: "/recipes" });
    },
    onError: (error: Error) => {
      toast.error("Gagal menonaktifkan menu", { description: error.message });
    },
  });

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const brandIds = fd.getAll("brandIds").map(String);
    const data = {
      id: recipeId,
      code: fd.get("code") as string,
      name: fd.get("name") as string,
      description: fd.get("description") as string | undefined,
      category: fd.get("category") as "makanan" | "minuman" | "snack" | "add_ons" | "paket_bundle",
      basePrice: Number(fd.get("basePrice")),
      isBOGO: fd.get("isBOGO") === "on",
      brandIds,
      ingredients: [],
      childRecipes: isBundling && childRecipes.length > 0 ? childRecipes : undefined,
      modifierGroupIds: linkedModifierGroupIds.length > 0 ? linkedModifierGroupIds : undefined,
      branchIds: selectedBranchIds,
    };
    void updateMutation.mutateAsync({ data });
  };

  const handleDelete = async () => {
    if (recipeId) {
      await deleteMutation.mutateAsync({
        data: { id: recipeId, hardDelete: false },
      });
    }
  };

  if (!recipe) {
    return <div className="text-muted-foreground">Resep tidak ditemukan</div>;
  }

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <div className="space-y-6">
        <div className="mb-6 flex items-center justify-end gap-2">
          <button
            onClick={() => {
              if (!isEditing && recipe) {
                // Populate form state from current recipe data
                setSelectedBranchIds(recipe.branchIds ?? []);
                setIsBOGO(recipe.isBOGO);
                setLinkedModifierGroupIds(
                  recipe.modifierGroups?.map((mg: any) => mg.modifierGroupId) ?? [],
                );
                if (recipe.childRecipes?.length > 0) {
                  setIsBundling(true);
                  setChildRecipes(
                    recipe.childRecipes.map((cr: any) => ({
                      recipeId: cr.childRecipeId,
                      quantity: cr.quantity,
                    })),
                  );
                } else {
                  setIsBundling(false);
                  setChildRecipes([]);
                }
              }
              setIsEditing(!isEditing);
            }}
            className="inline-flex h-10 md:h-9 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {!isEditing && <Plus className="h-4 w-4" />}
            {isEditing ? "Batal" : "Edit Menu"}
          </button>
          {!isEditing && (
            <button
              onClick={() => setShowDeleteModal(true)}
              className="inline-flex h-10 md:h-9 items-center gap-2 rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive shadow-sm transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              Hapus
            </button>
          )}
        </div>
        {isEditing ? (
          <form onSubmit={handleUpdate} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Kode</label>
                <input
                  name="code"
                  defaultValue={recipe.code}
                  required
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Nama</label>
                <input
                  name="name"
                  defaultValue={recipe.name}
                  required
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Deskripsi</label>
              <input
                name="description"
                defaultValue={recipe.description || ""}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Kategori</label>
                <select
                  name="category"
                  defaultValue={recipe.category}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="makanan">Makanan</option>
                  <option value="minuman">Minuman</option>
                  <option value="snack">Snack</option>
                  <option value="add_ons">Add-on</option>
                  <option value="paket_bundle">Paket Bundle</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Harga Dasar (Rp)</label>
                <input
                  name="basePrice"
                  type="number"
                  min={0}
                  defaultValue={recipe.basePrice}
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Brand</Label>
              <div className="flex flex-wrap gap-2">
                {allBrands?.map((b) => (
                  <label
                    key={b.id}
                    className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="brandIds"
                      value={b.id}
                      defaultChecked={recipe.brands?.some((br) => br.brandId === b.id)}
                      className="rounded border-gray-300"
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label>Ketersediaan Cabang</Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="allBranches"
                  checked={selectedBranchIds.length === 0 && allBranches?.length > 0}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedBranchIds([]);
                    } else {
                      setSelectedBranchIds(allBranches?.map((b) => b.id) || []);
                    }
                  }}
                />
                <label htmlFor="allBranches" className="text-sm font-medium">
                  Tersedia di semua cabang (default)
                </label>
              </div>
              {selectedBranchIds.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-sm font-medium">Pilih cabang spesifik:</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {allBranches?.map((b) => (
                      <label key={b.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selectedBranchIds.includes(b.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedBranchIds([...selectedBranchIds, b.id]);
                            } else {
                              setSelectedBranchIds(selectedBranchIds.filter((id) => id !== b.id));
                            }
                          }}
                        />
                        {b.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <Separator />
            <div className="space-y-2">
              <Label>Opsi Tambahan</Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isBOGO"
                  checked={isBOGO}
                  onCheckedChange={(checked) => setIsBOGO(checked as boolean)}
                />
                <label htmlFor="isBOGO" className="text-sm font-medium">
                  BOGO (Beli 1 Gratis 1)
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Grup Modifier</Label>
              <div className="space-y-1">
                {allModifierGroups?.map((g) => {
                  const checked = linkedModifierGroupIds.includes(g.id);
                  return (
                    <div key={g.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setLinkedModifierGroupIds([...linkedModifierGroupIds, g.id]);
                          } else {
                            setLinkedModifierGroupIds(
                              linkedModifierGroupIds.filter((id) => id !== g.id),
                            );
                          }
                        }}
                      />
                      <span className="text-sm font-medium">{g.name}</span>
                      <Badge variant={g.minSelection > 0 ? "default" : "secondary"}>
                        {g.minSelection > 0 ? "wajib" : "opsional"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsEditing(false);
                  setIsBundling(false);
                  setChildRecipes([]);
                  setIsBOGO(false);
                  setLinkedModifierGroupIds([]);
                  setSelectedBranchIds([]);
                }}
              >
                Batal
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                <Save className="h-4 w-4 mr-2" />
                {updateMutation.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground uppercase">Kategori</p>
                <p className="font-medium mt-1 capitalize">{recipe.category}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground uppercase">Harga Dasar</p>
                <p className="font-medium mt-1">Rp {recipe.basePrice.toLocaleString("id-ID")}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground uppercase">HPP Total</p>
                <p className="font-medium mt-1 text-lg font-bold">
                  Rp {recipe.totalCogs.toLocaleString("id-ID")}
                </p>
                {recipe.totalCogs > 0 && recipe.basePrice > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Margin:{" "}
                    {(((recipe.basePrice - recipe.totalCogs) / recipe.basePrice) * 100).toFixed(1)}%
                    {recipe.totalCogs / recipe.basePrice > 0.4 && (
                      <Badge variant="destructive" className="ml-1 text-[10px]">
                        HPP &gt; 40%!
                      </Badge>
                    )}
                  </p>
                )}
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground uppercase">Sub-resep</p>
                <p className="font-medium mt-1">{recipe.isSubRecipe ? "Ya" : "Tidak"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground uppercase">Status</p>
                <Badge
                  variant={recipe.status === "Active" ? "success" : "secondary"}
                  className="mt-1"
                >
                  {recipe.status}
                </Badge>
              </div>
            </div>

            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Bahan (BOM)</h2>
              {recipe.ingredients.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada bahan</p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-sm min-w-[480px]">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Bahan</th>
                        <th className="px-4 py-2 text-right font-medium">Jumlah</th>
                        <th className="px-4 py-2 text-right font-medium">Satuan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipe.ingredients.map((ing, i) => (
                        <tr key={i} className="border-b">
                          <td className="px-4 py-2">{ing.ingredientName ?? ing.ingredientId}</td>
                          <td className="px-4 py-2 text-right">{ing.quantity}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground">
                            {ing.stockUnit ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {recipe.childRecipes?.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Komposisi Paket (Bundling)</h2>
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-sm min-w-[480px]">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Menu</th>
                        <th className="px-4 py-2 text-right font-medium">Qty</th>
                        <th className="px-4 py-2 text-right font-medium">Harga</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipe.childRecipes.map((cr, i) => (
                        <tr key={i} className="border-b">
                          <td className="px-4 py-2">{cr.childRecipeName ?? cr.childRecipeId}</td>
                          <td className="px-4 py-2 text-right">{cr.quantity}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground">—</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {recipe.modifierGroups.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Grup Modifier</h2>
            {recipe.modifierGroups.map((mg: any) => (
              <Card key={mg.modifierGroupId} className="p-0">
                <div className="px-4 py-3 border-b">
                  <h3 className="font-medium">
                    {mg.modifierGroupName ?? mg.modifierGroupId}
                    <Badge variant="outline" className="ml-2">
                      min: {mg.minSelection}, max: {mg.maxSelection}
                    </Badge>
                  </h3>
                </div>
                <div className="divide-y">
                  {mg.modifiers?.length > 0 ? (
                    mg.modifiers.map((m: any) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between px-4 py-2 text-sm"
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
                    ))
                  ) : (
                    <div className="px-4 py-2 text-sm text-muted-foreground">
                      Tidak ada modifier
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
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
    </RoleGuard>
  );
}
