import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const player = vi.hoisted(() => ({ value: { source: null as string | null, activeTrack: null as unknown, status: 'idle' as string } }));
vi.mock('../../contexts/AudioPlayerContext', () => ({ useAudioPlayer: () => player.value }));

import { PlaybackSourceBadge } from './PlaybackSourceBadge';

const render = () => renderToStaticMarkup(createElement(PlaybackSourceBadge));
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('PlaybackSourceBadge', () => {
  it('shows "Streaming preview" with a cloud icon while a track plays from the cloud preview', () => {
    player.value = { source: 'cloud', activeTrack: { id: 't' }, status: 'playing' };
    const markup = render();
    expect(markup).toContain('data-testid="playback-source-badge"');
    expect(markup).toContain('Streaming preview');
    expect(markup).toContain("because your USB isn&#x27;t connected");
    expect(markup).toContain('<svg');
  });

  it('shows nothing when playing from the USB, when idle, or after an error', () => {
    for (const value of [
      { source: 'usb', activeTrack: { id: 't' }, status: 'playing' },
      { source: null, activeTrack: { id: 't' }, status: 'resolving' },
      { source: 'cloud', activeTrack: null, status: 'idle' },
      { source: null, activeTrack: { id: 't' }, status: 'error' },
    ]) {
      player.value = value;
      expect(render()).toBe('');
    }
  });

  it('is on the one shared bottom player used by standard playback screens', () => {
    expect(read('./NowPlayingBar.tsx')).toContain('<PlaybackSourceBadge');
    expect(read('../audition/AuditionTransport.tsx')).not.toContain('<PlaybackSourceBadge');
    expect(read('../cues/CuePointsView.tsx')).not.toContain('<PlaybackSourceBadge');
  });
});
