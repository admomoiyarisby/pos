# POS Item Modifiers — Comprehensive Implementation Plan

## Problem Statement

The current POS page (`src/routes/_layout/pos.tsx`) has been reset to a placeholder. The **modifier modal flow** — where clicking a menu item opens a configuration dialog for modifiers (spicy level, toppings, exclusions) before adding to cart — must be rebuilt from scratch, matching the old prototype's behavior exactly.

### What the Prototype Did (and what must be replicated)

```
┌─ Menu Grid ─────────────────────────────┐
│ ┌─ Card ───────────────────────────┐   │
│ │ Nasi Goreng                [ ＋ ] │   │  ← "+" icon appears on hover
│ │ Rp 35,000                         │   │  ← entire card is clickable
│ │ + Modifiers                       │   │
│ └───────────────────────────────────┘   │
└─────────────────────────────────────────┘
              ↓ click card or "+"
┌─ Modifier Modal ────────────────────────┐
│ Nasi Goreng                    ✕        │
│ Rp 35,000                               │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│ Level Pedas                    Wajib    │
│ ○ Tidak Pedas                           │
│ ● Sedang                                │  ← radio selection (max 1)
│ ○ Pedas                                 │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│ Topping                        Opsional │
│ ☑ Extra Telur                  +Rp 5K   │  ← checkbox (multi)
│ ☐ Extra Sosis                  +Rp 7K   │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│ Tanpa                          Opsional │
│ ☑ Tanpa Bawang                 Exclude  │  ← exclusion (amber style)
│ ☐ Tanpa Sambal                 Exclude  │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│ Catatan: ____________________________   │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│ Total Tambahan    Rp 5,000              │
│                   [Tambah ke Keranjang] │  ← disabled if Wajib not met
└─────────────────────────────────────────┘
              ↓ confirm
┌─ Cart ──────────────────────────────────┐
│ Nasi Goreng                    ✕        │
│ 🟢 Extra Telur  🔶 Tanpa Bawang         │  ← modifier badges
│ "Pedas ya"                              │  ← item notes
│ － 1 ＋           Rp 40,000             │
│ ────────────────────────────────────────│
│ Nasi Goreng                    ✕        │  ← SAME recipe, DIFFERENT
│ 🟢 Extra Sosis                          │     modifiers = SEPARATE
│ － 1 ＋           Rp 42,000             │     cart entry
└─────────────────────────────────────────┘
```

---

## Step 1: Menu Item Card with "+" Button

### File: `src/routes/_layout/pos.tsx`

Each menu item in the grid must have a **visible "+" affordance** that makes it obvious the item can be added.

### Card markup:

```tsx
<button
  key={item.id}
  onClick={() => handleAddToCart(item)}
  disabled={isOutOfStock}
  className="group relative rounded-lg border bg-card p-3 text-left transition-all hover:border-primary hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
>
  {/* Out of stock overlay */}
  {isOutOfStock && ...}

  {/* Image area */}
  <div className="aspect-square mb-2 rounded-md bg-muted flex items-center justify-center relative">
    {item.imageUrl ? (...) : (...)}

    {/* + icon overlay — visible on hover */}
    <div className="absolute bottom-2 right-2 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
      <Plus className="h-4 w-4" />
    </div>
  </div>

  {/* Name + Price */}
  <p className="text-sm font-medium leading-tight line-clamp-2">{item.name}</p>
  <p className="text-sm font-semibold text-primary mt-1">
    Rp {item.basePrice.toLocaleString("id-ID")}
  </p>

  {/* Modifier badge */}
  {item.modifierGroups.length > 0 && (
    <Badge variant="outline" className="mt-1 text-[10px]">
      + {item.modifierGroups.length} Modifiers
    </Badge>
  )}
</button>
```

**Key points:**

- The **entire card is clickable** — clicking anywhere triggers `handleAddToCart`
- A **circular "+" button** appears on hover in the bottom-right of the image area
- This is a **visual affordance**, not a separate click target (the whole card handles the click)
- The prototype used `opacity-0 group-hover:opacity-100` on a `Plus` icon in the top-right; we use a more prominent circular button in the bottom-right of the image

---

## Step 2: The `handleAddToCart` Flow

### This is the critical entry point. It must branch based on whether the item has modifiers.

