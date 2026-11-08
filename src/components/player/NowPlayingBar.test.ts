import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioPlayerContextValue } from '../../contexts/AudioPlayerContext';
import type { AudioDockWorkspace } from '../../contexts/AudioDockWorkspaceContext';
import type { RekordboxTrack } from '../../types';
import { NowPlayingBar } from './NowPlayingBar';
import type { EssentialAudioDock } from './EssentialAudioDock';

const state = vi.hoisted(() => ({ player: null as unknown as AudioPlayerContextValue,
  workspace: null as AudioDockWorkspace | null, props: null as unknown as Parameters<typeof EssentialAudioDock>[0],
  waveforms: vi.fn(), connect: vi.fn() }));
vi.mock('../../contexts/AudioPlayerContext', () => ({ useAudioPlayer: () => state.player }));
vi.mock('../../contexts/AudioDockWorkspaceContext', () => ({ useAudioDockWorkspace: () => state.workspace }));
vi.mock('../../contexts/UsbConnectionContext', () => ({ useUsbConnection: () => ({ status: 'disconnected', connect: state.connect }) }));
vi.mock('../../hooks/useTrackPreviewWaveforms', () => ({ useTrackPreviewWaveforms: (importId: unknown, ids: string[]) => {
  state.waveforms(importId, ids);
  return { getState: () => ({ status: 'unavailable', trackId: 't2' }) };
} }));
vi.mock('../library/RekordboxPreviewWaveform', () => ({ RekordboxPreviewWaveform: () => null }));
vi.mock('./EssentialAudioDock', () => ({ EssentialAudioDock: (props: Parameters<typeof EssentialAudioDock>[0]) => {
  state.props = props;
  return createElement('div', { className: 'adl-dock' }, props.transport, props.identity, props.timeline, props.metadata, props.output);
} }));
const tracks = [1, 2, 3].map((number) => ({ id: `t${number}`, title: `Track ${number}`, artist: 'Artist', import_id: 'import',
  duration_ms: 120_000, bpm: 140, musical_key: '7A' }) as RekordboxTrack);
const audio = { currentTime: 42, duration: 120 };
const render = (independentWorkspace?: string) => renderToStaticMarkup(createElement(NowPlayingBar, { independentWorkspace }));
const children = (node: unknown): ReactElement<any>[] => (node as ReactElement<any>).props.children;
const button = (label: string) => [...children(state.props.transport), ...children(state.props.output)]
  .find((node) => node.props.label === label)!.props;
const seekInput = () => children(children(state.props.timeline)[1]).find((node) => node?.type === 'input')!.props;
const volumeInput = () => children(state.props.output).find((node) => node.type === 'input')!.props;

beforeEach(() => {
  vi.clearAllMocks();
  audio.currentTime = 42;
  state.player = { activeTrack: tracks[1], status: 'playing', playIntent: true, volume: 0.7, muted: false,
    repeat: false, error: null, source: 'usb', objectUrl: null,
    playTrack: vi.fn(), toggleTrack: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), seek: vi.fn(),
    setVolume: vi.fn(), toggleMute: vi.fn(), toggleRepeat: vi.fn(), clearError: vi.fn(), getAudioElement: () => audio as HTMLAudioElement };
  state.workspace = { tracks, selectedTrack: tracks[1], onSelectTrack: vi.fn() };
});

