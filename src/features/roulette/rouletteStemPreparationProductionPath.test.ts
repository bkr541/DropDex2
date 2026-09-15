import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Roulette Stage 6 production preparation reachability', () => {
  it('enters from Track Intelligence and reaches the desktop separator instead of a fixture path', () => {
    const detail = read('src/components/library/TrackDetailView.tsx');
    const hook = read('src/features/roulette/useRouletteTrackStemPreparation.ts');
    const service = read('src/features/roulette/stemPreparationService.ts');
    const preload = read('electron/preload.cjs');
    const main = read('electron/main.cjs');
    const worker = read('bridge/rekordbox_bridge/stem_separator.py');

    expect(detail).toContain('Prepare for Roulette');
    expect(detail).toContain('roulettePreparation.prepare()');
    expect(hook).toContain('rouletteStemPreparationService.prepare(track)');
    expect(service).toContain('desktop.prepareRouletteStems');
    expect(service).toContain('preparePair');
    expect(service).toContain('const vocal = await prepare(vocalTrack)');
    expect(preload).toContain("ipcRenderer.invoke('dropdex:prepare-roulette-stems'");
    expect(main).toContain("ipcMain.handle('dropdex:prepare-roulette-stems'");
    expect(main).toContain('resolveUsbTrackPath(payload.sourceSegments)');
    expect(worker).toContain('demucs.separate');
    expect(worker).toContain('--two-stems');
    expect(worker).not.toContain('requests.post');
    expect(worker).not.toContain('httpx');
  });

  it('keeps Stage-5 playback on current-version canonical ready stems only', () => {
    const candidates = read('src/lib/queries/rouletteCandidates.ts');
    const matching = read('src/features/roulette/rouletteMatchingEngine.ts');
    const runtime = read('src/features/roulette/rouletteAudioRuntime.ts');

    expect(candidates).toContain(".eq('separator_version', ROULETTE_SEPARATOR_VERSION)");
    expect(matching).toContain('expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION');
    expect(runtime).toContain('expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION');
    expect(runtime).not.toContain('.playbackRate');
  });
});
