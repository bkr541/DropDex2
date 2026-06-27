import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from '../auth/authContext';

export function useAuthSession(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthSession must be used inside AuthProvider.');
  }
  return context;
}

export type { AuthContextValue } from '../auth/authContext';
export type { AuthSessionState } from '../auth/authSessionController';
