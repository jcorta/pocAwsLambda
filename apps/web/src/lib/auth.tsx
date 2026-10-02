"use client";
// Contexto de autenticación (SPEC §5.3). Los tokens viven solo en memoria (D-2.3): al recargar la página
// la sesión se pierde y se vuelve al login con `?next=` a la ruta de origen.
import { MeSchema, type MeDto } from "@reservas/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createApiClient, type ApiClient } from "./api-client.ts";
import { createCognitoAuth, type CognitoAuth } from "./cognito.ts";
import type { RuntimeConfig } from "./config.ts";
import { needsRefresh, REFRESH_MARGIN_MS, type Session } from "./session.ts";

export type AuthStatus = "anonymous" | "authenticated";

export interface AuthContextValue {
  status: AuthStatus;
  user: MeDto | null;
  isAdmin: boolean;
  cognito: CognitoAuth;
  api: ApiClient;
  config: RuntimeConfig;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ config, children }: { config: RuntimeConfig; children: ReactNode }) {
  const cognito = useMemo(() => createCognitoAuth(config), [config]);
  const session = useRef<Session | null>(null);
  const refreshing = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [user, setUser] = useState<MeDto | null>(null);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    session.current = null;
    setUser(null);
  }, []);

  // `schedule` llama a `refresh` y `refresh` a `schedule`: se cortan el ciclo con una ref
  const refreshRef = useRef<() => Promise<boolean>>(async () => false);

  // Programa el refresh un minuto antes de que venza el ID token
  const schedule = useCallback((s: Session) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => void refreshRef.current(),
      Math.max(0, s.expiresAt - Date.now() - REFRESH_MARGIN_MS),
    );
  }, []);

  // Renueva el ID token; varias llamadas concurrentes comparten el mismo refresh
  const refresh = useCallback((): Promise<boolean> => {
    const current = session.current;
    if (!current) return Promise.resolve(false);
    refreshing.current ??= cognito
      .refresh(current)
      .then((next) => {
        session.current = next;
        schedule(next);
        return true;
      })
      .catch(() => {
        clear();
        return false;
      })
      .finally(() => {
        refreshing.current = null;
      });
    return refreshing.current;
  }, [cognito, clear, schedule]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: config.apiUrl,
        getIdToken: async () => {
          if (session.current && needsRefresh(session.current)) await refresh();
          return session.current?.idToken ?? null;
        },
        forceRefresh: refresh,
        onSessionExpired: clear,
      }),
    [config.apiUrl, refresh, clear],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const s = await cognito.login(email, password);
      session.current = s;
      schedule(s);
      // Registra al usuario en la API y obtiene sus roles (SPEC §5.3)
      setUser(await api("GET", "/v1/me", { schema: MeSchema }));
    },
    [cognito, api, schedule],
  );

  const logout = useCallback(async () => {
    const s = session.current;
    clear();
    // Revoca el refresh token en Cognito; si falla, la sesión local ya se borró igual
    if (s) await cognito.signOut(s).catch(() => {});
  }, [cognito, clear]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: user ? "authenticated" : "anonymous",
      user,
      isAdmin: user?.roles.includes("admin") ?? false,
      cognito,
      api,
      config,
      login,
      logout,
    }),
    [user, cognito, api, config, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fuera de AuthProvider");
  return ctx;
}
