import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../lib/supabase';
import { AuthContext, type AuthContextValue } from './authContext';
import {
  createAuthSessionController,
  type AuthSessionController,
  type AuthSessionState,
} from './authSessionController';

interface AuthProviderProps {
  children: React.ReactNode;
  createController?: () => AuthSessionController;
}

export function AuthProvider({ children, createController }: AuthProviderProps) {
  const controller = useMemo(
    () => createController?.() ?? createAuthSessionController(getSupabaseClient().auth),
    [createController],
  );
  const [state, setState] = useState<AuthSessionState>(() => controller.getState());

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    controller.start();
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  const retry = useCallback(() => controller.retry(), [controller]);
  const clearSession = useCallback(() => controller.clearSession(), [controller]);
  const value = useMemo<AuthContextValue>(
    () => ({ ...state, retry, clearSession }),
    [state, retry, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
