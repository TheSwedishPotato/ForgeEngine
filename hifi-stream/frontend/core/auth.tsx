"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, getToken, setToken, type Me, type PublicConfig } from "./api";

type Auth = {
  me: Me | null;
  ready: boolean;
  config: PublicConfig | null;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName: string): Promise<void>;
  logout(): void;
  refresh(): Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<PublicConfig | null>(null);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      return;
    }
    try {
      setMe(await api<Me>("/api/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setToken(null);
      setMe(null);
    }
  }, []);

  useEffect(() => {
    api<PublicConfig>("/api/config").then(setConfig, () => {});
    refresh().finally(() => setReady(true));
  }, [refresh]);

  const value = useMemo<Auth>(() => {
    const startSession = async (path: string, body: unknown) => {
      const res = await api<{ token: string }>(path, { body });
      setToken(res.token);
      await refresh();
    };
    return {
      me,
      ready,
      config,
      login: (email, password) => startSession("/api/auth/login", { email, password }),
      register: (email, password, displayName) => startSession("/api/auth/register", { email, password, displayName }),
      logout: () => {
        setToken(null);
        setMe(null);
      },
      refresh,
    };
  }, [me, ready, config, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