```tsx
const handleAddToCart = (item: MenuItem) => {
  setCheckoutError(null);
  setStockError(null);

  // Stock check (already documented in pos-feature.md)
  const availableServings = getStockQuantity(item, branchInventory);
  const inCart = cart.filter((c) => c.recipeId === item.id).reduce((sum, c) => sum + c.quantity, 0);
  if (availableServings <= inCart) {
    setStockError(`Stok tidak mencukupi untuk ${item.name}`);
    return;
  }

  // ─── BRANCH: item has modifiers → open modal ───
  if (item.modifierGroups.length > 0) {
    setModifierModal({
      item,
      selectedModifiers: [], // start empty; Step 3 adds defaults for required groups
      itemNotes: "",
    });
    return;
  }

  // ─── BRANCH: no modifiers → add directly ───
  addItemToCart(item, [], "");
};
```

**This is the flow the user is asking about.** Clicking the card (or the "+" hover button):

1. Checks stock
2. If item has `modifierGroups.length > 0` → opens modifier modal
3. If no modifiers → adds directly to cart

---

## Step 3: Modifier Modal — Full Specification

### State management:

```tsx
const [modifierModal, setModifierModal] = useState<{
  item: MenuItem;
  selectedModifiers: {
    groupId: string;
    modifierId: string;
    name: string;
    price: number;
    isExclusion: boolean;
  }[];
  itemNotes: string;
} | null>(null);
```

### The Modal Component (`ModifierModal`)

**Trigger:** `modifierModal !== null`

**Layout:**

```
┌─ Modal (centered, max-w-md) ────────────┐
│ Header: item name + price + close ✕     │
│ ────────────────────────────────────────│
│ Modifier Group 1 (Wajib • Pilih 1)      │
│   ○ option A                    +Rp 0   │
│   ● option B                    +Rp 3K  │  ← selected
│ ────────────────────────────────────────│
│ Modifier Group 2 (Opsional • Maks 3)    │
│   ☑ option C                    +Rp 5K  │
│   ☐ option D                    +Rp 7K  │
│ ────────────────────────────────────────│
│ Modifier Group 3 (Opsional)             │
│   ☑ Tanpa Bawang            🚫 Exclude  │  ← amber exclusion style
│   ☐ Tanpa Sambal            🚫 Exclude  │
│ ────────────────────────────────────────│
│ Catatan Item:                           │
│ ┌─────────────────────────────────────┐ │
│ │ Pisah sambal, jangan pakai sayur... │ │
│ └─────────────────────────────────────┘ │
│ ────────────────────────────────────────│
│ Total Tambahan    Rp 12,000             │
│ [Tambah ke Keranjang]                   │  ← disabled if validation fails
└─────────────────────────────────────────┘
```

### Default selections (required groups):

When the modal opens, **automatically pre-select** the first modifier in any group where `minSelection > 0`:

```tsx
// Inside ModifierModal, initialize selected state:
const [selected, setSelected] = useState(() => {
  const defaults: ModifierModal["selectedModifiers"] = [];
  for (const group of modal.item.modifierGroups) {
    if ((group.minSelection ?? 0) > 0 && group.modifiers.length > 0) {
      const first = group.modifiers[0];
      defaults.push({
        groupId: group.modifierGroupId,
        modifierId: first.id,
        name: first.name,
        price: first.price ?? 0,
        isExclusion: first.isExclusion ?? false,
      });
    }
  }
  return defaults;
});
```

### Selection behavior:

| `maxSelection` | Behavior                                             | Visual           |
| -------------- | ---------------------------------------------------- | ---------------- |
| `1`            | Radio — selecting one deselects others in same group | Filled circle    |
| `> 1`          | Checkbox — can select up to `maxSelection`           | Checkmark square |

```tsx
const toggleModifier = (
  groupId: string,
  modifierId: string,
  name: string,
  price: number,
  isExclusion: boolean,
  maxSelection: number,
) => {
  const existing = selected.filter((s) => s.groupId === groupId);
  const hasThis = existing.some((s) => s.modifierId === modifierId);

  if (hasThis) {
    // Deselect
    setSelected(selected.filter((s) => !(s.groupId === groupId && s.modifierId === modifierId)));
  } else if (maxSelection === 1) {
    // Radio: replace all in group
    setSelected([
      ...selected.filter((s) => s.groupId !== groupId),
      { groupId, modifierId, name, price, isExclusion },
    ]);
  } else {
    // Checkbox: add if under max
    if (existing.length < maxSelection) {
      setSelected([...selected, { groupId, modifierId, name, price, isExclusion }]);
    }
  }
};
```

### Validation before confirm:

```tsx
const isValid = modal.item.modifierGroups.every((group) => {
  const count = selected.filter((s) => s.groupId === group.modifierGroupId).length;
  return count >= (group.minSelection ?? 0);
});
```

If `!isValid`, show inline error under violating groups and disable "Tambah ke Keranjang".

### Modifier option card styling:

