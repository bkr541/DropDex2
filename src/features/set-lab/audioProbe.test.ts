import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeSetLabAudio } from './audioProbe';

const source = { kind: 'url', url: 'dropdex-media://track/token' } as const;
class TestAudio extends EventTarget {
  static latest: TestAudio;
  preload = '';
  src = '';
  duration = 32;
  load = vi.fn();
  removeAttribute = vi.fn();
  constructor() {
    super();
    TestAudio.latest = this;
  }
}

beforeEach(() => vi.stubGlobal('Audio', TestAudio));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Set Lab audio probe', () => {
  it('waits for playable media data, returns duration, and unloads the probe', async () => {
    const settled = vi.fn();
    const ready = probeSetLabAudio(source).then(settled);
    const audio = TestAudio.latest;
    expect(audio.src).toBe(source.url);
    audio.dispatchEvent(new Event('loadedmetadata'));
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    audio.dispatchEvent(new Event('loadeddata'));
    await ready;
    expect(settled).toHaveBeenCalledWith(32_000);
    expect(audio.removeAttribute).toHaveBeenCalledWith('src');
    expect(audio.load).toHaveBeenCalledOnce();
  });

  it('aborts a pending file probe and revokes its temporary object URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const controller = new AbortController();
    const ready = probeSetLabAudio({ kind: 'file', file: new File(['audio'], 'clip.wav') }, controller.signal);
    const audio = TestAudio.latest;
    expect(audio.src).toMatch(/^blob:/);
    controller.abort();
    await expect(ready).rejects.toMatchObject({ name: 'AbortError' });
    expect(revoke).toHaveBeenCalledWith(audio.src);
    expect(audio.load).toHaveBeenCalledOnce();
  });

  it('fails and unloads on unsupported media or timeout', async () => {
    vi.useFakeTimers();
    const unreadable = probeSetLabAudio(source);
    TestAudio.latest.dispatchEvent(new Event('error'));
    await expect(unreadable).rejects.toThrow('unsupported format');
    expect(TestAudio.latest.load).toHaveBeenCalledOnce();

    const timeout = expect(probeSetLabAudio(source)).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(8000);
    await timeout;
    expect(TestAudio.latest.load).toHaveBeenCalledOnce();
  });
});
