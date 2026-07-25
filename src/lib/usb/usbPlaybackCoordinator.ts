type UsbPlaybackStopHandler = () => void | Promise<void>;

const handlers = new Set<UsbPlaybackStopHandler>();

export function registerUsbPlaybackStopHandler(handler: UsbPlaybackStopHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export async function stopUsbBackedPlayback(): Promise<Error[]> {
  const results = await Promise.allSettled([...handlers].map((handler) => handler()));
  return results.flatMap((result) => {
    if (result.status === 'fulfilled') return [];
    return [
      result.reason instanceof Error
        ? result.reason
        : new Error(String(result.reason)),
    ];
  });
}
