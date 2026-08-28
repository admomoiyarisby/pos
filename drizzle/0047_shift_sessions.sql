-- POS shift sessions: track each staff member's possession of an open shift.
-- The current holder is the row whose logged_out_at is NULL; the first row per
-- shift (action 'open') is the shift's opener. Supports staff "take-over" and
-- records the time each holder logged in (took the shift) and logged out
-- (handed it over or the shift was closed).
CREATE TYPE "public"."shift_session_action" AS ENUM('open', 'take_over');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shift_id" uuid NOT NULL,
  "branch_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "action" "public"."shift_session_action" DEFAULT 'open' NOT NULL,
  "logged_in_at" timestamp DEFAULT now() NOT NULL,
  "logged_out_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "shift_sessions" ADD CONSTRAINT "shift_sessions_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "shift_sessions" ADD CONSTRAINT "shift_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");--> statement-breakpoint
ALTER TABLE "shift_sessions" ADD CONSTRAINT "shift_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE INDEX "ss_shift_idx" ON "shift_sessions" ("shift_id");--> statement-breakpoint
CREATE INDEX "ss_branch_idx" ON "shift_sessions" ("branch_id");--> statement-breakpoint
CREATE INDEX "ss_user_idx" ON "shift_sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "ss_open_idx" ON "shift_sessions" ("shift_id","logged_out_at");