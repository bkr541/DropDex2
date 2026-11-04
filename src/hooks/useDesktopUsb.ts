import { useCallback, useEffect, useRef, useState } from 'react';
import { useUsbConnection } from '../contexts/UsbConnectionContext';
import { logger } from '../lib/logger';
import type {
  DesktopStartTransferResult, DesktopTransferCategory, DesktopTransferProgress, DesktopTransferScan, DesktopUsbDetails, DropDexDesktopBridge,
} from '../types/dropdex-desktop';

export function getDesktopBridge(): DropDexDesktopBridge | null {
  return typeof window !== 'undefined' && window.dropdexDesktop ? window.dropdexDesktop : null;
}

/** Details (size, free space, format, make) for the connected USB. Refreshes whenever the connection changes. */
export function usePrimaryUsbDetails() {
  const { status, volumeName } = useUsbConnection();
  const [details, setDetails] = useState<DesktopUsbDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge || status !== 'connected') {
      setDetails(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    bridge.getUsbDetails()
      .then((value) => { if (!cancelled) setDetails(value); })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('usb.details.failed', { message });
        if (!cancelled) setError('Could not read the details of this USB.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status, volumeName, attempt]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  return { details, loading, error, refresh };
}

/** What is on the connected USB, by kind: how many files and how many bytes. */
export function useTransferScan() {
  const { status, volumeName } = useUsbConnection();
  const [scan, setScan] = useState<DesktopTransferScan | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge || status !== 'connected') {
      setScan(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    bridge.scanTransfer()
      .then((value) => { if (!cancelled) setScan(value); })
      .catch((err: unknown) => logger.error('usb.scan.failed', { message: err instanceof Error ? err.message : String(err) }))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status, volumeName]);

  return { scan, loading };
}

/** The second drive chosen on the Transfer tab. */
export function useTransferDestination() {
  const [destination, setDestination] = useState<DesktopUsbDetails | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    let cancelled = false;
    bridge.getTransferDestination()
      .then((value) => { if (!cancelled) setDestination(value); })
      .catch((err: unknown) => logger.error('usb.destination.load_failed', { message: err instanceof Error ? err.message : String(err) }));
    return () => { cancelled = true; };
  }, []);

  const choose = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setChoosing(true);
    setError(null);
    try {
      const result = await bridge.selectTransferDestination();
      if (result.error) {
        logger.warn('usb.destination.rejected', { message: result.error });
        setError(result.error);
      }
      if (!result.cancelled || result.destination) setDestination(result.destination);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('usb.destination.select_failed', { message });
      setError('Could not open the folder chooser.');
    } finally {
      setChoosing(false);
    }
  }, []);

  const clear = useCallback(async () => {
    const bridge = getDesktopBridge();
    setError(null);
    try { await bridge?.clearTransferDestination(); } catch (err: unknown) { logger.error('usb.destination.clear_failed', { message: err instanceof Error ? err.message : String(err) }); }
    setDestination(null);
  }, []);

  return { destination, choosing, error, choose, clear };
}

export type TransferRunState =
  | { phase: 'idle' }
  | { phase: 'running'; progress: DesktopTransferProgress | null }
  | { phase: 'done'; outcome: Extract<DesktopStartTransferResult, { ok: true }>['result'] }
  | { phase: 'error'; message: string };

/** Starts and watches a transfer. The result is also handed to `onFinished` so it can be saved to the history. */
export function useUsbTransfer(onFinished?: (outcome: Extract<DesktopStartTransferResult, { ok: true }>['result']) => void) {
  const [state, setState] = useState<TransferRunState>({ phase: 'idle' });
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    return bridge.onTransferProgress((progress) => setState((current) => (current.phase === 'running' ? { phase: 'running', progress } : current)));
  }, []);

  const start = useCallback(async (categories: DesktopTransferCategory[]) => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setState({ phase: 'running', progress: null });
    logger.info('usb.transfer.started', { categories });
    try {
      const response = await bridge.startTransfer(categories);
      if ('error' in response) {
        logger.error('usb.transfer.refused', { message: response.error, neededBytes: response.neededBytes, freeBytes: response.freeBytes });
        setState({ phase: 'error', message: response.error });
        return;
      }
      logger.info('usb.transfer.finished', { status: response.result.status, copied: response.result.copied, skipped: response.result.skipped, failed: response.result.failed });
      if (response.result.error) logger.error('usb.transfer.file_error', { message: response.result.error });
      setState({ phase: 'done', outcome: response.result });
      finished.current?.(response.result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('usb.transfer.failed', { message });
      setState({ phase: 'error', message: 'The transfer stopped unexpectedly. Check both drives and try again.' });
    }
  }, []);

  const cancel = useCallback(() => { void getDesktopBridge()?.cancelTransfer(); }, []);
  const reset = useCallback(() => setState({ phase: 'idle' }), []);
  return { state, start, cancel, reset };
}
