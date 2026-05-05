import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

export type UserRole =
  | "super_admin"
  | "admin_pusat"
  | "area_manager"
  | "branch_admin"
  | "central_kitchen";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  branchId?: string;
  assignedBranches?: string[];
  pin?: string;
  status: "Active" | "Inactive";
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
});

export function AuthProvider({
  children,
  user,
  isLoading,
}: {
  children: ReactNode;
  user: AuthUser | null;
  isLoading: boolean;
}) {
  const value = useMemo(() => ({ user, isLoading }), [user, isLoading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
