import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopRouletteRuntimeUnavailableReason } from '../../types/dropdex-desktop';

export type RouletteRuntimeStatus =
  | 'checking'
  | 'ready'
  | 'setup-required'
  | 'temporarily-unavailable'
  | 'unavailable';

export interface RouletteRuntimeReadiness {
  ready: boolean;
  status: RouletteRuntimeStatus;
  message: string | null;
}

const RUNTIME_HEALTH_REFRESH_MS = 60_000;

export function classifyUnavailableReason(
  reason: DesktopRouletteRuntimeUnavailableReason,
): 'setup-required' | 'temporarily-unavailable' {
  if (
    reason === 'runtime_missing'
    || reason === 'model_missing'
    || reason === 'dependency_unavailable'
  ) {
    return 'setup-required';
  }
  return 'temporarily-unavailable';
}

export function rouletteRuntimeUserMessage(reason: DesktopRouletteRuntimeUnavailableReason): string {
  if (reason === 'runtime_missing' || reason === 'model_missing' || reason === 'dependency_unavailable') {
    return 'Roulette audio runtime setup is required. Repair or reinstall the local Roulette runtime before using Roulette.';
  }
  if (reason === 'decoder_unavailable') {
    return 'Roulette cannot access the local audio decoder right now. Restart DropDex and try again.';
  }
  if (reason === 'storage_unavailable') {
    return 'Roulette cannot access its local working storage. Check available space and app permissions, then try again.';
  }
  return 'Roulette audio runtime is temporarily unavailable. Try again after restarting DropDex.';
}

function isElectronDesktop(): boolean {
  return typeof window !== 'undefined' && window.dropdexDesktop?.isElectron === true;
}

export function useRouletteRuntimeReadiness(): RouletteRuntimeReadiness {
  const [readiness, setReadiness] = useState<RouletteRuntimeReadiness>(() =>
    isElectronDesktop()
      ? { ready: false, status: 'checking', message: null }
      : { ready: false, status: 'unavailable', message: null },
  );
  const requestSequence = useRef(0);

  const check = useCallback(async () => {
    if (!isElectronDesktop()) {
      setReadiness({ ready: false, status: 'unavailable', message: null });
      return;
    }
    const desktop = window.dropdexDesktop;
    if (!desktop) {
      setReadiness({ ready: false, status: 'unavailable', message: null });
      return;
    }
    const requestId = ++requestSequence.current;
    try {
      const health = await desktop.getRouletteRuntimeHealth();
      if (requestSequence.current !== requestId) return;
      if (health.available) {
        setReadiness({ ready: true, status: 'ready', message: null });
      } else {
        const status = classifyUnavailableReason(health.reason);
        setReadiness({ ready: false, status, message: rouletteRuntimeUserMessage(health.reason) });
      }
    } catch {
      if (requestSequence.current !== requestId) return;
      setReadiness({
        ready: false,
        status: 'temporarily-unavailable',
        message: 'Roulette audio runtime health check failed.',
      });
    }
  }, []);

  useEffect(() => {
    if (!isElectronDesktop()) {
      setReadiness({ ready: false, status: 'unavailable', message: null });
      return undefined;
    }
    void check();
    const timer = window.setInterval(() => { void check(); }, RUNTIME_HEALTH_REFRESH_MS);
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    return () => {
      requestSequence.current += 1;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [check]);

  return readiness;
}
