-- Modifier group soft-delete tombstone (ADR-0009 mirror).
-- Deleting a modifier group previously hard-deleted the row (and failed on the
-- order_item_modifiers FK once the group was used in order history). Instead we
-- tombstone it: the row, its modifiers, and recipe links stay in the DB so
-- order history still resolves the group + options that were applied, while
-- every query hides deleted groups. Restore is DB-only (clear deleted_at).
ALTER TABLE "modifier_groups" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;