# Recipe Soft-Delete Tombstone (`Deleted` status)

Recipes gained a three-state lifecycle — `Active ⇄ Inactive → Deleted` (ADR-0009). Deletion is a UI-irreversible soft delete: the row and all history (orders, COGS, audit) are preserved, but the recipe is invisible everywhere in the UI and can only be restored via a direct database operation. The prior one-way "Nonaktifkan" (deactivate) finally got its `Aktifkan` (reactivate) counterpart, so `Inactive` is now a properly reversible state.

## Status

Accepted

## Considered Options

- **Three states, `Deleted` as soft tombstone (chosen)** — `Active ⇄ Inactive` reversible toggle, plus a `Deleted` tombstone that is hard to reverse but still keeps the row. Preserves historical orders and COGS while giving a "gone from my menu" feel.
- **Two reversible states only** — no permanent removal at all; "delete" becomes a misnomer and users can't truly purge a recipe.
- **Two states + true row hard-delete** — matches "delete" literally but silently breaks sales history and COGS reporting for any recipe referenced in past orders.

## Consequences

- `recipes.status` moved off the shared `ingredient_status` enum onto a dedicated `recipe_status` enum (`Active` / `Inactive` / `Deleted`) so a future ingredient-status change can't affect recipes.
- `getRecipes` now excludes `Deleted` unconditionally; the list gains a URL-persisted `status` Filter (`Active` / `Inactive` / `All`) per ADR 0008.
- Deletion is `super_admin`-only and blocked only when the recipe is a child of an **Active** bundle (would break a live BOM); all other references (historical orders, any bundle membership, modifier groups, branch stock) are surfaced as non-blocking warnings in the confirm modal.
- Reactivation (both admin roles) is warn-only when a bundle contains `Deleted`/`Inactive` children.
- Restore is DB-only: there is deliberately no app path back from `Deleted`.
