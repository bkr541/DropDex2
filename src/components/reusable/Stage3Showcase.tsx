import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { RekordboxPreviewWaveform } from '../library/RekordboxPreviewWaveform';
import { ControlButton, IconControlButton } from '../ui/controls';
import {
  MediaTransportControlGroup,
  SelectableOptionRow,
  TransportButton,
} from '../ui/DropDexMedia';
import {
  STAGE3_GRAY_PALETTE,
  STAGE3_GREEN_PALETTE,
  STAGE3_RED_PALETTE,
  STAGE3_SPECTRUM,
  createStage3WaveformState,
} from './stage3WaveformFixture';
import './stage3-showcase.css';
import { ChevronDown, ChevronUp, CircleDash, Launch, OverflowMenuHorizontal, Pause, Play, Settings, Stop, Subtract, VolumeMute, VolumeUp, WarningAlt } from '@carbon/icons-react';

const STAGE3_TRACK_ID = 'stage3-demo-track';
const DEMO_DURATION_SECONDS = 220;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

const DEMO_WAVEFORM = createStage3WaveformState(STAGE3_TRACK_ID);
const DEMO_WAVEFORM_REVERSED = createStage3WaveformState(`${STAGE3_TRACK_ID}-secondary`, STAGE3_SPECTRUM, true);
const DEMO_WAVEFORM_GRAY = createStage3WaveformState(`${STAGE3_TRACK_ID}-gray`, STAGE3_GRAY_PALETTE);
const DEMO_WAVEFORM_RED = createStage3WaveformState(`${STAGE3_TRACK_ID}-red`, STAGE3_RED_PALETTE);
const DEMO_WAVEFORM_GREEN = createStage3WaveformState(`${STAGE3_TRACK_ID}-green`, STAGE3_GREEN_PALETTE);

const WF_LOADING: WaveformLoadState = { status: 'loading', trackId: STAGE3_TRACK_ID };
const WF_UNAVAILABLE: WaveformLoadState = { status: 'unavailable', trackId: STAGE3_TRACK_ID };
const WF_ERROR: WaveformLoadState = { status: 'error', trackId: STAGE3_TRACK_ID, error: 'Failed to load waveform', retryable: true };
const WF_INVALID: WaveformLoadState = { status: 'invalid', trackId: STAGE3_TRACK_ID, error: 'Unsupported file format', reason: 'unsupported', retryable: false };

interface Stage3CardProps {
  label: string;
  children: ReactNode;
  className?: string;
}

