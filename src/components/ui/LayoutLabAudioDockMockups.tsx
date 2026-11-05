import { useEffect, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import {
  CheckmarkFilled, ChevronDown, ChevronUp, CircleDash, Headphones, Music,
  Pause, Play, Repeat, SkipBack, SkipForward, Stop, Usb, VolumeMute, VolumeUp, WarningAlt,
} from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import './layout-lab-audio-dock.css';

type PreviewState = 'ready' | 'empty' | 'loading' | 'disconnected';
type DockKind = 'edge' | 'center' | 'capsule' | 'waveform' | 'islands' | 'console' | 'editorial' | 'vinyl' | 'shelf' | 'compact';

const TRACKS = [
  { title: 'WIde Open (MAVIC FLIP) Final', artist: 'DISCO LINES', duration: 167, bpm: '140.0', key: '7A', genre: 'Bass House' },
  { title: 'Ring The Alarm (HAHNER Edit)', artist: 'DJ Snake & Malaa', duration: 147, bpm: '145.0', key: '12A', genre: 'Dubstep' },
  { title: 'Disappearance w EVOKE45', artist: 'EVOKE45', duration: 231, bpm: '150.0', key: '10A', genre: 'Trap' },
];

const CONCEPTS: { kind: DockKind; name: string; description: string; footprint: string; accent: string }[] = [
  { kind: 'edge', name: 'Essential Strip', description: 'One quiet, full-width row. Maximum space for the work above.', footprint: '72 px · edge to edge', accent: '#62a5ff' },
  { kind: 'center', name: 'Center Stage', description: 'A centered transport with a dedicated progress line and balanced side panels.', footprint: '112 px · centered transport', accent: '#f08075' },
  { kind: 'capsule', name: 'Floating Capsule', description: 'A single rounded island, lifted off the canvas with a slim timeline beneath the controls.', footprint: '92 px · floating', accent: '#6bdfc1' },
  { kind: 'waveform', name: 'Waveform First', description: 'The track becomes the timeline. A broad waveform sits above the control row.', footprint: '140 px · waveform focus', accent: '#6eb8e8' },
  { kind: 'islands', name: 'Three Islands', description: 'Track, transport and output each get their own floating surface.', footprint: '104 px · modular', accent: '#b59bff' },
  { kind: 'console', name: 'Studio Console', description: 'Segmented controls, a time readout and a restrained output meter on a hardware faceplate.', footprint: '112 px · instrument panel', accent: '#d9e4ee' },
  { kind: 'editorial', name: 'Open Type', description: 'A large track name, unboxed controls and a fine progress rule. Almost no chrome.', footprint: '112 px · borderless', accent: '#f0bc78' },
  { kind: 'vinyl', name: 'Vinyl Hub', description: 'A circular play control anchors the left edge; the waveform stretches across the remaining space.', footprint: '112 px · circular anchor', accent: '#ed7c91' },
  { kind: 'shelf', name: 'Context Shelf', description: 'A thin identity and source rail above a clean, uninterrupted playback band.', footprint: '108 px · two tiers', accent: '#8cc9ad' },
  { kind: 'compact', name: 'Pocket Dock', description: 'A compact centered dock that opens to reveal seeking, track details and output controls.', footprint: '64 / 128 px · expandable', accent: '#b8c8ff' },
];

function time(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function IconButton({ icon: Icon, label, onClick, disabled, active, className, children }: {
  icon?: ElementType; label: string; onClick: () => void; disabled?: boolean; active?: boolean; className?: string; children?: ReactNode;
}) {
  return <button type="button" aria-label={label} aria-pressed={active} title={label} disabled={disabled} onClick={onClick} className={cn('adl-icon-button', className, active && 'adl-active')}>{Icon && <Icon size={17} aria-hidden="true" />}{children}</button>;
}

function Artwork({ vinyl = false }: { vinyl?: boolean }) {
  return <div className={cn('adl-art', vinyl && 'adl-art-vinyl')} aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="19" /><circle cx="24" cy="24" r="14" /><circle cx="24" cy="24" r="8" /><circle cx="24" cy="24" r="2" /></svg></div>;
}

function Workspace({ trackIndex, context, disconnected }: { trackIndex: number; context: string; disconnected: boolean }) {
  return <div className="adl-workspace" aria-hidden="true">
    <div className="adl-context-nav"><img src="/logos/dropdexlogo.png" alt="" /><Music size={17} /><Headphones size={17} /><Usb size={17} /></div>
    <div className="adl-context-body">
      <div className="adl-context-heading"><span>WORKSPACE / {context.toUpperCase()}</span><span><span className={cn('adl-status-dot', disconnected && 'adl-disconnected-dot')} /> DVYDRMNG {disconnected ? 'disconnected' : 'connected'}</span></div>
      <div className="adl-context-title"><h4>{context === 'Library' ? 'Your collection.' : context === 'Cue Points' ? 'Find the moment.' : context === 'Audition' ? 'Listen a little closer.' : 'Build the next transition.'}</h4><span>45 tracks · 8 playlists</span></div>
      <div className="adl-context-table">{TRACKS.slice(0, 2).map((track, index) => <div key={track.title} className={index === trackIndex ? 'adl-context-selected' : ''}><Music size={13} /><span>{track.title}</span><span>{track.artist}</span><span>{track.bpm} BPM</span><span>{track.key}</span></div>)}</div>
    </div>
  </div>;
}

function DockPreview({ concept, state, context }: { concept: typeof CONCEPTS[number]; state: PreviewState; context: string }) {
  const [trackIndex, setTrackIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(48);
  const [volume, setVolume] = useState(72);
  const [muted, setMuted] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [reconnected, setReconnected] = useState(false);
  const track = TRACKS[trackIndex];
  const disconnected = state === 'disconnected' && !reconnected;
  const available = state === 'ready' || (state === 'disconnected' && reconnected);
  const hasTrack = state !== 'empty';
  const progress = hasTrack ? position / track.duration : 0;

  useEffect(() => {
    setPlaying(false);
    setReconnected(false);
  }, [state]);

  useEffect(() => {
    if (!playing || !available) return;
    const timer = window.setInterval(() => setPosition((current) => {
      if (current + 1 < track.duration) return current + 1;
      return repeat ? 0 : track.duration;
    }), 1000);
    return () => window.clearInterval(timer);
  }, [playing, available, repeat, track.duration]);

  useEffect(() => {
    if (position >= track.duration && !repeat) setPlaying(false);
  }, [position, track.duration, repeat]);

  function changeTrack(offset: number) {
    setTrackIndex((current) => (current + offset + TRACKS.length) % TRACKS.length);
    setPosition(0);
  }

  const identity = (art = true, metadata = false) => <div className="adl-identity">
    {art && <Artwork />}
    <div className="adl-identity-text"><strong>{hasTrack ? track.title : 'Nothing playing yet'}</strong><span>{hasTrack ? track.artist : 'Choose a track from any page'}</span>{metadata && <div className="adl-inline-metadata">{stats()}</div>}</div>
  </div>;

  const stats = () => <><span>{hasTrack ? track.bpm : '—'} <small>BPM</small></span><span className="adl-key">{hasTrack ? track.key : '—'}</span><span className="adl-genre">{hasTrack ? track.genre : 'No track'}</span></>;

  const transport = (primary = true) => <div className="adl-transport" role="group" aria-label="Playback controls">
    <IconButton icon={SkipBack} label="Previous track" disabled={!available} onClick={() => changeTrack(-1)} />
    <IconButton label="Rewind 10 seconds" disabled={!available} onClick={() => setPosition((current) => Math.max(0, current - 10))}><span className="adl-jump">↶<small>10</small></span></IconButton>
    {primary && <IconButton icon={state === 'loading' ? CircleDash : playing && available ? Pause : Play} label={playing && available ? 'Pause preview' : 'Play preview'} className={cn('adl-play', state === 'loading' && 'adl-loading')} disabled={!available} onClick={() => { if(position >= track.duration) setPosition(0); setPlaying(!playing); }} active={playing && available} />}
    <IconButton label="Forward 10 seconds" disabled={!available} onClick={() => setPosition((current) => Math.min(track.duration, current + 10))}><span className="adl-jump">↷<small>10</small></span></IconButton>
    <IconButton icon={SkipForward} label="Next track" disabled={!available} onClick={() => changeTrack(1)} />
  </div>;

  const timeline = (wave = false) => <div className={cn('adl-timeline', wave && 'adl-timeline-wave')}>
    <span className="adl-time">{time(hasTrack ? position : 0)}</span>
    <div className="adl-seek" style={{ '--adl-progress': `${progress * 100}%` } as CSSProperties}>
      {wave ? <svg viewBox="0 0 600 42" preserveAspectRatio="none" className="adl-wave" aria-hidden="true">
        <defs><clipPath id={`adl-clip-${concept.kind}`}><rect x="0" y="0" width={600 * progress} height="42" /></clipPath></defs>
        {[false, true].map((played) => <g key={String(played)} clipPath={played ? `url(#adl-clip-${concept.kind})` : undefined} className={played ? 'adl-wave-played' : 'adl-wave-unplayed'}>{Array.from({ length: 150 }, (_, i) => {
          const height = hasTrack ? 4 + Math.abs(Math.sin(i * .23 + trackIndex) * Math.cos(i * .061)) * 34 : 2;
          return <rect key={i} x={i * 4 + 1} y={(42 - height) / 2} width="2" height={height} rx="1" />;
        })}</g>)}
      </svg> : <span className="adl-progress-rail"><span /></span>}
      <input type="range" min={0} max={hasTrack ? track.duration : 1} step={1} value={hasTrack ? position : 0} disabled={!available} aria-label="Playback position" aria-valuetext={`${time(hasTrack ? position : 0)} of ${time(hasTrack ? track.duration : 0)}`} onChange={(event) => setPosition(Number(event.target.value))} />
    </div>
    <span className="adl-time">{time(hasTrack ? track.duration : 0)}</span>
  </div>;

  const output = (showStop = true) => <div className="adl-output" role="group" aria-label="Output controls">
    <IconButton icon={Repeat} label="Repeat track" active={repeat} disabled={!available} onClick={() => setRepeat(!repeat)} />
    <IconButton icon={muted || volume === 0 ? VolumeMute : VolumeUp} label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={() => setMuted(!muted)} />
    <input type="range" min={0} max={100} value={muted ? 0 : volume} aria-label="Volume" onChange={(event) => { setVolume(Number(event.target.value)); setMuted(false); }} />
    {showStop && <IconButton icon={Stop} label="Stop playback" disabled={!available} onClick={() => { setPlaying(false); setPosition(0); }} />}
  </div>;

  const source = () => <span className="adl-source"><Usb size={12} /> DVYDRMNG <span className={cn('adl-source-dot', disconnected && 'adl-disconnected-dot')} /></span>;

  function dockContent() {
    switch (concept.kind) {
      case 'edge': return <>{identity()}{transport()}{timeline(true)}<div className="adl-metadata">{stats()}</div>{output()}</>;
      case 'center': return <>{identity(true, true)}<div className="adl-center-stack">{transport()}{timeline()}</div><div className="adl-right-stack">{source()}{output()}</div></>;
      case 'capsule': return <><div className="adl-capsule-top">{identity()}{transport()}<div className="adl-metadata">{stats()}</div>{output()}</div>{timeline()}</>;
      case 'waveform': return <>{timeline(true)}<div className="adl-waveform-bottom">{identity()}{transport()}<div className="adl-metadata">{stats()}</div>{output()}</div></>;
      case 'islands': return <><div className="adl-island adl-track-island">{identity(true, true)}</div><div className="adl-island adl-transport-island">{transport()}{timeline()}</div><div className="adl-island adl-output-island">{source()}{output()}</div></>;
      case 'console': return <><div className="adl-console-identity">{identity(false)}<div className="adl-metadata">{stats()}</div></div><div className="adl-console-readout"><span>ELAPSED / TOTAL</span><strong>{time(hasTrack ? position : 0)}<small> / {time(hasTrack ? track.duration : 0)}</small></strong></div><div className="adl-console-center">{transport()}{timeline()}</div><div className="adl-console-output"><div className={cn('adl-meter', playing && available && 'adl-meter-running')} aria-hidden="true">{Array.from({length: 14}, (_, i) => <i key={i} style={{ animationDelay: `${i * -.13}s`, opacity: i < (muted ? 0 : Math.round(volume / 8)) ? 1 : .15 }} />)}</div>{output()}</div></>;
      case 'editorial': return <><div className="adl-editorial-top">{identity(false, true)}{transport()}{output()}</div>{timeline()}</>;
      case 'vinyl': return <><div className={cn('adl-vinyl', playing && available && 'adl-vinyl-playing')}><Artwork vinyl /><IconButton icon={state === 'loading' ? CircleDash : playing && available ? Pause : Play} label={playing && available ? 'Pause preview' : 'Play preview'} disabled={!available} active={playing && available} className={cn('adl-play', state === 'loading' && 'adl-loading')} onClick={() => { if(position >= track.duration) setPosition(0); setPlaying(!playing); }} /></div><div className="adl-vinyl-track"><div className="adl-vinyl-heading">{identity(false)}<div className="adl-metadata">{stats()}</div></div>{timeline(true)}</div>{transport(false)}{output()}</>;
      case 'shelf': return <><div className="adl-shelf-top">{identity(false)}<div className="adl-metadata">{stats()}</div><span className="adl-context-source">From {context}</span>{source()}</div><div className="adl-shelf-bottom">{transport()}{timeline(true)}{output()}</div></>;
      case 'compact': return <><div className="adl-pocket-top">{identity()}<IconButton icon={SkipBack} label="Previous track" disabled={!available} onClick={() => changeTrack(-1)} /><IconButton icon={state === 'loading' ? CircleDash : playing && available ? Pause : Play} label={playing && available ? 'Pause preview' : 'Play preview'} disabled={!available} active={playing && available} className={cn('adl-play', state === 'loading' && 'adl-loading')} onClick={() => { if(position >= track.duration) setPosition(0); setPlaying(!playing); }} /><IconButton icon={SkipForward} label="Next track" disabled={!available} onClick={() => changeTrack(1)} /><IconButton icon={expanded ? ChevronDown : ChevronUp} label={expanded ? 'Collapse dock' : 'Expand dock'} active={expanded} onClick={() => setExpanded(!expanded)} /></div>{expanded && <div className="adl-pocket-expanded"><div className="adl-pocket-seek"><IconButton label="Rewind 10 seconds" disabled={!available} onClick={() => setPosition((current) => Math.max(0, current - 10))}><span className="adl-jump">↶<small>10</small></span></IconButton>{timeline()}<IconButton label="Forward 10 seconds" disabled={!available} onClick={() => setPosition((current) => Math.min(track.duration, current + 10))}><span className="adl-jump">↷<small>10</small></span></IconButton></div><div className="adl-pocket-details"><div className="adl-metadata">{stats()}</div>{output()}</div></div>}</>;
    }
  }

  return <div className="adl-preview-scroll" role="region" aria-label={`${concept.name} mockup`} tabIndex={0}>
    <div className={cn('adl-preview', `adl-style-${concept.kind}`)} style={{ '--adl-accent': concept.accent } as CSSProperties}>
      <Workspace trackIndex={trackIndex} context={context} disconnected={disconnected} />
      <div className={cn('adl-dock-placement', concept.kind === 'compact' && !expanded && 'adl-collapsed')}>
        {(disconnected || state === 'loading' || state === 'empty') && <div className={cn('adl-state-banner', disconnected && 'adl-state-error')} role="status">
          {disconnected ? <WarningAlt size={14} /> : state === 'loading' ? <CircleDash size={14} className="adl-spinner" /> : <Music size={14} />}
          <span>{disconnected ? 'USB disconnected. Reconnect DVYDRMNG to continue listening.' : state === 'loading' ? 'Resolving the audio source…' : 'Ready when you are. Select a track to start listening.'}</span>
          {disconnected && <button type="button" onClick={() => setReconnected(true)}>Simulate reconnect <Usb size={12} /></button>}
        </div>}
        <div className={cn('adl-dock', !available && 'adl-unavailable')} aria-label={`${concept.name} audio dock`}>{dockContent()}</div>
      </div>
    </div>
  </div>;
}

export function AudioDockMockupsContent() {
  const [state, setState] = useState<PreviewState>('ready');
  const [context, setContext] = useState('Library');
  return <div className="adl-lab">
    <div className="adl-intro"><span className="adl-eyebrow">Layout Lab / Audio Dock</span><h2>One player. Every workspace.</h2><p>Ten directions for the app’s standard bottom audio dock. The same track, controls and playback states in every concept, shown against a workspace for scale. Choose a direction here before replacing the existing players.</p></div>
    <div className="adl-preview-toolbar">
      <label>WORKSPACE <select aria-label="Preview workspace" value={context} onChange={(event) => setContext(event.target.value)}>{['Library', 'Cue Points', 'Audition', 'Drop Lab'].map((name) => <option key={name}>{name}</option>)}</select></label>
      <label>PLAYER STATE <select aria-label="Preview player state" value={state} onChange={(event) => setState(event.target.value as PreviewState)}><option value="ready">Track loaded</option><option value="empty">No track selected</option><option value="loading">Loading audio</option><option value="disconnected">USB disconnected</option></select></label>
      <span><CheckmarkFilled size={12} /> Interactive controls · simulated playback, no audio</span>
    </div>
    {CONCEPTS.map((concept, index) => <section className="adl-concept" key={concept.kind} aria-labelledby={`adl-title-${concept.kind}`}>
      <div className="adl-concept-heading"><span className="adl-number" style={{ color: concept.accent }}>{String(index + 1).padStart(2, '0')}</span><div><h3 id={`adl-title-${concept.kind}`}>{concept.name}</h3><p>{concept.description}</p></div><span className="adl-footprint">{concept.footprint}</span></div>
      <DockPreview concept={concept} state={state} context={context} />
    </section>)}
  </div>;
}
