import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "#/lib/auth-context";
import AppShell from "#/components/AppShell";
import { PageTitleProvider } from "#/components/PageTitleProvider";
import { Skeleton } from "#/components/ui/skeleton";

export const Route = createFileRoute("/_layout")({
  component: LayoutComponent,
});

function LayoutComponent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col">
        {/* Sidebar skeleton */}
        <div className="hidden md:fixed md:left-0 md:top-0 md:z-40 md:flex md:h-screen md:w-64 md:flex-col md:border-r md:border-sidebar-border md:bg-sidebar">
          <div className="flex h-14 items-center border-b border-sidebar-border px-4">
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="flex-1 space-y-4 p-4 py-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        </div>
        {/* Main content skeleton */}
        <div className="flex-1 p-4 md:ml-64 md:p-6">
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-7 w-48" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-9 rounded-md" />
              <Skeleton className="h-9 w-9 rounded-md" />
            </div>
          </div>
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
            <Skeleton className="h-64 w-full" />
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  return (
    <PageTitleProvider>
      <AppShell userRole={user.role} />
    </PageTitleProvider>
  );
}
