import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/modifier-groups/$mgId")({
  component: ModifierGroupDetailPage,
});

function ModifierGroupDetailPage() {
  const { mgId } = Route.useParams();
  return (
    <div>
      <h1 className="text-2xl font-bold">Detail Modifier Group</h1>
      <p className="text-muted-foreground">ID: {mgId}</p>
    </div>
  );
}
