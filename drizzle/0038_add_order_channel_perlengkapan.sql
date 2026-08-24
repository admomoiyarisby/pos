-- New order_channel transaction type: in-store sales of equipment/supplies
-- (Perlengkapan). Mirrors the TikTok addition in drizzle/0019.
-- Hand-written migration, applied manually like drizzle/0030 (not journaled).
ALTER TYPE "public"."order_channel" ADD VALUE IF NOT EXISTS 'Perlengkapan';
