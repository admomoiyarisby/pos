import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "#/lib/auth-context";

export const Route = createFileRoute("/_layout/")({
  component: IndexComponent,
});

function IndexComponent() {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" />;

  // Role-based redirects
  switch (user.role) {
    case "branch_admin":
      return <Navigate to="/pos" />;
    case "super_admin":
      return <Navigate to="/dashboard" />;
    case "admin_pusat":
      return <Navigate to="/scm-procurements" search={{ status: undefined, search: undefined }} />;
    case "area_manager":
      return <Navigate to="/inventory" />;
    case "central_kitchen":
      return <Navigate to="/yield-tracking" />;
    default:
      return <Navigate to="/pos" />;
  }
}
