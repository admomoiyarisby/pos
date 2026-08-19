import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

import type { QueryClient } from "@tanstack/react-query";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { getContext } from "./integrations/tanstack-query/root-provider";
import type { AuthUser } from "./lib/auth-context";
import PageTransition from "./components/PageTransition";

interface MyRouterContext {
  queryClient: QueryClient;
  user: AuthUser | null;
}

export function getRouter() {
  // SAFETY: getContext() returns exactly the { queryClient, user } shape the
  // router context requires; the annotation pins the inferred return type.
  const context = getContext() as MyRouterContext;

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: PageTransition,
  });

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