function Stage3Card({ label, children, className }: Stage3CardProps) {
  return (
    <section className={cn('dd-stage3-card', className)} data-stage3-card={label}>
      <h3>{label}</h3>
      <div className="dd-stage3-card__content">{children}</div>
    </section>
  );
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function DemoWaveform({
  state = DEMO_WAVEFORM,
  height = 60,
  progress,
  onSeek,
  ariaLabel,
  className,
}: {
  state?: WaveformLoadState;
  height?: number;
  progress?: number;
  onSeek?: (fraction: number) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <RekordboxPreviewWaveform
      state={state}
      height={height}
      variant="transport"
      appearance="rekordbox"
      showCenterLine={false}
      activeProgress={progress}
      onSeek={onSeek}
      ariaLabel={ariaLabel}
      className={cn('dd-stage3-waveform-canvas', className)}
    />
  );
}

function WaveformStateExample({
  state,
  label,
  kind,
}: {
  state: WaveformLoadState;
  label: string;
  kind: 'loading' | 'unavailable' | 'error' | 'invalid';
}) {
  const background = kind === 'error' ? DEMO_WAVEFORM_RED : DEMO_WAVEFORM_GRAY;
  return (
    <div className={cn('dd-stage3-waveform-state', `dd-stage3-waveform-state--${kind}`)}>
      <div className="dd-stage3-waveform-state__visual" aria-hidden="true">
        <DemoWaveform state={background} height={56} />
      </div>
      <div className="dd-stage3-waveform-state__contract">
        <RekordboxPreviewWaveform state={state} height={56} variant="compact" ariaLabel={label} />
      </div>
      <div className="dd-stage3-waveform-state__message" aria-hidden="true">
        {kind === 'loading' && <CircleDash size={17} className="dd-stage3-spin" />}
        {kind === 'unavailable' && <Subtract size={18} />}
        {kind === 'error' && <WarningAlt size={19} />}
        {kind === 'invalid' && <WarningAlt size={18} />}
        <span>{label}</span>
      </div>
    </div>
  );
}

function Artwork({ tone = 'purple', fallback = false }: { tone?: 'purple' | 'blue' | 'pink' | 'green'; fallback?: boolean }) {
  return (
    <div className={cn('dd-stage3-artwork', `dd-stage3-artwork--${tone}`, fallback && 'dd-stage3-artwork--fallback')} aria-hidden="true">
      <span />
    </div>
  );
}

interface DemoTrack {
  id: number;
  title: string;
  artist: string;
  bpm: number;
  key: string;
  time: string;
  rating: number;
  genre: string;
  added: string;
  tone: 'purple' | 'blue' | 'pink' | 'green';
  fallback?: boolean;
}

const TRACKS: DemoTrack[] = [
  { id: 1, title: 'Midnight Roller', artist: 'Camelot', bpm: 128, key: '8A', time: '06:35', rating: 3, genre: 'Tech House', added: '2024-05-21', tone: 'purple' },
  { id: 2, title: 'Innerbloom (Extended Mix)', artist: 'RÜFÜS DU SOL', bpm: 124, key: '7A', time: '07:12', rating: 5, genre: 'Melodic House', added: '2024-05-18', tone: 'blue' },
  { id: 3, title: 'The Cave', artist: 'Maya Jane Coles', bpm: 125, key: '8A', time: '06:57', rating: 3, genre: 'Techno', added: '2024-05-16', tone: 'pink', fallback: true },
  { id: 4, title: 'Higher Place', artist: 'Kölsch', bpm: 126, key: '7A', time: '07:12', rating: 3, genre: 'Melodic Techno', added: '2024-05-12', tone: 'green' },
  { id: 5, title: 'Halcyon', artist: 'Orbital', bpm: 128, key: '8A', time: '06:35', rating: 5, genre: 'Electronica', added: '2024-05-10', tone: 'purple' },
];

function MiniTrackRow({ active = false, onSelect }: { active?: boolean; onSelect?: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn('dd-stage3-track-row', active && 'dd-stage3-track-row--active')}
    >
      <span className="dd-stage3-track-row__play" aria-hidden="true">{active ? <Play size={14} fill="currentColor" /> : null}</span>
      <Artwork tone="purple" />
      <span className="dd-stage3-track-row__copy">
        <strong>Midnight Roller</strong>
        <small>Camelot</small>
      </span>
      <span className="dd-stage3-track-row__meta"><b>128 BPM</b><em>8A</em><span>06:35</span></span>
      <span className="dd-stage3-track-row__wave" aria-hidden="true">
        <DemoWaveform state={active ? DEMO_WAVEFORM_GREEN : DEMO_WAVEFORM_GRAY} height={28} />
      </span>
      <OverflowMenuHorizontal size={16} aria-hidden="true" />
    </button>
  );
}

function TableHeaderPreview() {
  return (
    <div className="dd-stage3-table-header-preview" aria-hidden="true">
      <span>#</span><span>TRACK NAME ▲</span><span>ARTIST</span><span>BPM</span><span>KEY</span><span>TIME</span><span>RATING</span><span>GENRE</span>
    </div>
  );
}

