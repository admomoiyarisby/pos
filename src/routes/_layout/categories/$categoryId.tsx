import { createFileRoute, Link } from "@tanstack/react-router";
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
} from "#/lib/server/categories";
import { getRecipes } from "#/lib/server/recipes";
import { ArrowLeft, Link2, Tag } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  makanan: "Makanan",
  minuman: "Minuman",
  snack: "Snack",
  add_ons: "Add-Ons",
  paket_bundle: "Paket / Bundle",
};

export const Route = createFileRoute("/_layout/categories/$categoryId")({
  component: CategoryDetailPage,
  loader: async ({ params }) => {
    const [recipes, categories] = await Promise.all([
      getCategoryRecipes({ data: { category: params.categoryId } }),
      getCategories({}),
    ]);
    return { recipes, categories };
  },
});

function CategoryDetailPage() {
  const { categoryId } = Route.useParams();
  const { recipes: initialRecipes, categories } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<string[]>([]);
  const [originalRecipeIds, setOriginalRecipeIds] = useState<string[]>([]);
  const [destCategory, setDestCategory] = useState<string>("");

  const categoryName = CATEGORY_LABELS[categoryId] ?? categoryId;
  const categoryInfo = categories.find((c) => c.code === categoryId);

  const { data: recipes } = useQuery({
    queryKey: ["category-recipes", categoryId],
    queryFn: () => getCategoryRecipes({ data: { category: categoryId } }),
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

  const openLinkModal = () => {
    const currentIds = recipes.map((r) => r.id);
    setOriginalRecipeIds(currentIds);
    setSelectedRecipeIds(currentIds);
    setDestCategory("");
    setLinkModalOpen(true);
  };

  const removedIds = originalRecipeIds.filter((id) => !selectedRecipeIds.includes(id));
  const hasRemovals = removedIds.length > 0;

  const otherCategories = categories.filter((c) => c.code !== categoryId);

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
          <Button variant="outline" size="sm" onClick={openLinkModal}>
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
            Atur Menu
          </Button>
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
                        {recipe.category &&
                          ` — ${CATEGORY_LABELS[recipe.category] ?? recipe.category}`}
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
                    <option key={c.code} value={c.code}>
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
                    category: categoryId as
                      | "makanan"
                      | "minuman"
                      | "snack"
                      | "add_ons"
                      | "paket_bundle",
                    recipeIds: selectedRecipeIds,
                    removedRecipeIds: removedIds,
                    destinationCategory: hasRemovals
                      ? (destCategory as
                          | "makanan"
                          | "minuman"
                          | "snack"
                          | "add_ons"
                          | "paket_bundle")
                      : undefined,
                  },
                });
              }}
              disabled={assignMutation.isPending || (hasRemovals && !destCategory)}
            >
              {assignMutation.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </Modal>
      </div>
    </RoleGuard>
  );
}
