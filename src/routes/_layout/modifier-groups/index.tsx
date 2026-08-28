import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";
import { useTableSearch } from "#/hooks/useTableSearch";
import { formText } from "#/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import Modal from "#/components/ui/Modal";
import {
  getModifierGroups,
  createModifierGroup,
  reorderModifierGroups,
} from "#/lib/server/modifier-groups";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import MoneyInput from "#/components/MoneyInput";
import { Card } from "#/components/ui/card";
import { Separator } from "#/components/ui/separator";
import { Switch } from "#/components/ui/switch";
import { Label } from "#/components/ui/label";
import { Badge } from "#/components/ui/badge";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRight, X, Plus, GripVertical, Search } from "lucide-react";
import ModifierOptionKindEditor, { type ModifierKind } from "#/components/ModifierOptionKindEditor";

interface ModifierFormInput {
  name: string;
  price: number;
  // ADR-0014 kind discriminator.
  kind: ModifierKind;
  isExclusion: boolean;
  ingredientId?: string;
  ingredientQty?: number;
  recipeId?: string;
  recipeQty?: number;
}

interface MGRow {
  id: string;
  code: string;
  name: string;
  minSelection: number;
  maxSelection: number;
  modifiers: { id: string; name: string; price: number; isExclusion: boolean; sortOrder: number }[];
  recipeCount: number;
}

export const Route = createFileRoute("/_layout/modifier-groups/")({
  component: ModifierGroupsPage,
  loader: async () => {
    const groups = await getModifierGroups({ data: {} });
    return { groups };
  },
});

// A thin full-width separator row rendered between table rows during a drag.
// Signals where the dragged modifier group will land on drop.
function DropIndicatorRow() {
  return (
    <tr>
      <td colSpan={7} className="p-0">
        <div className="h-0.5 w-full bg-primary rounded-full" />
      </td>
    </tr>
  );
}

// A single drag-and-drop sortable row in the modifier-groups table. Keyed by
// the group's DB id (stable) so dnd-kit tracks identity correctly.
function SortableGroupRow({ group }: { group: MGRow }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tr ref={setNodeRef} style={style} className="border-b hover:bg-muted/30">
      <td className="w-8 px-2 py-2">
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground inline-flex items-center"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </td>
      <td className="px-4 py-2 text-muted-foreground">{group.code}</td>
      <td className="px-4 py-2">
        <span className="font-medium">{group.name}</span>
      </td>
      <td className="px-4 py-2 text-center">{group.minSelection}</td>
      <td className="px-4 py-2 text-center">{group.maxSelection}</td>
      <td className="px-4 py-2 text-center">
        <Badge variant="secondary">{group.modifiers.length}</Badge>
      </td>
      <td className="px-4 py-2 text-center">
        <Badge variant="outline">{group.recipeCount}</Badge>
      </td>
      <td className="px-4 py-2">
        <Link
          to="/modifier-groups/$mgId"
          params={{ mgId: group.id }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowRight className="h-4 w-4" />
        </Link>
      </td>
    </tr>
  );
}

