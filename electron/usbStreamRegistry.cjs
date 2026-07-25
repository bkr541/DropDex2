'use strict';

class UsbStreamRegistry {
  constructor({ closeTimeoutMs = 2500, pollIntervalMs = 10 } = {}) {
    this.closeTimeoutMs = closeTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.activeStreams = new Map();
    this.pendingRequestCount = 0;
    this.releasing = false;
    this.released = false;
    this.acceptingRequests = true;
    this.lastError = null;
    this.nextId = 1;
    this.releasePromise = null;
  }

  resetForConnection() {
    this.releasing = false;
    this.released = false;
    this.acceptingRequests = true;
    this.lastError = null;
    this.releasePromise = null;
  }

  assertAcceptingRequests() {
    if (!this.acceptingRequests || this.releasing || this.released) {
      const error = new Error('USB media access is being released.');
      error.code = 'USB_RELEASING';
      throw error;
    }
  }

  beginRequest() {
    this.assertAcceptingRequests();
    this.pendingRequestCount += 1;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.pendingRequestCount = Math.max(0, this.pendingRequestCount - 1);
    };
  }

  track(stream, { playback = true } = {}) {
    this.assertAcceptingRequests();
    const id = this.nextId++;
    const entry = {
      id,
      stream,
      playback,
      explicitlyDestroyed: false,
      destroyAttempted: false,
      closed: false,
      closePromise: null,
      resolveClosed: null,
    };

    entry.closePromise = new Promise((resolve) => {
      entry.resolveClosed = resolve;
    });

    const remove = () => {
      if (entry.closed) return;
      entry.closed = true;
      this.activeStreams.delete(id);
      entry.resolveClosed?.();
    };

    stream.once('close', remove);
    stream.once('end', remove);
    stream.once('error', (error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      remove();
    });

    this.activeStreams.set(id, entry);
    return entry;
  }

  destroyEntry(entry) {
    if (!entry || entry.closed || entry.destroyAttempted) return;
    entry.destroyAttempted = true;
    entry.explicitlyDestroyed = true;
    try {
      entry.stream.destroy();
      // `destroyed` only means destruction was requested. Wait for `close`
      // before claiming the OS file handle is gone.
      if (entry.stream.closed) {
        entry.closed = true;
        this.activeStreams.delete(entry.id);
        entry.resolveClosed?.();
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      // A throwing destroy call is not proof that the OS handle closed. Keep
      // the stream registered so release returns a truthful timeout instead
      // of a false "all streams closed" acknowledgement.
    }
  }

  beginRelease() {
    this.acceptingRequests = false;
    this.releasing = true;
    this.released = false;
  }

  async release({ timeoutMs = this.closeTimeoutMs } = {}) {
    if (this.releasePromise) return this.releasePromise;

    this.beginRelease();
    this.releasePromise = this.#releaseAll(timeoutMs).finally(() => {
      this.releasePromise = null;
    });
    return this.releasePromise;
  }

  async #releaseAll(timeoutMs) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    const destroyedIds = new Set();

    while (true) {
      for (const entry of [...this.activeStreams.values()]) {
        destroyedIds.add(entry.id);
        this.destroyEntry(entry);
      }

      if (this.activeStreams.size === 0 && this.pendingRequestCount === 0) break;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }

    const allStreamsClosed = this.activeStreams.size === 0 && this.pendingRequestCount === 0;
    this.releasing = !allStreamsClosed;
    this.released = allStreamsClosed;
    const result = {
      allStreamsClosed,
      timedOut: !allStreamsClosed,
      destroyedStreamCount: destroyedIds.size,
      remainingStreamCount: this.activeStreams.size,
      pendingRequestCount: this.pendingRequestCount,
    };
    return { ...result, activity: this.snapshot() };
  }

  snapshot({ connected = false } = {}) {
    let activePlaybackCount = 0;
    for (const entry of this.activeStreams.values()) {
      if (entry.playback) activePlaybackCount += 1;
    }
    return {
      connected,
      activeStreamCount: this.activeStreams.size,
      pendingRequestCount: this.pendingRequestCount,
      activePlaybackCount,
      releasing: this.releasing,
      released: this.released,
      lastError: this.lastError,
    };
  }
}

module.exports = { UsbStreamRegistry };
