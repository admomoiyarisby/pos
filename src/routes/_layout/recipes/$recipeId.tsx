import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { getRecipeDetail } from "#/lib/server/recipes";

import { Badge } from "#/components/ui/badge";

export const Route = createFileRoute("/_layout/recipes/$recipeId")({
  component: RecipeDetailPage,
  loader: async ({ params }) => {
    const recipe = await getRecipeDetail({ data: { id: params.recipeId } });
    return { recipe };
  },
});

function RecipeDetailPage() {
  const { recipe: initial } = Route.useLoaderData();
  const { recipeId } = Route.useParams();
  const [isEditing, setIsEditing] = useState(false);

  const { data: recipe } = useQuery({
    queryKey: ["recipe", recipeId],
    queryFn: () => getRecipeDetail({ data: { id: recipeId } }),
    initialData: initial,
  });

  if (!recipe) {
    return <div className="text-muted-foreground">Resep tidak ditemukan</div>;
  }

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">{recipe.name}</h1>
            <p className="text-sm text-muted-foreground">Kode: {recipe.code}</p>
          </div>
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="h-9 px-4 rounded-md border text-sm font-medium"
          >
            {isEditing ? "Batal" : "Edit BOM"}
          </button>
        </div>

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
            <Badge variant={recipe.status === "Active" ? "success" : "secondary"} className="mt-1">
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
                  </tr>
                </thead>
                <tbody>
                  {recipe.ingredients.map((ing, i) => (
                    <tr key={i} className="border-b">
                      <td className="px-4 py-2">{ing.ingredientName ?? ing.ingredientId}</td>
                      <td className="px-4 py-2 text-right">{ing.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {recipe.modifierGroups.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Modifier Groups</h2>
            <div className="flex flex-wrap gap-2">
              {recipe.modifierGroups.map((mg) => (
                <Badge key={mg.modifierGroupId} variant="outline">
                  {mg.modifierGroupName ?? mg.modifierGroupId}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </RoleGuard>
  );
}
