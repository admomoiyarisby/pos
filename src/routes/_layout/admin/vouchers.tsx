import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/admin/vouchers")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_layout/admin/vouchers"!</div>;
}
