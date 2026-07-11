import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Card } from "#/components/ui/card";
import { Separator } from "#/components/ui/separator";
import { Switch } from "#/components/ui/switch";
import { Label } from "#/components/ui/label";
import Modal from "#/components/ui/Modal";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  getModifierGroup,
  updateModifierGroup,
  deleteModifierGroup,
} from "#/lib/server/modifier-groups";
import { X, Plus, Pencil, Trash2 } from "lucide-react";

interface ModifierFormInput {
  name: string;
  price: number;
  isExclusion: boolean;
  ingredientId?: string;
  ingredientQty?: number;
}

export const Route = createFileRoute("/_layout/modifier-groups/$mgId")({
  component: ModifierGroupDetailPage,
  loader: async ({ params }) => {
    const group = await getModifierGroup({ data: { id: params.mgId } });
    return { group };
  },
});

function ModifierGroupDetailPage() {
  const { group: initial } = Route.useLoaderData();
  const { mgId } = Route.useParams();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: group } = useQuery({
    queryKey: ["modifier-group", mgId],
    queryFn: () => getModifierGroup({ data: { id: mgId } }),
    initialData: initial,
  });

  const [modifiersInput, setModifiersInput] = useState<ModifierFormInput[]>([]);

  // Reset form when entering edit mode
  const startEditing = () => {
    if (group) {
      setModifiersInput(
        group.modifiers.map((m: any) => ({
          name: m.name,
          price: m.price,
          isExclusion: m.isExclusion,
        })),
      );
    }
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setModifiersInput([]);
  };

  const navigate = useNavigate();

  const updateMutation = useMutation({
    mutationFn: updateModifierGroup,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["modifier-group", mgId] });
      void queryClient.invalidateQueries({ queryKey: ["modifier-groups"] });
      setIsEditing(false);
      toast.success("Grup modifier berhasil diperbarui");
    },
    onError: (error: Error) => {
      toast.error("Gagal memperbarui grup modifier", { description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteModifierGroup,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["modifier-groups"] });
      setDeleteOpen(false);
      toast.success("Grup modifier berhasil dihapus");
      void navigate({ to: "/modifier-groups" });
    },
    onError: (error: Error) => {
      toast.error("Gagal menghapus grup modifier", { description: error.message });
    },
  });

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!group) return;
    const fd = new FormData(e.currentTarget);
    void updateMutation.mutateAsync({
      data: {
        id: mgId,
        code: fd.get("code") as string,
        name: fd.get("name") as string,
        minSelection: Number(fd.get("minSelection")),
        maxSelection: Number(fd.get("maxSelection")),
        modifiers: modifiersInput
          .filter((m) => m.name.trim())
          .map((m) => ({
            name: m.name,
            price: m.price,
            isExclusion: m.isExclusion,
          })),
      },
    });
  };

  usePageTitle(group?.name ?? "Detail Grup Modifier", "Detail dan edit grup modifier");

  if (!group) {
    return <div className="text-muted-foreground">Grup modifier tidak ditemukan</div>;
  }

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{group.name}</h1>
            <p className="text-sm text-muted-foreground">Kode: {group.code}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setDeleteOpen(true)}
              className="h-10 md:h-9 px-3 rounded-md border text-sm text-destructive flex items-center gap-1.5 hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" /> Hapus
            </button>
            {isEditing ? (
              <button
                onClick={cancelEditing}
                className="h-10 md:h-9 px-4 rounded-md border text-sm"
              >
                Batal
              </button>
            ) : (
              <button
                onClick={startEditing}
                className="h-10 md:h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm flex items-center gap-1.5"
              >
                <Pencil className="h-4 w-4" /> Edit
              </button>
            )}
          </div>
        </div>

        {isEditing ? (
          <form onSubmit={handleSave} className="space-y-4 max-w-xl">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Kode</Label>
                <Input name="code" defaultValue={group.code} required />
              </div>
              <div className="space-y-2">
                <Label>Nama</Label>
                <Input name="name" defaultValue={group.name} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min Pilihan</Label>
                <Input
                  name="minSelection"
                  type="number"
                  min={0}
                  defaultValue={group.minSelection}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Pilihan</Label>
                <Input
                  name="maxSelection"
                  type="number"
                  min={1}
                  defaultValue={group.maxSelection}
                />
              </div>
            </div>

            <Separator />

            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="font-semibold">Opsi Modifier</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setModifiersInput([
                      ...modifiersInput,
                      {
                        name: "",
                        price: 0,
                        isExclusion: false,
                        ingredientId: undefined,
                        ingredientQty: undefined,
                      },
                    ])
                  }
                >
                  <Plus className="h-3 w-3 mr-1" /> Tambah Opsi
                </Button>
              </div>
              {modifiersInput.map((mod, i) => (
                <Card key={i} className="p-3 mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground">Opsi #{i + 1}</span>
                    {modifiersInput.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setModifiersInput(modifiersInput.filter((_, j) => j !== i))}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Nama</Label>
                      <Input
                        value={mod.name}
                        onChange={(e) => {
                          const next = [...modifiersInput];
                          next[i] = { ...next[i], name: e.target.value };
                          setModifiersInput(next);
                        }}
                        required
                      />
                    </div>
                    <div className="w-24 space-y-1">
                      <Label className="text-xs">Harga</Label>
                      <Input
                        type="number"
                        min={0}
                        value={mod.price}
                        onChange={(e) => {
                          const next = [...modifiersInput];
                          next[i] = { ...next[i], price: Number(e.target.value) };
                          setModifiersInput(next);
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <Switch
                        checked={mod.isExclusion}
                        onCheckedChange={(checked) => {
                          const next = [...modifiersInput];
                          next[i] = { ...next[i], isExclusion: checked };
                          setModifiersInput(next);
                        }}
                      />
                      <Label className="text-xs">Exclusion</Label>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={cancelEditing}>
                Batal
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="p-4">
                <p className="text-xs text-muted-foreground uppercase">Min Pilihan</p>
                <p className="font-medium mt-1">{group.minSelection}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-muted-foreground uppercase">Max Pilihan</p>
                <p className="font-medium mt-1">{group.maxSelection}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-muted-foreground uppercase">Jumlah Opsi</p>
                <p className="font-medium mt-1">{group.modifiers.length}</p>
              </Card>
            </div>

            <Separator />

            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Opsi Modifier</h2>
              {group.modifiers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Tidak ada opsi</p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-sm min-w-[480px]">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Nama Opsi</th>
                        <th className="px-4 py-2 text-right font-medium">Harga Pengantar</th>
                        <th className="px-4 py-2 text-center font-medium">Exclusion</th>
                        <th className="px-4 py-2 text-left font-medium">Bahan Baku</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.modifiers.map((mod: any) => (
                        <tr key={mod.id} className="border-b">
                          <td className="px-4 py-2">{mod.name}</td>
                          <td className="px-4 py-2 text-right">
                            {mod.price > 0 ? `Rp ${mod.price.toLocaleString("id-ID")}` : "—"}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {mod.isExclusion ? (
                              <Badge variant="destructive" className="text-[10px]">
                                Exclusion
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">
                                Regular
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {mod.ingredients?.length > 0 ? (
                              <div className="ml-4 pl-4 border-l-2 border-border space-y-0.5">
                                {mod.ingredients.map((mi: any) => (
                                  <div key={mi.id}>
                                    {mi.ingredientId} × {mi.quantity}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* Delete confirmation modal */}
        <Modal
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          title="Hapus Grup Modifier"
          size="sm"
        >
          <p className="text-sm text-muted-foreground mb-4">
            Apakah Anda yakin ingin menghapus grup modifier "{group.name}"? Tindakan ini tidak dapat
            dibatalkan.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void deleteMutation.mutateAsync({ data: { id: mgId } });
                setDeleteOpen(false);
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Menghapus..." : "Hapus"}
            </Button>
          </div>
        </Modal>
      </div>
    </RoleGuard>
  );
}
