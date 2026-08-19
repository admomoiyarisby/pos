import { QueryClient } from "@tanstack/react-query";
import type { AuthUser } from "#/lib/auth-context";

export function getContext() {
  const queryClient = new QueryClient();

  // SAFETY: the router context is always server-side (SSR); the user is
  // null until the auth hydration query resolves, matching the context type.
  const user: AuthUser | null = null;
  return { queryClient, user };
}
export default function TanstackQueryProvider() {}