```tsx
<div
  onClick={() => toggleModifier(...)}
  className={cn(
    "flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer",
    isSelected
      ? mod.isExclusion
        ? "bg-amber-50 border-amber-200 ring-1 ring-amber-200"
        : "bg-emerald-50 border-emerald-200 ring-1 ring-emerald-200"
      : "bg-card border-border hover:bg-muted",
  )}
>
  <div className="flex items-center gap-3">
    {/* Radio or Checkbox */}
    <div className={cn(
      "flex items-center justify-center border transition-colors",
      isSingleChoice ? "w-5 h-5 rounded-full" : "w-5 h-5 rounded",
      isSelected
        ? mod.isExclusion ? "bg-amber-600 border-amber-600" : "bg-emerald-600 border-emerald-600"
        : "bg-card border-border",
    )}>
      {isSelected && (
        isSingleChoice
          ? <div className="w-2 h-2 rounded-full bg-white" />
          : <Check className="w-3 h-3 text-white" />
      )}
    </div>
    <span className={cn("text-sm font-medium", isSelected && "text-emerald-900")}>
      {mod.name}
    </span>
  </div>
  {mod.price > 0 && !mod.isExclusion && (
    <span className="text-xs font-bold text-emerald-600">
      +Rp {mod.price.toLocaleString("id-ID")}
    </span>
  )}
  {mod.isExclusion && (
    <span className="text-xs font-bold text-amber-600">Exclude</span>
  )}
</div>
```

---

## Step 4: Adding to Cart with Modifiers

### The `addItemToCart` function:

```tsx
const addItemToCart = (item: MenuItem, modifiers: CartItem["modifiers"], itemNotes: string) => {
  const modPrice = modifiers.reduce((sum, m) => sum + m.price, 0);

  // Check if an IDENTICAL item (same recipe + same modifiers + same notes) already exists
  const existingIdx = cart.findIndex((c) => {
    if (c.recipeId !== item.id) return false;
    if (c.notes !== itemNotes) return false;
    const a = c.modifiers.map((m) => m.modifierId).sort();
    const b = modifiers.map((m) => m.modifierId).sort();
    return JSON.stringify(a) === JSON.stringify(b);
  });

  if (existingIdx >= 0) {
    // Same configuration exists → increment quantity
    const updated = [...cart];
    updated[existingIdx].quantity += 1;
    setCart(updated);
  } else {
    // New configuration → new cart entry
    setCart([
      ...cart,
      {
        recipeId: item.id,
        brandId: item.brands[0]?.id ?? "",
        name: item.name,
        price: item.basePrice + modPrice,
        quantity: 1,
        modifiers,
        notes: itemNotes,
      },
    ]);
  }

  setModifierModal(null); // close modal
};
```

**Critical:** Same recipe name with DIFFERENT modifiers = **separate cart row**. This is the whole point of the modifier system.

---

## Step 5: Cart Display with Modifier Badges

### Each cart item must show its modifiers as colored pills:

```tsx
// Inside cart item card:
{
  item.modifiers.length > 0 && (
    <div className="flex flex-wrap gap-1 mt-1">
      {item.modifiers.map((m, mi) => (
        <span
          key={mi}
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded border",
            m.isExclusion
              ? "bg-amber-50 text-amber-700 border-amber-100"
              : "bg-emerald-50 text-emerald-700 border-emerald-100",
          )}
        >
          {m.isExclusion ? "🚫 " : ""}
          {m.name}
        </span>
      ))}
    </div>
  );
}

{
  item.notes && (
    <p className="text-[10px] text-muted-foreground italic mt-0.5 truncate">"{item.notes}"</p>
  );
}
```

---

## Step 6: Data Layer Changes

### Server: `src/lib/server/pos.ts` — `getPosMenu`

Must return modifier groups with full modifier details:

```ts
modifierGroups: {
  modifierGroupId: string;
  groupName: string | null;
  minSelection: number | null;
  maxSelection: number | null;
  modifiers: {
    id: string;
    name: string;
    price: number;
    isExclusion: boolean;
  }
  [];
}
[];
```

### Type: `MenuItem` in pos.tsx

```ts
interface MenuItem {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  category: string;
  basePrice: number;
  brands: { id: string; name: string | null }[];
  modifierGroups: ModifierGroup[];
  ingredientIds: { ingredientId: string; quantity: number }[];
}
```

### CartItem type:

```ts
interface CartItem {
  recipeId: string;
  brandId: string;
  name: string;
  price: number;
  quantity: number;
  modifiers: {
    groupId: string;
    modifierId: string;
    name: string;
    price: number;
    isExclusion: boolean;
  }[];
  notes: string;
}
```

---

## Step 7: Server — Persist Modifiers and Exclusions in Order

### `createOrder` must accept modifier data:

