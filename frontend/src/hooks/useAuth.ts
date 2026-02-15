import { useState, useEffect, useCallback, useRef } from "react";
import { auth, setToken, clearToken } from "@/api/client";
import type { User } from "@/types";

const TOKEN_REFRESH_INTERVAL = 10 * 60 * 1000; // Refresh every 10 minutes

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRefreshTimer = useCallback(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(async () => {
      try {
        const { access_token } = await auth.refresh();
        setToken(access_token);
      } catch {
        // Token refresh failed — session expired
        clearToken();
        setUser(null);
      }
    }, TOKEN_REFRESH_INTERVAL);
  }, []);

  const stopRefreshTimer = useCallback(() => {
    if (refreshTimer.current) {
      clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  const loadUser = useCallback(async () => {
    const token = sessionStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const u = await auth.me();
      setUser(u as User);
      startRefreshTimer();
    } catch {
      clearToken();
    } finally {
      setLoading(false);
    }
  }, [startRefreshTimer]);

  useEffect(() => {
    loadUser();
    return () => stopRefreshTimer();
  }, [loadUser, stopRefreshTimer]);

  const login = async (email: string, password: string) => {
    const { access_token } = await auth.login(email, password);
    setToken(access_token);
    await loadUser();
  };

  const register = async (email: string, displayName: string, password: string) => {
    const { access_token } = await auth.register(email, displayName, password);
    setToken(access_token);
    await loadUser();
  };

  const ssoCallback = async (code: string, redirectUri: string) => {
    const { access_token } = await auth.ssoCallback(code, redirectUri);
    setToken(access_token);
    await loadUser();
  };

  const setPassword = async (token: string, password: string) => {
    const { access_token } = await auth.setPassword(token, password);
    setToken(access_token);
    await loadUser();
  };

  const logout = () => {
    clearToken();
    stopRefreshTimer();
    setUser(null);
  };

  return { user, loading, login, register, ssoCallback, setPassword, logout };
}
