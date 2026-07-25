import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbortableTimerRegistry, waitForAbortableDelay } from './abortableRetry';

afterEach(() => {
  vi.useRealTimers();
});

describe('abortable retry delay', () => {
  it('cancels immediately during the delay and leaves no timer registered', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const registry = new AbortableTimerRegistry();
    const delay = waitForAbortableDelay(5000, controller.signal, registry);

    expect(registry.activeCount).toBe(1);
    controller.abort();

    await expect(delay).rejects.toMatchObject({ name: 'AbortError' });
    expect(registry.activeCount).toBe(0);
  });

  it('prevents a delay from starting after local cancellation', async () => {
    const controller = new AbortController();
    const registry = new AbortableTimerRegistry();

    await expect(waitForAbortableDelay(10, controller.signal, registry, () => true))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(registry.activeCount).toBe(0);
  });
});