export function Stage3Showcase() {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [seekFraction, setSeekFraction] = useState(0.36);
  const [selectedTrack, setSelectedTrack] = useState(2);
  const [trackRowActive, setTrackRowActive] = useState(true);
  const [listValue, setListValue] = useState('electronic');
  const [sortAscending, setSortAscending] = useState(true);
  const [loadMoreCount, setLoadMoreCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [dockVolume, setDockVolume] = useState(0.74);

  const sortedTracks = useMemo(() => {
    const copy = [...TRACKS];
    copy.sort((a, b) => a.title.localeCompare(b.title) * (sortAscending ? 1 : -1));
    return copy;
  }, [sortAscending]);

  const handleStop = () => {
    setPlaying(false);
    setSeekFraction(0);
    setStatusMessage('Playback stopped');
  };

  const handleTransport = (message: string) => setStatusMessage(message);
  const currentSeconds = seekFraction * DEMO_DURATION_SECONDS;

  const handleTableKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, trackId: number) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setSelectedTrack(trackId);
  };

  return (
    <div className="dd-stage3-board" data-testid="stage3-component-board">
      <div className="dd-stage3-layout">
        <Stage3Card label="Play / Pause Button" className="dd-stage3-play-card">
          <div className="dd-stage3-center">
            <TransportButton label={playing ? 'Pause showcase playback' : 'Play showcase playback'} tone="play" active={playing} onClick={() => setPlaying((value) => !value)}>
              <span className="dd-stage3-play-pair"><Play size={19} fill="currentColor" /><Pause size={17} fill="currentColor" /></span>
            </TransportButton>
          </div>
        </Stage3Card>

        <Stage3Card label="Stop Playback Button" className="dd-stage3-stop-card">
          <div className="dd-stage3-center"><TransportButton label="Stop playback" tone="stop" onClick={handleStop}><Stop size={16} fill="currentColor" /></TransportButton></div>
        </Stage3Card>

        <Stage3Card label="Mute / Unmute Button" className="dd-stage3-mute-card">
          <div className="dd-stage3-mute-examples">
            <TransportButton label="Mute" tone="mute" size="compact" active={muted} onClick={() => setMuted(true)}><VolumeMute size={17} /></TransportButton>
            <TransportButton label="Unmute" tone="mute" size="compact" active={!muted} onClick={() => setMuted(false)}><VolumeUp size={17} /></TransportButton>
          </div>
        </Stage3Card>

        <Stage3Card label="Media Transport Control Group" className="dd-stage3-transport-card">
          <MediaTransportControlGroup
            playing={playing}
            onTogglePlay={() => setPlaying((value) => !value)}
            onPrevious={() => handleTransport('Previous track selected')}
            onRewind={() => setSeekFraction((value) => clamp01(value - 0.1))}
            onForward={() => setSeekFraction((value) => clamp01(value + 0.1))}
            onNext={() => handleTransport('Next track selected')}
          />
        </Stage3Card>

        <Stage3Card label="Waveform — Decorative (Primary)" className="dd-stage3-wave-primary">
          <div className="dd-stage3-wave-surface" aria-hidden="true"><DemoWaveform height={58} /></div>
        </Stage3Card>

        <Stage3Card label="Waveform — Decorative (Secondary)" className="dd-stage3-wave-secondary">
          <div className="dd-stage3-wave-surface" aria-hidden="true"><DemoWaveform state={DEMO_WAVEFORM_REVERSED} height={58} /></div>
        </Stage3Card>

        <Stage3Card label="Waveform — With Visualizer Label" className="dd-stage3-wave-label">
          <div className="dd-stage3-labelled-wave">
            <div className="dd-stage3-labelled-wave__meta"><strong>126.00</strong><span>8A</span></div>
            <div className="dd-stage3-labelled-wave__body" aria-hidden="true"><DemoWaveform height={58} /></div>
            <div className="dd-stage3-cue dd-stage3-cue--one"><i /> CUE 1</div>
            <div className="dd-stage3-cue dd-stage3-cue--two"><i /> CUE 2</div>
          </div>
        </Stage3Card>

        <Stage3Card label="Rekordbox Waveform — Loading" className="dd-stage3-state-loading">
          <WaveformStateExample state={WF_LOADING} kind="loading" label="Loading waveform..." />
        </Stage3Card>
        <Stage3Card label="Rekordbox Waveform — Unavailable" className="dd-stage3-state-unavailable">
          <WaveformStateExample state={WF_UNAVAILABLE} kind="unavailable" label="Waveform unavailable" />
        </Stage3Card>
        <Stage3Card label="Rekordbox Waveform — Error" className="dd-stage3-state-error">
          <WaveformStateExample state={WF_ERROR} kind="error" label="Failed to load waveform" />
        </Stage3Card>
        <Stage3Card label="Rekordbox Waveform — Invalid / Unsupported" className="dd-stage3-state-invalid">
          <WaveformStateExample state={WF_INVALID} kind="invalid" label="Unsupported file format" />
        </Stage3Card>

        <Stage3Card label="Interactive / Seekable Waveform" className="dd-stage3-interactive-card">
          <div className="dd-stage3-seek-wave">
            <DemoWaveform
              height={66}
              progress={seekFraction}
              onSeek={setSeekFraction}
              ariaLabel="Seek interactive showcase waveform"
            />
            <div className="dd-stage3-seek-playhead" style={{ left: `${seekFraction * 100}%` }} aria-hidden="true"><span /></div>
            <div className="dd-stage3-seek-cue" style={{ left: '34%' }} aria-hidden="true" />
            <div className="dd-stage3-time-row" aria-hidden="true"><span>1:20</span><strong>{formatTime(currentSeconds)}</strong><span>3:40</span></div>
          </div>
        </Stage3Card>

        <Stage3Card label="Playback Progress Waveform" className="dd-stage3-progress-card">
          <div className="dd-stage3-progress-wave" role="img" aria-label={`${Math.round(seekFraction * 100)} percent playback progress`}>
            <div className="dd-stage3-progress-wave__base" aria-hidden="true"><DemoWaveform state={DEMO_WAVEFORM_GRAY} height={66} /></div>
            <div className="dd-stage3-progress-wave__played" aria-hidden="true" style={{ width: `${seekFraction * 100}%` }}><div><DemoWaveform height={66} /></div></div>
            <div className="dd-stage3-progress-wave__playhead" style={{ left: `${seekFraction * 100}%` }} aria-hidden="true" />
            <div className="dd-stage3-time-row" aria-hidden="true"><span>1:47</span><strong>{formatTime(currentSeconds)}</strong><span>3:56</span></div>
          </div>
        </Stage3Card>

        <Stage3Card label="Hover Track Row" className="dd-stage3-hover-row-card"><MiniTrackRow active={false} onSelect={() => setTrackRowActive(false)} /></Stage3Card>
        <Stage3Card label="Active Track Row" className="dd-stage3-active-row-card"><MiniTrackRow active={trackRowActive} onSelect={() => setTrackRowActive((value) => !value)} /></Stage3Card>

        <Stage3Card label="Selectable Listbox / Option Row" className="dd-stage3-listbox-card">
          <SelectableOptionRow
            label="Electronic"
            ariaLabel="Track genre"
            value={listValue}
            onChange={(value) => { setListValue(value); setStatusMessage(`Genre changed to ${value}`); }}
            items={[
              { value: 'electronic', label: 'Electronic' },
              { value: 'tech-house', label: 'Tech House' },
              { value: 'deep-house', label: 'Deep House' },
              { value: 'melodic-techno', label: 'Melodic Techno' },
              { value: 'minimal', label: 'Minimal' },
              { value: 'drum-bass', label: 'Drum & Bass' },
              { value: 'trance', label: 'Trance' },
            ]}
          />
        </Stage3Card>

        <Stage3Card label="Data Table / Track Table" className="dd-stage3-table-card">
          <div className="dd-stage3-table-scroll">
            <table className="dd-stage3-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th><button type="button" aria-label="Sort by track name" onClick={() => setSortAscending((value) => !value)}>TRACK NAME <span aria-hidden="true">{sortAscending ? '▲' : '▼'}</span></button></th>
                  <th>ARTIST</th><th>BPM</th><th>KEY</th><th>TIME</th><th>RATING</th><th>GENRE</th><th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {sortedTracks.map((track) => (
                  <tr
                    key={track.id}
                    tabIndex={0}
                    data-selected={selectedTrack === track.id ? 'true' : 'false'}
                    onClick={() => setSelectedTrack(track.id)}
                    onKeyDown={(event) => handleTableKeyDown(event, track.id)}
                  >
                    <td>{track.id}</td>
                    <td><span className="dd-stage3-table-title"><Artwork tone={track.tone} fallback={track.fallback} /><strong title={track.title}>{track.title}</strong></span></td>
                    <td>{track.artist}</td><td>{track.bpm}</td><td className="dd-stage3-key">{track.key}</td><td>{track.time}</td>
                    <td><span className="dd-stage3-stars" aria-label={`${track.rating} out of 5 stars`}>{Array.from({ length: 5 }, (_, index) => <i key={index} data-on={index < track.rating ? 'true' : 'false'}>★</i>)}</span></td>
                    <td>{track.genre}</td>
                    <td><button type="button" aria-label={`Actions for ${track.title}`} onClick={(event) => { event.stopPropagation(); setStatusMessage(`Actions opened for ${track.title}`); }}><OverflowMenuHorizontal size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Stage3Card>

        <Stage3Card label="Table Header / Column Header Row" className="dd-stage3-header-card"><TableHeaderPreview /></Stage3Card>

        <Stage3Card label="Load More Button" className="dd-stage3-load-card">
          <ControlButton
            variant="surface"
            className="dd-stage3-load-more"
            onClick={() => { setLoadMoreCount((count) => count + 1); setStatusMessage('Load more callback invoked'); }}
          >
            <ChevronDown size={15} /> LOAD MORE
          </ControlButton>
        </Stage3Card>

        <Stage3Card label="External Link Icon Action" className="dd-stage3-external-card">
          <IconControlButton label="Open external track link" tone="blue" className="dd-stage3-external" onClick={() => setStatusMessage('External link action activated')}><Launch size={18} /></IconControlButton>
        </Stage3Card>

        <Stage3Card label="Sticky Action / Transport Dock" className="dd-stage3-dock-card">
          <div className="dd-stage3-dock">
            <Artwork tone="purple" />
            <div className="dd-stage3-dock__copy"><strong>Midnight Roller</strong><small>Camelot</small></div>
            <span className="dd-stage3-dock__metric"><b>128 BPM</b><em>8A</em><span>06:35</span></span>
            <div className="dd-stage3-dock__divider" aria-hidden="true" />
            <MediaTransportControlGroup
              compact
              ariaLabel="Sticky dock transport controls"
              playing={playing}
              onTogglePlay={() => setPlaying((value) => !value)}
              onPrevious={() => handleTransport('Dock previous track selected')}
              onRewind={() => setSeekFraction((value) => clamp01(value - 0.05))}
              onForward={() => setSeekFraction((value) => clamp01(value + 0.05))}
              onNext={() => handleTransport('Dock next track selected')}
            />
            <span className="dd-stage3-dock__time">{formatTime(currentSeconds)} / 03:56</span>
            <input aria-label="Dock playback position" type="range" min="0" max="1" step="0.01" value={seekFraction} onChange={(event) => setSeekFraction(Number(event.target.value))} />
            <button type="button" className="dd-stage3-dock__utility" aria-label="Open dock filters"><Settings size={15} /></button>
            <span className="dd-stage3-dock__key">8A</span>
            <button type="button" className="dd-stage3-dock__utility" aria-label={muted ? 'Unmute dock' : 'Mute dock'} onClick={() => setMuted((value) => !value)}>{muted ? <VolumeMute size={15} /> : <VolumeUp size={15} />}</button>
            <input aria-label="Dock volume" type="range" min="0" max="1" step="0.02" value={muted ? 0 : dockVolume} onChange={(event) => { setMuted(false); setDockVolume(Number(event.target.value)); }} />
            <button type="button" className="dd-stage3-dock__utility" aria-label="Open dock settings"><Settings size={15} /></button>
            <button type="button" className="dd-stage3-dock__utility" aria-label="Collapse transport dock"><ChevronUp size={15} /></button>
          </div>
        </Stage3Card>
      </div>
      <span className="sr-only" role="status">{statusMessage}{loadMoreCount > 0 ? ` (${loadMoreCount})` : ''}</span>
    </div>
  );
}