function ModifierGroupsPage() {
  const { groups: initial } = Route.useLoaderData();
  const [search, setSearch] = useTableSearch();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [modifiersInput, setModifiersInput] = useState<ModifierFormInput[]>([
    { name: "", price: 0, kind: "text", isExclusion: false },
  ]);

  // Tracks the active drag and the row being hovered for the drop-indicator
  // line. Cleared on drop / cancel.
  const [viewDragOverId, setViewDragOverId] = useState<string | null>(null);
  const [viewDragActiveId, setViewDragActiveId] = useState<string | null>(null);

  // Scopes the create modal's option-card list and scrolls a freshly-added
  // option into view. Without this, "Tambah Opsi" appends a blank card below
  // the visible area of the scrollable modal and looks like a no-op.
  const optionsListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const last = modifiersInput[modifiersInput.length - 1];
    if (!last) return;
    const cards = optionsListRef.current?.querySelectorAll("[data-option-card]");
    cards?.[cards.length - 1]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [modifiersInput]);

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
          kind: "text",
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorderMutation = useMutation({
    mutationFn: reorderModifierGroups,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["modifier-groups"] });
    },
    onError: (error: Error) => {
      // Roll back to server truth: invalidate so the cache refetches and the
      // optimistic reorder we wrote is discarded if it diverged.
      void queryClient.invalidateQueries({ queryKey: ["modifier-groups"] });
      toast.error("Gagal mengurutkan grup modifier", { description: error.message });
    },
  });

  // View-mode drag-and-drop: reorders the live group rows directly. Keyed by
  // group id (stable). The cache is updated optimistically before the server
  // round-trip so the row snaps to its new position instantly; onSuccess
  // refetches to confirm, onError refetches to roll back.
  const handleViewDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !groups) return;

    const oldIndex = groups.findIndex((g) => g.id === active.id);
    const newIndex = groups.findIndex((g) => g.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(groups, oldIndex, newIndex);

    queryClient.setQueryData(["modifier-groups"], reordered);

    void reorderMutation.mutateAsync({
      data: {
        modifierGroupIds: reordered.map((g) => g.id),
      },
    });
  };

  const handleViewDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    setViewDragActiveId(String(active.id));
    setViewDragOverId(over ? String(over.id) : null);
  };

  const clearViewDrag = () => {
    setViewDragActiveId(null);
    setViewDragOverId(null);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      code: formText(fd, "code"),
      name: formText(fd, "name"),
      minSelection: Number(fd.get("minSelection")),
      maxSelection: Number(fd.get("maxSelection")),
      modifiers: modifiersInput
        .filter((m) => m.name.trim())
        .map((m) => ({
          name: m.name,
          price: m.price,
          kind: m.kind,
          isExclusion: m.isExclusion,
          ingredientId: m.ingredientId || undefined,
          ingredientQty: m.ingredientQty || undefined,
          recipeId: m.recipeId || undefined,
          recipeQty: m.recipeQty || undefined,
        })),
    };
    void createMutation.mutateAsync({ data });
  };

  // Client-side filter on code/name (mirrors the previous DataTable search).
  const q = search.trim().toLowerCase();
  const filtered = q
    ? (groups ?? []).filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          String(g.code ?? "")
            .toLowerCase()
            .includes(q),
      )
    : (groups ?? []);

  usePageTitle("Grup Modifier", "Kelola grup modifier & add-ons menu");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <div className="space-y-3 mb-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-[380px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              autoComplete="off"
              aria-label="Cari grup modifier"
              placeholder="Cari grup modifier…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-[16px] shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:rounded-lg sm:text-sm"
            />
          </div>
          <Button
            onClick={() => setModalOpen(true)}
            className="w-full sm:w-auto sm:ml-auto h-11 sm:h-9 rounded-xl sm:rounded-md shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Tambah Group
          </Button>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground tabular-nums">{filtered.length} grup</span>
          {filtered.length > 1 && (
            <span className="text-xs text-muted-foreground sm:ml-auto">
              Seret untuk mengurutkan — urutan ini dipakai di POS
            </span>
          )}
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragOver={handleViewDragOver}
          onDragEnd={(e) => {
            handleViewDragEnd(e);
            clearViewDrag();
          }}
          onDragCancel={clearViewDrag}
        >
          <SortableContext items={filtered.map((g) => g.id)} strategy={verticalListSortingStrategy}>
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full caption-bottom text-sm min-w-[640px]">
                <thead className="[&_tr]:border-b">
                  <tr className="border-b transition-colors hover:bg-muted/50">
                    <th className="w-8 px-2 py-2"></th>
                    <th className="h-10 px-3 text-left align-middle font-medium whitespace-nowrap min-w-[80px] text-muted-foreground">
                      Kode
                    </th>
                    <th className="h-10 px-3 text-left align-middle font-medium whitespace-nowrap min-w-[80px] text-muted-foreground">
                      Nama Grup
                    </th>
                    <th className="h-10 px-3 text-center align-middle font-medium whitespace-nowrap min-w-[80px] text-muted-foreground">
                      Min
                    </th>
                    <th className="h-10 px-3 text-center align-middle font-medium whitespace-nowrap min-w-[80px] text-muted-foreground">
                      Max
                    </th>
                    <th className="h-10 px-3 text-center align-middle font-medium whitespace-nowrap min-w-[80px] text-muted-foreground">
                      Jumlah Opsi
                    </th>
                    <th className="h-10 px-3 text-center align-middle font-medium whitespace-nowrap min-w-[80px] text-muted-foreground">
                      Menu Terkait
                    </th>
                    <th className="h-10 px-3 text-left align-middle font-medium whitespace-nowrap min-w-[80px] text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="h-24 text-center text-muted-foreground">
                        Tidak ada data
                      </td>
                    </tr>
                  ) : (
                    filtered.map((g, i) => (
                      <Fragment key={g.id}>
                        {viewDragOverId === g.id && viewDragActiveId !== g.id && i === 0 && (
                          <DropIndicatorRow />
                        )}
                        <SortableGroupRow group={g} />
                        {viewDragOverId === g.id && viewDragActiveId !== g.id && i > 0 && (
                          <DropIndicatorRow />
                        )}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setModifiersInput([
            {
              name: "",
              price: 0,
              kind: "text",
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
                      kind: "text",
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
            <div ref={optionsListRef}>
              {modifiersInput.map((mod, i) => (
                <Card key={i} data-option-card className="p-3 mb-2">
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
                  <ModifierOptionKindEditor
                    draft={{
                      kind: mod.kind,
                      ingredientId: mod.ingredientId,
                      ingredientQty: mod.ingredientQty,
                      recipeId: mod.recipeId,
                      recipeQty: mod.recipeQty,
                    }}
                    onChange={(updates) => {
                      const next = [...modifiersInput];
                      next[i] = { ...next[i], ...updates };
                      setModifiersInput(next);
                    }}
                  />
                  <div className="flex items-center gap-3">
                    {/* The name is derived from the picked ingredient/recipe for
                        those kinds; only text options have a free-text name. */}
                    {mod.kind === "text" && (
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
                    )}
                    <div className={mod.kind === "text" ? "w-24 space-y-1" : "flex-1 space-y-1"}>
                      <Label className="text-xs">Harga</Label>
                      <MoneyInput
                        value={mod.price}
                        onChange={(raw) => {
                          const next = [...modifiersInput];
                          next[i] = { ...next[i], price: raw ?? 0 };
                          setModifiersInput(next);
                        }}
                        className="h-8 w-24"
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
                    kind: "text",
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
