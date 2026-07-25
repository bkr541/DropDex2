function abortError(): DOMException {
  return new DOMException('Operation aborted', 'AbortError');
}

export class AbortableTimerRegistry {
  private readonly cancelCallbacks = new Set<() => void>();

  get activeCount(): number {
    return this.cancelCallbacks.size;
  }

  register(cancel: () => void): () => void {
    this.cancelCallbacks.add(cancel);
    return () => this.cancelCallbacks.delete(cancel);
  }

  cancelAll(): void {
    for (const cancel of [...this.cancelCallbacks]) cancel();
    this.cancelCallbacks.clear();
  }
}

export function throwIfCancelled(
  signal: AbortSignal,
  isLocallyAborted: () => boolean = () => false,
): void {
  if (signal.aborted || isLocallyAborted()) throw abortError();
}

/** Abort-aware delay used by every Rekordbox upload retry path. */
export function waitForAbortableDelay(
  delayMs: number,
  signal: AbortSignal,
  registry: AbortableTimerRegistry,
  isLocallyAborted: () => boolean = () => false,
): Promise<void> {
  throwIfCancelled(signal, isLocallyAborted);

  return new Promise((resolve, reject) => {
    let settled = false;
    let unregister = () => undefined;

    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', handleAbort);
      unregister();
      if (error) reject(error);
      else resolve();
    };

    const handleAbort = () => finish(abortError());
    const timer = setTimeout(() => {
      if (signal.aborted || isLocallyAborted()) finish(abortError());
      else finish();
    }, Math.max(0, delayMs));

    unregister = registry.register(handleAbort);
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}
