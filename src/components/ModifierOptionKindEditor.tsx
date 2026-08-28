import { useQuery } from "@tanstack/react-query";
import { getIngredients } from "#/lib/server/ingredients";
import { getRecipes } from "#/lib/server/recipes";
import { Label } from "#/components/ui/label";
import { Input } from "#/components/ui/input";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "#/components/ui/combobox";

export type ModifierKind = "text" | "ingredient" | "recipe";

const KIND_OPTIONS: { value: ModifierKind; label: string }[] = [
  { value: "text", label: "Teks" },
  { value: "ingredient", label: "Bahan" },
  { value: "recipe", label: "Menu" },
];

export interface ModifierKindDraft {
  kind: ModifierKind;
  // Derived display name: for ingredient/recipe kinds this is filled from the
  // picked item so the parent's Nama field (hidden for those kinds) stays in
  // sync with what gets saved and shown at the POS.
  name?: string;
  ingredientId?: string;
  ingredientQty?: number;
  recipeId?: string;
  recipeQty?: number;
}

interface IngredientOption {
  id: string;
  name: string;
}

interface RecipeOption {
  id: string;
  name: string;
}

const EMPTY_DRAFT: ModifierKindDraft = { kind: "text" };

/**
 * Lets a modifier option pick one of three kinds — text (priced label),
 * ingredient (+qty), or recipe (+qty) — per ADR-0014. Renders a small
 * segmented control plus the conditional ingredient/recipe picker. The parent
 * owns the outer form fields (name/price/exclusion) and this drives `draft`.
 */
export default function ModifierOptionKindEditor({
  draft,
  onChange,
}: {
  draft: ModifierKindDraft;
  onChange: (updates: Partial<ModifierKindDraft>) => void;
}) {
  const { data: ingredients } = useQuery({
    queryKey: ["ingredients"],
    queryFn: () => getIngredients({ data: {} }),
  });
  const { data: recipes } = useQuery({
    queryKey: ["recipes"],
    queryFn: () => getRecipes({ data: {} }),
  });

  const ingredientOptions: IngredientOption[] = (ingredients ?? []).map((g: any) => ({
    id: g.id,
    name: g.name,
  }));
  const recipeOptions: RecipeOption[] = (recipes ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
  }));

  const selectedIngredient = ingredientOptions.find((o) => o.id === draft.ingredientId) ?? null;
  const selectedRecipe = recipeOptions.find((o) => o.id === draft.recipeId) ?? null;

  return (
    <div className="space-y-2">
      {/* Segmented control — the primary decision. Track is muted, the active
          segment is a raised surface (iOS-style), and switching kind clears
          both kinds' links so exactly-one-kind holds on save. */}
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {KIND_OPTIONS.map((opt) => {
          const active = draft.kind === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() =>
                onChange({
                  kind: opt.value,
                  ingredientId: undefined,
                  ingredientQty: undefined,
                  recipeId: undefined,
                  recipeQty: undefined,
                })
              }
              className={
                "h-8 rounded-md text-sm font-medium transition-colors " +
                (active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {draft.kind === "text" && (
        <div className="space-y-1">
          <Label className="text-xs">Nama</Label>
          <Input
            value={draft.name ?? ""}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Contoh: Level Pedas 1"
            required
          />
        </div>
      )}

      {draft.kind === "ingredient" && (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Bahan</Label>
            <Combobox
              value={selectedIngredient}
              onValueChange={(val) => {
                // SAFETY: the combobox is fed ingredientOptions, so a non-null
                // value is always one of those IngredientOption values.
                const picked = val as IngredientOption | null;
                onChange({
                  ingredientId: picked?.id,
                  ingredientQty: picked ? (draft.ingredientQty ?? 1) : undefined,
                  name: picked?.name ?? "",
                });
              }}
              items={ingredientOptions}
              itemToStringValue={(item: IngredientOption | null) => item?.id ?? ""}
              itemToStringLabel={(item: IngredientOption | null) => item?.name ?? ""}
              isItemEqualToValue={(a, b) => a?.id === b?.id}
            >
              <ComboboxInput showTrigger showClear placeholder="Cari bahan…" className="w-full" />
              <ComboboxContent>
                <ComboboxList>
                  {(item: IngredientOption) => (
                    <ComboboxItem key={item.id} value={item}>
                      <span>{item.name}</span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
                <ComboboxEmpty>Tidak ada bahan yang cocok</ComboboxEmpty>
              </ComboboxContent>
            </Combobox>
          </div>
          <div className="w-20 space-y-1">
            <Label className="text-xs">Qty</Label>
            <Input
              type="number"
              min={0}
              step="any"
              value={draft.ingredientQty ?? 1}
              onChange={(e) => onChange({ ingredientQty: Number(e.target.value) })}
              disabled={!draft.ingredientId}
              className="h-9"
            />
          </div>
        </div>
      )}

      {draft.kind === "recipe" && (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Menu</Label>
            <Combobox
              value={selectedRecipe}
              onValueChange={(val) => {
                // SAFETY: the combobox is fed recipeOptions, so a non-null
                // value is always one of those RecipeOption values.
                const picked = val as RecipeOption | null;
                onChange({
                  recipeId: picked?.id,
                  recipeQty: picked ? (draft.recipeQty ?? 1) : undefined,
                  name: picked?.name ?? "",
                });
              }}
              items={recipeOptions}
              itemToStringValue={(item: RecipeOption | null) => item?.id ?? ""}
              itemToStringLabel={(item: RecipeOption | null) => item?.name ?? ""}
              isItemEqualToValue={(a, b) => a?.id === b?.id}
            >
              <ComboboxInput showTrigger showClear placeholder="Cari menu…" className="w-full" />
              <ComboboxContent>
                <ComboboxList>
                  {(item: RecipeOption) => (
                    <ComboboxItem key={item.id} value={item}>
                      <span>{item.name}</span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
                <ComboboxEmpty>Tidak ada menu yang cocok</ComboboxEmpty>
              </ComboboxContent>
            </Combobox>
          </div>
          <div className="w-20 space-y-1">
            <Label className="text-xs">Qty</Label>
            <Input
              type="number"
              min={0}
              step="any"
              value={draft.recipeQty ?? 1}
              onChange={(e) => onChange({ recipeQty: Number(e.target.value) })}
              disabled={!draft.recipeId}
              className="h-9"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export { EMPTY_DRAFT };
