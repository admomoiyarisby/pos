import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getModifierGroups, createModifierGroup } from "#/lib/server/modifier-groups";
import { toast } from "sonner";
import type { Column } from "#/components/ui/DataTable";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Card } from "#/components/ui/card";
import { Separator } from "#/components/ui/separator";
import { Switch } from "#/components/ui/switch";
import { Label } from "#/components/ui/label";
import { Badge } from "#/components/ui/badge";
import { ArrowRight, X, Plus } from "lucide-react";

interface ModifierFormInput {
  name: string;
  price: number;
  isExclusion: boolean;
  ingredientId?: string;
  ingredientQty?: number;
}

interface MGRow {
  id: string;
  code: string;
  name: string;
  minSelection: number;
  maxSelection: number;
  modifiers: { id: string; name: string; price: number; isExclusion: boolean }[];
}

const columns: Column<MGRow>[] = [
  { key: "code", header: "Kode", width: "w-24", sortable: true },
  {
    key: "name",
    header: "Nama Grup",
    sortable: true,
    render: (r) => <span className="font-medium">{r.name}</span>,
  },
  { key: "minSelection", header: "Min", width: "w-16", align: "center", sortable: true },
  { key: "maxSelection", header: "Max", width: "w-16", align: "center", sortable: true },
  {
    key: "modifiers",
    header: "Jumlah Opsi",
    width: "w-24",
    align: "center",
    sortable: true,
    render: (r) => <Badge variant="secondary">{r.modifiers.length}</Badge>,
  },
  {
    key: "id",
    header: "",
    width: "w-12",
    render: (r) => (
      <Link
        to="/modifier-groups/$mgId"
        params={{ mgId: r.id }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <ArrowRight className="h-4 w-4" />
      </Link>
    ),
  },
];

export const Route = createFileRoute("/_layout/modifier-groups/")({
  component: ModifierGroupsPage,
  loader: async () => {
    const groups = await getModifierGroups({ data: {} });
    return { groups };
  },
});

function ModifierGroupsPage() {
  const { groups: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [modifiersInput, setModifiersInput] = useState<ModifierFormInput[]>([
    { name: "", price: 0, isExclusion: false },
  ]);

  const { data: groups } = useQuery({
    queryKey: ["modifier-groups"],
    queryFn: () => getModifierGroups({ data: {} }),
    initialData: initial,
  });

  const createMutation = useMutation({
    mutationFn: createModifierGroup,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["modifier-groups"] });
      setModalOpen(false);
      setModifiersInput([
        {
          name: "",
          price: 0,
          isExclusion: false,
          ingredientId: undefined,
          ingredientQty: undefined,
        },
      ]);
      toast.success("Grup modifier berhasil ditambahkan");
    },
    onError: (error: Error) => {
      toast.error("Gagal menambah grup modifier", { description: error.message });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
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
          ingredientId: m.ingredientId || undefined,
          ingredientQty: m.ingredientQty || undefined,
        })),
    };
    void createMutation.mutateAsync({ data });
  };
  usePageTitle("Grup Modifier", "Kelola grup modifier & add-ons menu");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <PageHeader action={{ label: "Tambah Group", onClick: () => setModalOpen(true) }} />

      <DataTable columns={columns} data={groups} keyExtractor={(r) => r.id} />

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setModifiersInput([
            {
              name: "",
              price: 0,
              isExclusion: false,
              ingredientId: undefined,
              ingredientQty: undefined,
            },
          ]);
        }}
        title="Tambah Grup Modifier"
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Kode</Label>
              <Input name="code" required className="h-10 md:h-9" />
            </div>
            <div className="space-y-2">
              <Label>Nama</Label>
              <Input name="name" required className="h-10 md:h-9" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Min Pilihan</Label>
              <Input
                name="minSelection"
                type="number"
                min={0}
                defaultValue={0}
                className="h-10 md:h-9"
              />
            </div>
            <div className="space-y-2">
              <Label>Max Pilihan</Label>
              <Input
                name="maxSelection"
                type="number"
                min={1}
                defaultValue={1}
                className="h-10 md:h-9"
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
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setModalOpen(false);
                setModifiersInput([
                  {
                    name: "",
                    price: 0,
                    isExclusion: false,
                    ingredientId: undefined,
                    ingredientQty: undefined,
                  },
                ]);
              }}
            >
              Batal
            </Button>
            <Button type="submit">Tambah</Button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