describe('application Essential Strip audio dock', () => {
  it('stays visible when idle and can start the selected track', () => {
    state.player.activeTrack = null;
    state.player.status = 'idle';
    const markup = render();
    expect(markup).toContain('data-testid="application-audio-dock"');
    expect(markup).toContain('Track 2');
    button('Play').onClick();
    expect(state.player.playTrack).toHaveBeenCalledWith(tracks[1]);
  });

  it('shows an honest empty state with seeking and play disabled', () => {
    state.player.activeTrack = null;
    state.player.status = 'idle';
    state.workspace = null;
    expect(render()).toContain('Nothing playing yet');
    expect(button('Play').disabled).toBe(true);
    expect(seekInput().disabled).toBe(true);
  });

  it('pauses, resumes, and retries through the existing standard player', () => {
    render(); button('Pause').onClick();
    expect(state.player.pause).toHaveBeenCalledOnce();
    state.player.playIntent = false; state.player.status = 'paused';
    render(); button('Play').onClick();
    expect(state.player.resume).toHaveBeenCalledOnce();
    state.player.status = 'error'; state.player.error = 'Source unavailable';
    expect(render()).toContain('Source unavailable');
    button('Retry playback').onClick();
    expect(state.player.playTrack).toHaveBeenCalledWith(tracks[1]);
  });

  it('steps through the screen queue and updates its selection', () => {
    render(); button('Previous track').onClick();
    expect(state.workspace?.onSelectTrack).toHaveBeenCalledWith(tracks[0]);
    expect(state.player.playTrack).toHaveBeenCalledWith(tracks[0]);
    button('Next track').onClick();
    expect(state.workspace?.onSelectTrack).toHaveBeenCalledWith(tracks[2]);
    expect(state.player.playTrack).toHaveBeenCalledWith(tracks[2]);
  });

  it('disables stepping at queue boundaries without wrapping', () => {
    state.player.activeTrack = tracks[0]; render();
    expect(button('Previous track').disabled).toBe(true);
    state.player.activeTrack = tracks[2]; render();
    expect(button('Next track').disabled).toBe(true);
  });

  it('seeks with the waveform slider and clamps the 10-second jumps to the audio duration', () => {
    audio.currentTime = 115; render();
    expect(seekInput()['aria-valuetext']).toBe('1:55 of 2:00');
    button('Forward 10 seconds').onClick();
    expect(state.player.seek).toHaveBeenLastCalledWith(120);
    button('Rewind 10 seconds').onClick();
    expect(state.player.seek).toHaveBeenLastCalledWith(105);
    seekInput().onChange({ target: { value: '300' } });
    expect(state.player.seek).toHaveBeenLastCalledWith(120);
  });

  it('connects repeat, volume, unmute, mute and stop to the shared player', () => {
    state.player.muted = true; render();
    button('Repeat track').onClick();
    expect(state.player.toggleRepeat).toHaveBeenCalledOnce();
    volumeInput().onChange({ target: { value: '0.3' } });
    expect(state.player.setVolume).toHaveBeenCalledWith(0.3);
    expect(state.player.toggleMute).toHaveBeenCalledOnce();
    button('Unmute').onClick();
    expect(state.player.toggleMute).toHaveBeenCalledTimes(2);
    button('Stop playback').onClick();
    expect(state.player.stop).toHaveBeenCalledOnce();
  });

  it('blocks playback navigation and seeking while the source loads', () => {
    state.player.status = 'resolving'; render();
    expect(button('Loading audio').disabled).toBe(true);
    expect(button('Next track').disabled).toBe(true);
    expect(seekInput().disabled).toBe(true);
    button('Loading audio').onClick(); button('Forward 10 seconds').onClick();
    expect(state.player.resume).not.toHaveBeenCalled();
    expect(state.player.seek).not.toHaveBeenCalled();
  });

  it('preserves the streaming preview disclosure for cloud playback', () => {
    state.player.source = 'cloud';
    expect(render()).toContain('Streaming preview');
  });

  it.each(['Drop Lab', 'Set Lab', 'Flip Lab'])('shows an inert dock in %s, even if a standard track is still active', (workspace) => {
    const markup = render(workspace);
    expect(markup).toContain('data-player-mode="independent"');
    expect(markup).toContain(`${workspace} playback`);
    expect(markup).not.toContain('Track 2');
    for (const group of [state.props.transport, state.props.output]) {
      for (const child of children(group)) {
        expect(child.props.disabled).toBe(true);
        child.props.onClick?.();
      }
    }
    seekInput().onChange({ target: { value: '60' } });
    volumeInput().onChange({ target: { value: '0.2' } });
    expect(seekInput().disabled).toBe(true);
    for (const action of ['pause', 'resume', 'playTrack', 'seek', 'stop', 'toggleRepeat', 'toggleMute', 'setVolume'] as const)
      expect(state.player[action]).not.toHaveBeenCalled();
    expect(state.waveforms).toHaveBeenLastCalledWith(null, []);
  });
});
