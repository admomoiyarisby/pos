import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Separator } from "#/components/ui/separator";
import { Checkbox } from "#/components/ui/checkbox";
import Modal from "#/components/ui/Modal";
import { Label } from "#/components/ui/label";
import { toast } from "sonner";
import {
  getCategories,
  getCategoryRecipes,
  assignRecipesToCategory,
  deleteCategory,
} from "#/lib/server/categories";
import { getRecipes } from "#/lib/server/recipes";
import { ArrowLeft, Link2, Tag, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_layout/categories/$categoryId")({
  component: CategoryDetailPage,
  loader: async ({ params }) => {
    const [recipes, categories] = await Promise.all([
      getCategoryRecipes({ data: { categoryId: params.categoryId } }),
      getCategories({}),
    ]);
    return { recipes, categories };
  },
});

function CategoryDetailPage() {
  const { categoryId } = Route.useParams();
  const { recipes: initialRecipes, categories } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<string[]>([]);
  const [originalRecipeIds, setOriginalRecipeIds] = useState<string[]>([]);
  const [destCategory, setDestCategory] = useState<string>("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteDestCategory, setDeleteDestCategory] = useState<string>("");

  const categoryInfo = categories.find((c) => c.id === categoryId);
  const categoryName = categoryInfo?.name ?? "Kategori";
  const otherCategories = categories.filter((c) => c.id !== categoryId);

  const { data: recipes } = useQuery({
    queryKey: ["category-recipes", categoryId],
    queryFn: () => getCategoryRecipes({ data: { categoryId } }),
    initialData: initialRecipes,
  });

  const { data: allRecipes } = useQuery({
    queryKey: ["recipes"],
    queryFn: () => getRecipes({ data: {} }),
  });

  const assignMutation = useMutation({
    mutationFn: assignRecipesToCategory,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["category-recipes", categoryId] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setLinkModalOpen(false);
      toast.success("Menu berhasil dipindahkan ke kategori ini");
    },
    onError: (error: Error) => {
      toast.error("Gagal memindahkan menu", { description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setDeleteModalOpen(false);
      toast.success("Kategori berhasil dihapus");
      void router.navigate({ to: "/categories" });
    },
    onError: (error: Error) => {
      toast.error("Gagal menghapus kategori", { description: error.message });
    },
  });

  const openLinkModal = () => {
    const currentIds = recipes.map((r) => r.id);
    setOriginalRecipeIds(currentIds);
    setSelectedRecipeIds(currentIds);
    setDestCategory("");
    setLinkModalOpen(true);
  };

  const openDeleteModal = () => {
    setDeleteDestCategory("");
    setDeleteModalOpen(true);
  };

  const removedIds = originalRecipeIds.filter((id) => !selectedRecipeIds.includes(id));
  const hasRemovals = removedIds.length > 0;

  usePageTitle(categoryName, `Kelola menu dalam kategori ${categoryName}`);

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <div className="space-y-6">
        {/* Back Navigation */}
        <Link
          to="/categories"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali ke Daftar Kategori
        </Link>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Tag className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{categoryName}</h1>
              <p className="text-sm text-muted-foreground">
                {categoryInfo?.recipeCount ?? 0} menu terdaftar
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={openDeleteModal}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Hapus Kategori
            </Button>
            <Button variant="outline" size="sm" onClick={openLinkModal}>
              <Link2 className="h-3.5 w-3.5 mr-1.5" />
              Atur Menu
            </Button>
          </div>
        </div>

        <Separator />

        {/* Recipe list */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Daftar Menu</h2>
          {recipes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Tag className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">Belum ada menu dalam kategori ini</p>
              <p className="text-xs text-muted-foreground mt-1">
                Klik "Atur Menu" untuk menambahkan menu
              </p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm min-w-[400px]">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Kode</th>
                    <th className="px-4 py-3 text-left font-medium">Nama Menu</th>
                    <th className="px-4 py-3 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recipes.map((recipe: any) => (
                    <tr key={recipe.id} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-3 text-muted-foreground">{recipe.code}</td>
                      <td className="px-4 py-3 font-medium">
                        <Link
                          to="/recipes/$recipeId"
                          params={{ recipeId: recipe.id }}
                          className="hover:text-primary transition-colors"
                        >
                          {recipe.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge
                          variant={recipe.status === "Active" ? "success" : "secondary"}
                          className="text-[10px]"
                        >
                          {recipe.status === "Active" ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Link/Unlink modal */}
        <Modal
          open={linkModalOpen}
          onClose={() => setLinkModalOpen(false)}
          title={`Atur Menu — ${categoryName}`}
          size="lg"
        >
          <p className="text-sm text-muted-foreground mb-4">
            Pilih menu yang akan ditempatkan di kategori "{categoryName}"
          </p>
          {!allRecipes ? (
            <p className="text-sm text-muted-foreground">Memuat menu...</p>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-1 border rounded-md p-2">
              {allRecipes.map((recipe: any) => {
                const isChecked = selectedRecipeIds.includes(recipe.id);
                return (
                  <label
                    key={recipe.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer hover:bg-accent"
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={(checked) => {
                        setSelectedRecipeIds(
                          checked === true
                            ? [...selectedRecipeIds, recipe.id]
                            : selectedRecipeIds.filter((id) => id !== recipe.id),
                        );
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{recipe.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {recipe.code}
                        {recipe.category ? ` — ${recipe.category}` : ""}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          {hasRemovals && (
            <div className="mt-4 p-4 border rounded-md bg-amber-50 dark:bg-amber-950/20 space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {removedIds.length} menu akan dipindahkan dari "{categoryName}"
              </p>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Pindahkan ke kategori</Label>
                <select
                  value={destCategory}
                  onChange={(e) => setDestCategory(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="" disabled>
                    Pilih kategori tujuan
                  </option>
                  {otherCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button type="button" variant="outline" onClick={() => setLinkModalOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={() => {
                if (hasRemovals && !destCategory) {
                  toast.error("Pilih kategori tujuan untuk menu yang dipindahkan");
                  return;
                }
                void assignMutation.mutateAsync({
                  data: {
                    categoryId,
                    recipeIds: selectedRecipeIds,
                    removedRecipeIds: removedIds,
                    destinationCategoryId: hasRemovals ? destCategory : undefined,
                  },
                });
              }}
              disabled={assignMutation.isPending || (hasRemovals && !destCategory)}
            >
              {assignMutation.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </Modal>

        {/* Delete Category Modal */}
        <Modal
          open={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          title={`Hapus Kategori "${categoryName}"`}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Kategori "{categoryName}" akan dihapus. Pilih kategori tujuan untuk menu yang saat ini
              berada dalam kategori ini.
            </p>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Pindahkan menu ke kategori</Label>
              <select
                value={deleteDestCategory}
                onChange={(e) => setDeleteDestCategory(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="" disabled>
                  Pilih kategori tujuan
                </option>
                {otherCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setDeleteModalOpen(false)}>
                Batal
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (!deleteDestCategory) {
                    toast.error("Pilih kategori tujuan untuk menu yang dipindahkan");
                    return;
                  }
                  void deleteMutation.mutateAsync({
                    data: {
                      categoryId,
                      destinationCategoryId: deleteDestCategory,
                    },
                  });
                }}
                disabled={deleteMutation.isPending || !deleteDestCategory}
              >
                {deleteMutation.isPending ? "Menghapus..." : "Hapus Kategori"}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </RoleGuard>
  );
}
