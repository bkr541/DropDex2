import { describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';
import { createRouletteHqPairController } from './rouletteHqPairController';
import type { RouletteStemPreparationOutcome } from './stemPreparationService';

function track(id: string): RekordboxTrack {
  return { id, title: id } as RekordboxTrack;
}

describe('Roulette HQ pair controller', () => {
  it('prepares the two selected tracks serially and reports one-at-a-time progress', async () => {
    let releaseVocal!: () => void;
    const states: string[] = [];
    const prepare = vi.fn(async (_track: RekordboxTrack): Promise<RouletteStemPreparationOutcome> => ({ status: 'ready', cached: false, message: null }));
    prepare.mockImplementationOnce(() => new Promise<RouletteStemPreparationOutcome>((resolve) => {
      releaseVocal = () => resolve({ status: 'ready', cached: false, message: null });
    }));
    const controller = createRouletteHqPairController({
      prepare,
      cancel: vi.fn(async () => true),
      onState: (state) => states.push(`${state.activeRole}:${state.progress}`),
    });

    const pending = controller.preparePair(track('vocal-a'), track('instrumental-a'));
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    expect(prepare.mock.calls[0][0].id).toBe('vocal-a');
    expect(prepare).toHaveBeenCalledTimes(1);

    releaseVocal();
    await expect(pending).resolves.toMatchObject({ status: 'ready', progress: 1 });
    expect(prepare.mock.calls.map(([value]) => value.id)).toEqual(['vocal-a', 'instrumental-a']);
    expect(states).toContain('instrumental:0.5');
  });

  it('preserves a completed first HQ stem when the second track fails', async () => {
    const prepare = vi.fn(async (value: RekordboxTrack): Promise<RouletteStemPreparationOutcome> => (
      value.id === 'vocal-a'
        ? { status: 'ready', cached: false, message: null }
        : { status: 'failed', cached: false, message: 'instrumental failed' }
    ));
    const controller = createRouletteHqPairController({
      prepare,
      cancel: vi.fn(async () => true),
    });

    await expect(controller.preparePair(track('vocal-a'), track('instrumental-a'))).resolves.toMatchObject({
      status: 'partial',
      completedRoles: ['vocal'],
      message: 'instrumental failed',
    });
  });

  it('cancels only the currently active HQ track and does not start the queued second track', async () => {
    let release!: (value: RouletteStemPreparationOutcome) => void;
    const prepare = vi.fn(async (_track: RekordboxTrack): Promise<RouletteStemPreparationOutcome> => ({ status: 'ready', cached: false, message: null }));
    prepare.mockImplementationOnce(() => new Promise<RouletteStemPreparationOutcome>((resolve) => { release = resolve; }));
    const cancel = vi.fn(async () => true);
    const controller = createRouletteHqPairController({ prepare, cancel });

    const pending = controller.preparePair(track('vocal-a'), track('instrumental-a'));
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    await expect(controller.cancel()).resolves.toBe(true);
    expect(cancel).toHaveBeenCalledWith('vocal-a');
    release({ status: 'cancelled', cached: false, message: 'cancelled' });

    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
