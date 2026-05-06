import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { getIngredient, updateIngredient } from "#/lib/server/ingredients";

export const Route = createFileRoute("/_layout/ingredients/$ingId")({
  component: IngredientDetailPage,
  loader: async ({ params }) => {
    const ingredient = await getIngredient({ data: { id: params.ingId } });
    return { ingredient };
  },
});

function IngredientDetailPage() {
  const { ingredient: initial } = Route.useLoaderData();
  const { ingId } = Route.useParams();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);

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
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      id: ingId,
      code: fd.get("code") as string,
      name: fd.get("name") as string,
      category: fd.get("category") as "Fresh" | "Dry" | "Packaging",
      skuType: fd.get("skuType") as "RM" | "SFG" | "FG",
      purchaseUnit: fd.get("purchaseUnit") as string,
      stockUnit: fd.get("stockUnit") as string,
      conversionFactor: Number(fd.get("conversionFactor")),
      averageCost: Number(fd.get("averageCost")),
      rop: Number(fd.get("rop")),
      moq: Number(fd.get("moq")),
    };
    void updateMutation.mutateAsync({ data });
  };

  if (!ingredient) {
    return <div className="text-muted-foreground">Bahan tidak ditemukan</div>;
  }

  const skuLabels: Record<string, string> = {
    RM: "Raw Material",
    SFG: "Semi-Finished",
    FG: "Finished Goods",
  };

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "central_kitchen"]}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">{ingredient.name}</h1>
            <p className="text-sm text-muted-foreground">Kode: {ingredient.code}</p>
          </div>
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="h-9 px-4 rounded-md border text-sm font-medium"
          >
            {isEditing ? "Batal" : "Edit"}
          </button>
        </div>

        {isEditing ? (
          <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Kode</label>
                <input
                  name="code"
                  defaultValue={ingredient.code}
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Nama</label>
                <input
                  name="name"
                  defaultValue={ingredient.name}
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Tipe SKU</label>
                <select
                  name="skuType"
                  defaultValue={ingredient.skuType}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Satuan Stok</label>
                <input
                  name="stockUnit"
                  defaultValue={ingredient.stockUnit}
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Konversi</label>
                <input
                  name="conversionFactor"
                  type="number"
                  min={1}
                  defaultValue={ingredient.conversionFactor}
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">HPP (Rp)</label>
                <input
                  name="averageCost"
                  type="number"
                  min={0}
                  defaultValue={ingredient.averageCost}
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">ROP</label>
                <input
                  name="rop"
                  type="number"
                  min={0}
                  defaultValue={ingredient.rop}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">MOQ</label>
              <input
                name="moq"
                type="number"
                min={1}
                defaultValue={ingredient.moq}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="submit"
                className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
              >
                Simpan
              </button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground uppercase">Tipe SKU</p>
              <p className="font-medium mt-1">{skuLabels[ingredient.skuType]}</p>
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
        )}
      </div>
    </RoleGuard>
  );
}
