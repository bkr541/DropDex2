import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Roulette Stage 3 preview production path', () => {
  it('crosses the renderer/preload/Electron/worker boundary with source-media recovery and a 16-bar clip', () => {
    const service = read('src/features/roulette/roulettePreviewPreparationService.ts');
    const preload = read('electron/preload.cjs');
    const main = read('electron/main.cjs');
    const bridge = read('electron/stemSeparationBridge.cjs');
    const worker = read('bridge/rekordbox_bridge/stem_separator.py');

    expect(service).toContain('desktop.prepareRoulettePreview(input)');
    expect(service).toContain("'source-required'");
    expect(preload).toContain("ipcRenderer.invoke('dropdex:prepare-roulette-preview'");
    expect(preload).toContain("ipcRenderer.invoke('dropdex:reconnect-usb'");
    expect(main).toContain("ipcMain.handle('dropdex:prepare-roulette-preview'");
    expect(main).toContain("kind: 'source_media_required'");
    expect(main).toContain("kind: 'source_media_mismatch'");
    expect(main).toContain('resolveUsbTrackPath(payload.sourceSegments)');
    expect(bridge).toContain('this.previewQueue');
    expect(bridge).toContain("'--window-start-ms'");
    expect(worker).toContain('extract_audio_window');
    expect(worker).toContain('window_duration_ms');
  });

  it('keeps preview storage distinct from canonical HQ generated stems', () => {
    const bridge = read('electron/stemSeparationBridge.cjs');
    const service = read('src/features/roulette/roulettePreviewPreparationService.ts');
    expect(bridge).toContain("['previews', trackDir, identityDir]");
    expect(bridge).toContain("['generated', trackDir, identityDir]");
    expect(service).toContain("kind: 'hq'");
    expect(service).toContain("kind: 'preview'");
  });
});
