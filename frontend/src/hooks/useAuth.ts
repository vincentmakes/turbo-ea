import { useState, useEffect, useCallback, useRef } from "react";
import { auth, setToken, clearToken, setAuthenticated } from "@/api/client";
import { primeBootstrap, resetBootstrap } from "@/api/bootstrap";
import { stopEventStream } from "@/hooks/useEventStream";
import { invalidateExtensionCapabilities } from "@/hooks/useExtensionCapabilities";
import { resetExtensionHost } from "@/lib/extensionHost";
import i18n from "@/i18n";
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
        await auth.refresh();
      } catch {
        // Token refresh failed — session expired
        setAuthenticated(false);
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
    try {
      const u = await auth.me();
      setAuthenticated(true);
      // Await bootstrap before mounting the authenticated UI so per-hook
      // singleton caches are populated by the time their components subscribe.
      // Trade-off: delays first paint by one /settings/bootstrap round-trip,
      // but eliminates ~7 per-hook fallback GETs that race when the cache is
      // still empty. Bootstrap failures are swallowed inside primeBootstrap()
      // so a transient bootstrap error doesn't block login.
      await primeBootstrap();
      // Load UI extension bundles in the background (entitlement-filtered
      // manifest + dynamic import; failures are captured per-extension).
      void import("@/lib/extensionHost").then((m) => m.loadUiExtensions());
      setUser(u as User);
      i18n.changeLanguage(u.locale || "en");
      startRefreshTimer();
    } catch {
      setAuthenticated(false);
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

  const logout = async () => {
    try {
      await auth.logout();
    } catch {
      // Best-effort — clear local state regardless
    }
    clearToken();
    stopEventStream();
    stopRefreshTimer();
    resetBootstrap();
    // Clear per-user extension state so the next login in the same tab
    // re-fetches its own entitlement-filtered bundles + capabilities rather
    // than inheriting the previous user's (loadUiExtensions guards on a
    // module-level _loadStarted flag that resetExtensionHost clears).
    resetExtensionHost();
    invalidateExtensionCapabilities();
    setUser(null);
  };

  return {
    user,
    loading,
    login,
    register,
    ssoCallback,
    setPassword,
    logout,
    refreshUser: loadUser,
  };
}
