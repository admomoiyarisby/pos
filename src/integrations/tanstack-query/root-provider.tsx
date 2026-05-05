import { QueryClient } from "@tanstack/react-query";
import type { AuthUser } from "#/lib/auth-context";

export function getContext() {
  const queryClient = new QueryClient();

  return {
    queryClient,
    user: null as AuthUser | null,
  };
}
export default function TanstackQueryProvider() {}
