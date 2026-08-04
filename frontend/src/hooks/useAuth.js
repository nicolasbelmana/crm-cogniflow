import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

const AuthContext = createContext(null);

const TOKEN_KEY = 'cogniflow_token';
const USER_KEY = 'cogniflow_user';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const stored = localStorage.getItem(USER_KEY);
    if (!token || !stored) {
      return null;
    }

    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function handleAuthExpired() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      setUser(null);
    }

    window.addEventListener(api.AUTH_EXPIRED_EVENT, handleAuthExpired);

    const token = localStorage.getItem(TOKEN_KEY);

    if (!token) {
      localStorage.removeItem(USER_KEY);
      setUser(null);
      setLoading(false);
      return () => {
        window.removeEventListener(api.AUTH_EXPIRED_EVENT, handleAuthExpired);
      };
    }

    api
      .me()
      .then(({ user: currentUser }) => {
        setUser(currentUser);
        localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
      })
      .catch((err) => {
        // If auth is invalid/expired, api.handleResponse already emitted
        // AUTH_EXPIRED_EVENT and cleaned local storage.
        console.warn('api.me() failed during startup', err);
      })
      .finally(() => setLoading(false));

    return () => {
      window.removeEventListener(api.AUTH_EXPIRED_EVENT, handleAuthExpired);
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      async login(email, password) {
        const { user: loggedUser, token } = await api.login({ email, password });
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(loggedUser));
        setUser(loggedUser);
        return loggedUser;
      },
      async register(payload) {
        const { user: newUser, token } = await api.register(payload);
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(newUser));
        setUser(newUser);
        return newUser;
      },
      async logout() {
        try {
          await api.logout();
        } catch {
          // Token may already be invalid; clear local session anyway.
        } finally {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setUser(null);
        }
      },
    }),
    [user, loading]
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
