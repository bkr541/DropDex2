import { useEffect, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { CompactDisc, MoreHoriz, Pause, Play, Refresh, Repeat, SkipNext, SkipPrev, SoundHigh, SoundOff, Eject, Usb, WarningTriangle, Xmark } from 'iconoir-react/regular';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useAudioDockWorkspace } from '../../contexts/AudioDockWorkspaceContext';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { durationMsForTrack } from '../../lib/music/trackTiming';
import { formatKey } from '../../lib/utils';
import { RekordboxPreviewWaveform } from '../library/RekordboxPreviewWaveform';
import { Artwork } from '../ui/display/Artwork';
import { ControlButton } from '../ui/controls/ControlButton';
import { EssentialAudioDock } from './EssentialAudioDock';
import { UsbConnectionButton } from '../usb/UsbConnectionButton';
import { PlaybackSourceBadge } from './PlaybackSourceBadge';
import './application-audio-dock.css';

function time(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

/** Poll only this small transport while audio is playing; media events also update paused seeks. */
function usePlayerTime(getAudioElement: () => HTMLAudioElement | null, trackId: string | undefined, playing: boolean) {
  const [clock, setClock] = useState(() => {
    const audio = trackId ? getAudioElement() : null;
    return { trackId, position: audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0, duration: audio && Number.isFinite(audio.duration) ? audio.duration : 0 };
  });
  useEffect(() => {
    const audio = trackId ? getAudioElement() : null;
    const update = () => setClock({ trackId, position: audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      duration: audio && Number.isFinite(audio.duration) ? audio.duration : 0 });
    update();
    const events = ['timeupdate', 'durationchange', 'loadedmetadata', 'seeked', 'ended', 'emptied'];
    events.forEach((name) => audio?.addEventListener(name, update));
    const interval = playing ? window.setInterval(update, 50) : null;
    return () => {
      events.forEach((name) => audio?.removeEventListener(name, update));
      if (interval != null) window.clearInterval(interval);
    };
  }, [getAudioElement, trackId, playing]);
  return clock.trackId === trackId ? clock : { trackId, position: 0, duration: 0 };
}

function DockButton({ icon: Icon, label, active, children, primary, loading, className, ...props }: {
  icon?: ElementType; label: string; active?: boolean; primary?: boolean; loading?: boolean; children?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type="button" title={label} aria-label={label} aria-pressed={active}
    className={`adl-icon-button${primary ? ' adl-play' : ''}${active ? ' adl-active' : ''}${className ? ` ${className}` : ''}`}>
    {Icon && <Icon width={17} height={17} aria-hidden="true" className={loading ? 'animate-spin' : undefined} />}{children}
  </button>;
}

export interface NowPlayingBarProps {
  /** Separate engines retain their own controls. The bottom dock is a disabled placeholder there. */
  independentWorkspace?: string;
}

export function NowPlayingBar({ independentWorkspace }: NowPlayingBarProps) {
  const player = useAudioPlayer();
  const workspace = useAudioDockWorkspace();
  const usb = useUsbConnection();
  const standard = !independentWorkspace;
  const track = standard ? player.activeTrack ?? workspace?.selectedTrack ?? workspace?.tracks[0] ?? null : null;
  const active = standard && !!track && track.id === player.activeTrack?.id;
  const loading = active && ['resolving', 'loading'].includes(player.status);
  const buffering = active && ['buffering', 'seeking'].includes(player.status);
  const failed = standard && player.status === 'error';
  const playing = active && player.playIntent && !failed;
  const clock = usePlayerTime(player.getAudioElement, standard ? player.activeTrack?.id : undefined, playing);
  const audio = active ? player.getAudioElement() : null;
  const audioDuration = audio && Number.isFinite(audio.duration) ? audio.duration : clock.duration;
  const duration = audioDuration > 0 ? audioDuration : track ? (durationMsForTrack(track, null) ?? 0) / 1000 : 0;
  const position = active ? Math.max(0, Math.min(duration, clock.position)) : 0;
  const seekable = active && !loading && !failed && audioDuration > 0;
  const blocked = !standard || !track || loading;
  const queue = workspace?.tracks ?? [];
  const index = track ? queue.findIndex((item) => item.id === track.id) : -1;
  const previous = index > 0 ? queue[index - 1] : null;
  const next = index >= 0 && index < queue.length - 1 ? queue[index + 1] : null;
  const waveformIds = track ? [track.id] : [];
  const waveforms = useTrackPreviewWaveforms(track?.import_id ?? null, waveformIds);
  const waveform = waveforms.getState(track?.id);

  function togglePlay() {
    if (blocked) return;
    if (active && playing) player.pause();
    else if (active && !failed) void player.resume();
    else void player.playTrack(track);
  }
  function adjacent(destination: typeof track) {
    if (blocked || !destination) return;
    workspace?.onSelectTrack?.(destination);
    void player.playTrack(destination);
  }
  function seek(seconds: number) {
    if (seekable) player.seek(Math.max(0, Math.min(duration, seconds)));
  }

  const transport = <div className="adl-transport" role="group" aria-label="Playback controls">
    <span className="adl-usb" data-testid="dock-usb"><UsbConnectionButton collapsed />
    <DockButton className="adl-eject" icon={Eject} label="Eject (stop playback)" disabled={!standard || player.status === 'idle'} onClick={() => { if (standard) player.stop(); }} />
    </span>
    <DockButton icon={SkipPrev} label="Previous track" disabled={blocked || !previous} onClick={() => adjacent(previous)} />
    <DockButton icon={loading || buffering ? Refresh : playing ? Pause : Play} label={loading ? 'Loading audio' : failed ? 'Retry playback' : playing ? 'Pause' : 'Play'}
      primary loading={loading || buffering} active={playing} disabled={blocked} onClick={togglePlay} />
    <DockButton icon={SkipNext} label="Next track" disabled={blocked || !next} onClick={() => adjacent(next)} />
  </div>;
  const identity = <div className="adl-identity">
    <Artwork src={track?.artwork_path} alt={track ? `Artwork for ${track.title}` : 'No track selected'} className="adl-art" fallbackIcon={<CompactDisc width={29} height={29} />} />
    <div className="adl-identity-text"><strong title={track?.title ?? undefined}>{track?.title || (independentWorkspace ? `${independentWorkspace} playback` : 'Nothing playing yet')}</strong>
      <span>{track?.artist || (independentWorkspace ? 'Use the workspace controls' : track ? 'Artist Not Available' : 'Choose a track from any page')}</span></div>
  </div>;
  const timeline = <div className="adl-timeline adl-timeline-wave">
    <span className="adl-time">{time(position)}</span>
    <div className="adl-seek" style={{ '--adl-progress': `${duration > 0 ? position / duration * 100 : 0}%` } as CSSProperties}>
      {waveform.status === 'loaded' ? <RekordboxPreviewWaveform state={waveform} height={35} variant="transport" appearance="dropdex"
        surface={false} showCenterLine={false} tint="#8997AE" activeProgress={duration > 0 ? position / duration : 0}
        ariaLabel={track ? `Playback waveform for ${track.title}` : 'Playback waveform'} className="app-dock-waveform" />
        : <span className="adl-progress-rail"><span /></span>}
      <input type="range" min={0} max={duration || 1} step={0.1} value={position} disabled={!seekable}
        aria-label="Playback position" aria-valuetext={`${time(position)} of ${time(duration)}`} onChange={(event) => seek(Number(event.target.value))} />
    </div><span className="adl-time">{time(duration)}</span>
  </div>;
  const key = track?.musical_key ? formatKey(track.musical_key) : '—';
  const metadata = <>
    <span><strong>{track?.bpm ? track.bpm.toFixed(1) : '—'}</strong><small>BPM</small></span>
    <span><strong title={key}>{key}</strong><small>Key</small></span>
  </>;
  const output = <div className="adl-output" role="group" aria-label="Output controls">
    <DockButton icon={Repeat} label="Repeat track" active={standard && player.repeat} disabled={blocked} onClick={() => { if (!blocked) player.toggleRepeat(); }} />
    <DockButton icon={player.muted || player.volume === 0 ? SoundOff : SoundHigh} label={player.muted ? 'Unmute' : 'Mute'}
      active={standard && player.muted} disabled={!standard} onClick={() => { if (standard) player.toggleMute(); }} />
    <input type="range" min={0} max={1} step={0.01} value={standard && !player.muted ? player.volume : 0} aria-label="Volume" disabled={!standard}
      onChange={(event) => { if (standard) { player.setVolume(Number(event.target.value)); if (player.muted) player.toggleMute(); } }} />
    <DockButton icon={MoreHoriz} label="Reserved control 1" className="adl-placeholder" disabled />
    <DockButton icon={MoreHoriz} label="Reserved control 2" className="adl-placeholder" disabled />
    <DockButton icon={MoreHoriz} label="Reserved control 3" className="adl-placeholder" disabled />
  </div>;

  return <footer className="app-audio-dock adl-style-edge" aria-label="Now Playing" data-testid="application-audio-dock" data-player-mode={standard ? 'standard' : 'independent'}>
    {failed && <div className="app-dock-status" role="alert"><WarningTriangle width={14} height={14} aria-hidden="true" /><span>{player.error}</span>
      {usb.status !== 'connected' && <ControlButton variant="primary" onClick={() => void usb.connect()}><Usb width={13} height={13} aria-hidden="true" />Connect USB</ControlButton>}
      <button type="button" onClick={player.clearError} aria-label="Dismiss error"><Xmark width={14} height={14} aria-hidden="true" /></button>
    </div>}
    {standard && player.source === 'cloud' && <div className="app-dock-source"><PlaybackSourceBadge /></div>}
    <EssentialAudioDock transport={transport} identity={identity} timeline={timeline} metadata={metadata} output={output} />
  </footer>;
}
