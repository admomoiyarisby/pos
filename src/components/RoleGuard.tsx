import { Navigate } from "@tanstack/react-router";
import type { UserRole } from "#/lib/auth-context";
import { useAuth } from "#/lib/auth-context";
import { Skeleton } from "./ui/skeleton";

interface RoleGuardProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /**
   * Where to send a role-denied user. By default they land on "/", which
   * the index route resolves to the role-based home. Pass the page's sibling
   * list route (e.g. "/scm-transfers" from "/scm-transfers/new") so a denied
   * visitor lands back on the list they came from instead of the role home.
   */
  deniedTo?: string;
}

export default function RoleGuard({ allowedRoles, children, fallback, deniedTo }: RoleGuardProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="space-y-6 py-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-4 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-32" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (!allowedRoles.includes(user.role)) {
    if (fallback) return <>{fallback}</>;
    return <Navigate to={deniedTo ?? "/"} replace />;
  }

  return <>{children}</>;
}
