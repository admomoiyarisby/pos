-- Retire the two enum values no writer has produced since the state machines
-- were simplified:
--   * orders.status 'Cancel Requested' — cancellation lives in cancel_requests;
--     no code path ever wrote this order status.
--   * cancel_requests.status 'Approved' — approval now executes the void in the
--     same transaction, so the state goes Pending → Executed | Rejected.
--
-- Existing rows are mapped to the state they actually reached. The replacement
-- types are created under a temporary name and then renamed: a plain
-- `ALTER TYPE ... ADD VALUE` value cannot be used in the same transaction, and
-- on a fresh database this migration runs in the same transaction as 0009
-- (which added 'Executed'). A type whose labels come from CREATE TYPE has no
-- such restriction.
--
-- Deliberately kept as one statement batch (no statement-breakpoint markers):
-- Postgres runs a multi-statement simple query in a single implicit
-- transaction, so a failure cannot leave a column pointing at a dropped type.

ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "cancel_requests" ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "public"."order_status_new" AS ENUM(
  'New',
  'Processing',
  'In Delivery',
  'Completed',
  'Void'
);
ALTER TABLE "orders"
  ALTER COLUMN "status" TYPE "public"."order_status_new"
  USING (
    CASE WHEN "status"::text = 'Cancel Requested' THEN 'New' ELSE "status"::text END
  )::"public"."order_status_new";
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'New';
DROP TYPE "public"."order_status";
ALTER TYPE "public"."order_status_new" RENAME TO "order_status";

CREATE TYPE "public"."cancel_request_status_new" AS ENUM('Pending', 'Rejected', 'Executed');
ALTER TABLE "cancel_requests"
  ALTER COLUMN "status" TYPE "public"."cancel_request_status_new"
  USING (
    CASE WHEN "status"::text = 'Approved' THEN 'Executed' ELSE "status"::text END
  )::"public"."cancel_request_status_new";
ALTER TABLE "cancel_requests" ALTER COLUMN "status" SET DEFAULT 'Pending';
DROP TYPE "public"."cancel_request_status";
ALTER TYPE "public"."cancel_request_status_new" RENAME TO "cancel_request_status";
