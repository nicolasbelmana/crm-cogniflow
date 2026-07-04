import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

const AuthContext = createContext(null);

const TOKEN_KEY = 'cogniflow_token';
const USER_KEY = 'cogniflow_user';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem(USER_KEY);
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);

    if (!token) {
      setLoading(false);
      return;
    }

    api
      .me()
      .then(({ user: currentUser }) => {
        setUser(currentUser);
        localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setUser(null);
      })
      .finally(() => setLoading(false));
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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
