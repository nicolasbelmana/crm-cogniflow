import { createContext } from 'react';

// AuthProvider and hook logic moved to separate hook file to improve Fast Refresh
// preservation. This file now only exposes the context and provider entrypoint.
export const AuthContext = createContext(null);

export default function AuthProviderPlaceholder({ children }) {
  // Keep a minimal placeholder so imports from this module don't break while the
  // real provider implementation is in the hook file. Consumer files should
  // import { AuthProvider } from the provider path; but to remain backwards
  // compatible we export a no-op provider here.
  return <AuthContext.Provider value={{}}>{children}</AuthContext.Provider>;
}
