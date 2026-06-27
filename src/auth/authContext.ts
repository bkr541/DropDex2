import { createContext } from 'react';
import type { AuthSessionState } from './authSessionController';

export type AuthContextValue = AuthSessionState & {
  retry: () => Promise<void>;
  clearSession: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
