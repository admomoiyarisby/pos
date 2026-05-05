import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "#/lib/auth-context";
import AppShell from "#/components/AppShell";

export const Route = createFileRoute("/_layout")({
  component: LayoutComponent,
});

function LayoutComponent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  return <AppShell userRole={user.role} />;
}
