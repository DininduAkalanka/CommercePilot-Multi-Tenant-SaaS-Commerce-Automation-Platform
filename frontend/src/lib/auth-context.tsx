'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { authApi } from './api';

// ── Types ─────────────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantId: string;
  businessName: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    businessName: string;
    ownerName: string;
    email: string;
    password: string;
  }) => Promise<void>;
  logout: () => void;
}

// ── Context ───────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'commercepilot_token';
const USER_KEY = 'commercepilot_user';
const REFRESH_TOKEN_KEY = 'commercepilot_refresh_token';

// ── Provider ──────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Hydrate auth state from localStorage on mount
  useEffect(() => {
    try {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      const storedUser = localStorage.getItem(USER_KEY);

      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      }
    } catch {
      // Corrupted storage — clear it
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const persistAuth = useCallback((accessToken: string, refreshToken: string, userData: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
    setToken(accessToken);
    setUser(userData);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await authApi.login({ email, password });
      const { accessToken, refreshToken, user: userData } = response.data.data;
      persistAuth(accessToken, refreshToken, userData as AuthUser);
    },
    [persistAuth],
  );

  const register = useCallback(
    async (data: {
      businessName: string;
      ownerName: string;
      email: string;
      password: string;
    }) => {
      const response = await authApi.register(data);
      const { accessToken, refreshToken, user: userData } = response.data.data;
      persistAuth(accessToken, refreshToken, userData as AuthUser);
    },
    [persistAuth],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore logout API errors — clear local state regardless
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setToken(null);
    setUser(null);
    window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token && !!user,
        isLoading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
