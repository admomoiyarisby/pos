import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { Card, CardContent } from "#/components/ui/card";
import { Plus, Trash2, ArrowLeft } from "lucide-react";
import { createProcurement, transitionProcurement } from "#/lib/server/scm-queries";
import { getIngredients } from "#/lib/server/ingredients";

export const Route = createFileRoute("/_layout/scm-procurements/new")({
  component: NewProcurementPage,
});

interface DraftItem {
  ingredientId: string;
  ingredientName: string;
  quantity: number;
}

function NewProcurementPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: ingredients = [] } = useQuery({
    queryKey: ["ingredients"],
    queryFn: () => getIngredients({ data: {} }),
  });

  const [items, setItems] = useState<DraftItem[]>([]);
  const [notes, setNotes] = useState("");
  const [selectedIngredient, setSelectedIngredient] = useState("");
  const [quantity, setQuantity] = useState(1);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (items.length === 0) throw new Error("Tambahkan minimal 1 item");
      const branchId = user?.branchId;
      if (!branchId) throw new Error("User tidak terhubung ke cabang");
      const result = await createProcurement({
        data: {
          branchId,
          items: items.map((it, idx) => ({
            ingredientId: it.ingredientId,
            quantity: it.quantity,
            sortOrder: idx,
          })),
          notes: notes || undefined,
        },
      });
      // Auto-submit so the procurement moves from Draft -> Pending.
      await transitionProcurement({
        data: { procurementId: result.id, event: "submit", payload: {} },
      });
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["scm-procurements"] });
      navigate({ to: "/scm-procurements/$procurementId", params: { procurementId: result.id } });
    },
  });

  function addItem() {
    if (!selectedIngredient || quantity <= 0) return;
    const ing = (ingredients as Array<{ id: string; name: string }>).find((i) => i.id === selectedIngredient);
    if (!ing) return;
    if (items.some((it) => it.ingredientId === ing.id)) return;
    setItems([...items, { ingredientId: ing.id, ingredientName: ing.name, quantity }]);
    setSelectedIngredient("");
    setQuantity(1);
  }

  function removeItem(ingredientId: string) {
    setItems(items.filter((it) => it.ingredientId !== ingredientId));
  }

  return (
    <RoleGuard allowedRoles={["branch_admin", "super_admin"]}>
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Buat Pengadaan</h1>
            <p className="text-sm text-muted-foreground">
              Isi item yang diminta, lalu submit. Pengadaan akan masuk ke antrian review Admin Pusat.
            </p>
          </div>
          <Link to="/scm-procurements">
            <Button variant="ghost">
              <ArrowLeft className="h-4 w-4" />
              Kembali
            </Button>
          </Link>
        </div>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              <Label>Item</Label>
              <div className="flex gap-2">
                <select
                  className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm"
                  value={selectedIngredient}
                  onChange={(e) => setSelectedIngredient(e.target.value)}
                >
                  <option value="">Pilih bahan...</option>
                  {(ingredients as Array<{ id: string; name: string }>).map((ing) => (
                    <option key={ing.id} value={ing.id}>
                      {ing.name}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="w-32"
                />
                <Button onClick={addItem} variant="secondary">
                  <Plus className="h-4 w-4" />
                  Tambah
                </Button>
              </div>
            </div>

            {items.length > 0 ? (
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left">Bahan</th>
                      <th className="px-3 py-2 text-right">Jumlah</th>
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.ingredientId} className="border-b">
                        <td className="px-3 py-2">{it.ingredientName}</td>
                        <td className="px-3 py-2 text-right font-mono">{it.quantity}</td>
                        <td className="px-3 py-2">
                          <Button size="sm" variant="ghost" onClick={() => removeItem(it.ingredientId)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Catatan (opsional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>

            <div className="flex justify-end gap-2">
              <Link to="/scm-procurements">
                <Button variant="ghost">Batal</Button>
              </Link>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={items.length === 0 || createMutation.isPending}
              >
                {createMutation.isPending ? "Menyimpan..." : "Submit Pengadaan"}
              </Button>
            </div>

            {createMutation.isError ? (
              <p className="text-sm text-destructive">{(createMutation.error as Error).message}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </RoleGuard>
  );
}