```ts
items: z.array(
  z.object({
    recipeId: z.string().uuid(),
    brandId: z.string().uuid(),
    quantity: z.number().int().min(1),
    price: z.number().int().min(0),
    selectedModifiers: z
      .array(
        z.object({
          groupId: z.string().uuid(),
          modifierId: z.string().uuid(),
          price: z.number().int().min(0),
          isExclusion: z.boolean().optional(),
        }),
      )
      .optional(),
    notes: z.string().optional(),
  }),
);
```

### Insert modifiers into `orderItemModifiers`:

```ts
for (const mod of item.selectedModifiers ?? []) {
  await db.insert(orderItemModifiers).values({
    orderItemId: orderItem.id,
    modifierGroupId: mod.groupId,
    modifierId: mod.modifierId,
  });
}
```

### Insert exclusions into `orderItemExclusions`:

```ts
for (const mod of item.selectedModifiers ?? []) {
  if (!mod.isExclusion) continue;

  const [exclusion] = await db
    .select()
    .from(recipeModifierExclusions)
    .where(
      and(
        eq(recipeModifierExclusions.recipeId, item.recipeId),
        eq(recipeModifierExclusions.modifierId, mod.modifierId),
      ),
    )
    .limit(1);

  if (exclusion) {
    await db.insert(orderItemExclusions).values({
      orderItemId: orderItem.id,
      ingredientId: exclusion.ingredientId,
      quantity: exclusion.quantity * item.quantity,
    });
  }
}
```

---

## Step 8: Complete Flow Diagram

```
User sees menu grid
       ↓
User clicks card (or hovers and clicks "+" icon)
       ↓
handleAddToCart(item)
       ↓
┌─ Has modifiers? ─┐
│ Yes               │ → open ModifierModal
│ No                │ → addItemToCart(item, [], "")
└───────────────────┘
       ↓ (modifier path)
ModifierModal opens with:
  • Default selections pre-filled for required groups
  • User picks/deselects modifiers
  • User types item notes
       ↓
User clicks "Tambah ke Keranjang"
  (disabled if required groups not met)
       ↓
addItemToCart(item, selectedModifiers, notes)
       ↓
┌─ Identical config already in cart? ─┐
│ Yes                                  │ → quantity += 1
│ No                                   │ → new cart entry
└──────────────────────────────────────┘
       ↓
Cart sidebar updates:
  • New/modified row shown
  • Modifier badges rendered as emerald/amber pills
  • Item notes shown in italic
       ↓
User can click same menu item again with DIFFERENT modifiers
→ Creates a SEPARATE cart row (different identity)
```

---

## Files to Modify

| File                         | Changes                                                                                                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/_layout/pos.tsx` | Add "+" hover button to menu cards; implement `handleAddToCart` branching; build full `ModifierModal` with radio/checkbox visuals, validation, default selections; update `addItemToCart` with modifier deduplication; render modifier badges in cart |
| `src/lib/server/pos.ts`      | Include full `modifierGroups` with `isExclusion` in `getPosMenu`; accept `selectedModifiers` + `isExclusion` in `createOrder`; persist to `orderItemModifiers` and `orderItemExclusions`                                                              |
| `src/lib/seed/seed-data.ts`  | Add exclusion modifiers (Tanpa Bawang, Tanpa Sambal, etc.) and `RECIPE_MODIFIER_EXCLUSIONS` mappings                                                                                                                                                  |
| `src/lib/seed/seed.ts`       | Seed `recipeModifierExclusions` table                                                                                                                                                                                                                 |

---

## Verification Checklist

- [ ] `vp check --fix` passes with zero errors
- [ ] `vp build` succeeds
- [ ] Hovering over a menu item card shows a circular "+" button on the image
- [ ] Clicking a menu item **without** modifiers adds it directly to cart (no modal)
- [ ] Clicking a menu item **with** modifiers opens the Modifier Modal
- [ ] Modal shows correct group labels with "Wajib" / "Opsional" indicators
- [ ] Required groups (`minSelection > 0`) have the first option pre-selected by default
- [ ] Single-choice groups show radio circles; multi-choice show checkboxes
- [ ] Exclusion modifiers show amber/orange styling with "Exclude" label
- [ ] "Tambah ke Keranjang" is disabled if any required group has insufficient selections
- [ ] Adding item with modifiers creates a cart row showing modifier badges
- [ ] Adding the **same** item with the **same** modifiers increments quantity
- [ ] Adding the **same** item with **different** modifiers creates a new cart row
- [ ] Cart item notes appear in italic below modifier badges
- [ ] Order is saved with `orderItemModifiers` and `orderItemExclusions` records
- [ ] Receipt print includes modifier names and exclusion notes
