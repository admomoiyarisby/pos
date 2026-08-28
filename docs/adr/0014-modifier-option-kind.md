# Modifier Option Kind (text / ingredient / recipe)

A `Modifier` (an option inside a Modifier Group) is now explicitly one of three **kinds**: `text`, `ingredient`, or `recipe`. The kind is set in the admin UI (create modal + edit form), persisted as an explicit enum column, and drives how the option behaves at the POS — a `text` option is a priced label with no stock/COGS link, while `ingredient` and `recipe` options carry a quantity and are stock-checked/COGS'd at transaction time.

## Status

Accepted

## Considered Options

- **Explicit `kind` enum column (chosen)** — `modifiers.kind` ∈ {`text`, `ingredient`, `recipe`}, with a column-level CHECK on the enum. Makes the option's nature a first-class, machine-readable attribute and the single source of truth for the UI picker and server validation.
- **Implicit kind (no column)** — kind left derived from which join is populated (`modifier_ingredients` / `modifier_recipes` / neither). Rejected: an empty option ("text") is indistinguishable from one whose join was never set, the admin UI can't render a deliberate choice, and nothing prevents inconsistent state (e.g. both joins populated).

## Consequences

- **`modifiers.kind` column** (`text | ingredient | recipe`), not null, with a column-level CHECK on the enum values.
- **Exactly-one-kind invariant** — bounded here by what Postgres can express. A column CHECK cannot count rows in another table, so it **cannot** itself assert "kind=`ingredient` ⟺ exactly one `modifier_ingredients` row." The invariant is therefore enforced by:
  - **Server validation** on create/update (`modifier-groups.ts`): a `kind` must match the joins being written (text → no link; ingredient → exactly one ingredient link, zero recipe links; recipe → one recipe link, zero ingredient links), and conflicting links are rejected/stripped.
  - **Migration backfill** classifying every legacy row from its current joins, so existing data satisfies the invariant when the column lands.
  - Hardening a cross-table trigger is left open (a candidate for a later effort), since a plain CHECK cannot express it.
- **Backfill rule (on the `kind` column migration):** `ingredient` when a `modifier_ingredients` link exists, else `recipe` when a `modifier_recipes` link exists, else `text`. Rows showing _conflicting_ links (both) are classified by the same precedence and the stray link is deleted in the migration, so the invariant holds from day one.
- **`text` is a priced label** — it keeps the existing `price` (e.g. an up-sell note "+Rp 2.000") and has **no** quantity and no stock/COGS link.
- **Exclusion is independent of kind.** `isExclusion` remains a modifier-wide toggle that works for all three kinds. A `text` exclusion is just a label/note option (e.g. "Tanpa Bawang") with nothing to remove; `ingredient`/`recipe` exclusions continue to route through the existing exclusion mechanism.
- **Naming:** code enum strings `'text' | 'ingredient' | 'recipe'`; admin UI labels **Teks / Bahan / Menu**.
- **Read path** (`getModifierGroup`) returns `kind` plus the populated joins so the admin picker renders the current selection and the POS can compute per-option stock.
