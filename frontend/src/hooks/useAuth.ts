import { useState, useEffect, useCallback } from "react";
import { auth } from "@/api/client";
import type { User } from "@/types";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const u = await auth.me();
      setUser(u as User);
    } catch {
      localStorage.removeItem("token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = async (email: string, password: string) => {
    const { access_token } = await auth.login(email, password);
    localStorage.setItem("token", access_token);
    await loadUser();
  };

  const register = async (email: string, displayName: string, password: string) => {
    const { access_token } = await auth.register(email, displayName, password);
    localStorage.setItem("token", access_token);
    await loadUser();
  };

  const ssoCallback = async (code: string, redirectUri: string) => {
    const { access_token } = await auth.ssoCallback(code, redirectUri);
    localStorage.setItem("token", access_token);
    await loadUser();
  };

  const logout = () => {
    localStorage.removeItem("token");
    setUser(null);
  };

  return { user, loading, login, register, ssoCallback, logout };
}
