import { createContext, useContext, type ReactNode } from "react";
import type { User } from "@/types";

interface AuthContextValue {
  user: User | null;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps extends AuthContextValue {
  children: ReactNode;
}

export function AuthProvider({ user, refreshUser, children }: AuthProviderProps) {
  return (
    <AuthContext.Provider value={{ user, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuthContext must be used inside <AuthProvider>");
  }
  return ctx;
}

/**
 * The signed-in user, or `null` outside an `<AuthProvider>`.
 *
 * For presentation-only filters (which card types to offer in a picker) that
 * must not crash a component rendered on its own — a test, a public page. The
 * server enforces every read; this only avoids offering what it would refuse.
 */
export function useOptionalAuthUser(): User | null {
  return useContext(AuthContext)?.user ?? null;
}
