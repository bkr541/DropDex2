import { useState, type CSSProperties } from 'react';
import { OverflowMenuHorizontal, Play } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { TrackListing, TrackNameCell, TrackTable, TrackTableBody, TrackTableHead, TrackTableHeadCell, TrackTableRow, type TrackListingColumn } from './display';
import { PREVIEW_TRACKS, waveformAmplitudes, type PreviewCue, type PreviewTrack } from './layoutLabWaveformData';
import '../audition/AuditionView.css';
import './layout-lab-waveform.css';

// Five rows of five tracks, laid out exactly like the Audition library (the real table pieces and the page's own look). Only the
// waveform preview and the cue markers change from one row to the next.

const GRAY = '#8997AE';
const DROP = '#f78361';
const BARS = 120;
/**
 * Row 2's cue colours: four soft, evenly weighted hues that sit with the blue-gray bars (rose, sky, mint, lavender), one per cue
 * so each cue is still told apart, standing in for the production red, blue, green and purple. Row 2 has no orange or coral.
 */
const CUE_COLORS: Record<string, string> = { A: '#f27d96', B: '#5fb8e8', C: '#6fd9a4', D: '#a99bff' };
const cueColor = (cue: PreviewCue) => CUE_COLORS[cue.letter] ?? cue.color;
/** Which bar of the waveform each cue falls on: the bar that covers the cue's share of the track. */
const cueBars = (track: PreviewTrack, count: number) => new Map(track.cues.map((c) => [Math.min(count - 1, Math.floor((c.pct / 100) * count)), c]));

type WaveProps = { track: PreviewTrack; amps: number[] };

const inDrop = (track: PreviewTrack, i: number, count: number) => !!track.drop && i / count >= track.drop[0] && i / count <= track.drop[1];
const cueStyle = (cue: PreviewCue) => ({ left: `${cue.pct}%`, '--wp-cue': cue.color }) as CSSProperties;
const cueTitle = (cue: PreviewCue) => `Cue ${cue.letter}`;

/** 1 · Bars: the Audition look. Thin gray bars, the drop in coral, and a dot in each cue's colour above. */
function WaveBars({ track, amps }: WaveProps) {
  return (
    <div className="wp-wave wp-bars">
      <div className="wp-cues wp-cues-dots">{track.cues.map((c) => <span key={c.letter} title={cueTitle(c)} style={cueStyle(c)} />)}</div>
      <div className="wp-body">{amps.map((a, i) => <i key={i} style={{ height: `${a * 100}%`, background: inDrop(track, i, amps.length) ? DROP : GRAY }} />)}</div>
    </div>
  );
}

/**
 * 2 · Bars with a triangle on each cue: the same thin gray bars as row 1 (no coral drop), and no dots above. A cue is the one bar of the
 * waveform at its position, in the cue's colour, exactly as tall as the waveform there, with a small upside-down triangle on top of it.
 */
function WavePill({ track, amps }: WaveProps) {
  const cueAt = cueBars(track, amps.length);
  return (
    <div className="wp-wave wp-pill">
      <div className="wp-body">
        {amps.map((a, i) => {
          const cue = cueAt.get(i);
          return cue
            ? <i key={i} className="wp-cue-bar" title={cueTitle(cue)} style={{ height: `${a * 100}%`, background: cueColor(cue), '--wp-bar': cueColor(cue) } as CSSProperties} />
            : <i key={i} style={{ height: `${a * 100}%`, background: GRAY }} />;
        })}
      </div>
    </div>
  );
}

/**
 * 3 · Mirrored bars: the bars grow up and down from a centre line, the lower half fainter like a reflection. A cue is the one
 * mirrored column at its position, in the cue's colour, so the marker is exactly the waveform's own shape there.
 */
function WaveMirror({ track, amps }: WaveProps) {
  const cueAt = cueBars(track, amps.length);
  return (
    <div className="wp-wave wp-mirror">
      <div className="wp-body">
        {amps.map((a, i) => {
          const cue = cueAt.get(i);
          const color = cue ? cueColor(cue) : GRAY;
          return (
            <span key={i} className={cue ? 'wp-cue-col' : undefined} title={cue ? cueTitle(cue) : undefined} style={{ '--wp-bar': color } as CSSProperties}>
              <i className="up" style={{ height: `${a * 50}%` }} /><i className="down" style={{ height: `${a * 34}%` }} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 4 · Two-tone bars: each bar is two shades of the gray with a rounded cap. A cue is the one bar at its position, in the same
 * two-tone treatment but in the cue's colour, exactly as tall as the waveform there.
 */
function WaveTwoTone({ track, amps }: WaveProps) {
  const cueAt = cueBars(track, amps.length);
  return (
    <div className="wp-wave wp-twotone">
      <div className="wp-body">
        {amps.map((a, i) => {
          const cue = cueAt.get(i);
          return (
            <i
              key={i}
              className={cue ? 'wp-cue-two' : undefined}
              title={cue ? cueTitle(cue) : undefined}
              style={{ height: `${a * 100}%`, ...(cue ? { '--wp-bar': cueColor(cue) } : {}) } as CSSProperties}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * 5 · Fade bars: bars standing on a baseline, fading from the gray at the top to almost nothing at the foot. A cue is the one
 * bar at its position, fading the same way but in the cue's colour, exactly as tall as the waveform there.
 */
function WaveFade({ track, amps }: WaveProps) {
  const cueAt = cueBars(track, amps.length);
  return (
    <div className="wp-wave wp-fade">
      <div className="wp-body">
        {amps.map((a, i) => {
          const cue = cueAt.get(i);
          return (
            <i
              key={i}
              className={cue ? 'wp-cue-fade' : undefined}
              title={cue ? cueTitle(cue) : undefined}
              style={{ height: `${a * 100}%`, ...(cue ? { '--wp-bar': cueColor(cue) } : {}) } as CSSProperties}
            />
          );
        })}
      </div>
    </div>
  );
}

const STYLES = [
  { id: 'bars', title: 'Bars + Dots', concept: 'The Audition look: thin gray bars, the drop in coral, a dot in each cue’s colour above.', selected: 'Selected: coral title, a coral edge on the left and a faint coral wash (production).', status: 'Status: the production dot, left of the play button.', Wave: WaveBars },
  { id: 'pill', title: 'Bars + Triangle Cues', concept: 'The thin gray bars of row 1; each cue is the bar at its position in its own colour, exactly as tall as the waveform there, with an upside-down triangle sitting on top of it.', selected: 'Selected: a coral glow that fades out to the right, with a thicker coral edge.', status: 'Status: the production dot, left of the play button, as in row 1.', Wave: WavePill },
  { id: 'mirror', title: 'Mirrored Bars + Cue Columns', concept: 'Bars grow up and down from a centre line, the lower half fainter; each cue is the mirrored column at its position, in its own colour.', selected: 'Selected: the row lifts, a lighter graphite with a bright top line and a dark bottom line.', status: 'Status: a spaced-caps word after the artist name.', Wave: WaveMirror },
  { id: 'twotone', title: 'Two-tone Bars + Cue Bars', concept: 'Each bar is two shades of gray with a rounded cap; each cue is the bar at its position, two-tone in its own colour.', selected: 'Selected: a thin coral outline around the whole row, with the title in coral.', status: 'Status: a one-pixel rule on the bottom line of the row, under the title.', Wave: WaveTwoTone },
  { id: 'fade', title: 'Fade Bars + Cue Bars', concept: 'Bars on a baseline that fade toward the foot; each cue is the bar at its position, fading in its own colour.', selected: 'Selected: a lit row with a coral line along the bottom and a coral play icon.', status: 'Status: a thin arc after the duration, one third for each step done.', Wave: WaveFade },
];

const COLUMNS = ['Track', 'BPM', 'Key', 'Genre', 'Format', 'Playlists', 'Duration'];

/**
 * The analysis status behind the green dot, drawn in the app's own language: nothing is filled or glowing, a state is a hairline, a light figure,
 * a 9px spaced word or a thin arc. "Ready" is quiet; only a track with a problem takes a colour you notice. Analysis is three steps (waveform,
 * beat grid, cues), so a status is how many of the three are done: ready 3, partial 2, failed 1, pending 0.
 */
const STATUS_STEPS = { ready: 3, warning: 2, error: 1, none: 0 } as const;
const STATUS_INK = { ready: '#34d399', warning: '#f0b35a', error: '#f27d96', none: '#566074' } as const;
const STATUS_WORD = { ready: 'Ready', warning: 'Partial', error: 'Failed', none: 'Pending' } as const;
const STEP_NAMES = ['waveform', 'beat grid', 'cues'] as const;
type StatusKind = keyof typeof STATUS_STEPS;
const statusStyle = (status: StatusKind) => ({ '--wp-status': STATUS_INK[status] }) as CSSProperties;
const statusTitle = (status: StatusKind) => {
  const done = STATUS_STEPS[status];
  return done === 3 ? 'Analysis ready: waveform, beat grid and cues are done' : `Analysis ${STATUS_WORD[status].toLowerCase()}: ${done} of 3 steps done, still needs ${STEP_NAMES.slice(done).join(' and ')}`;
};

/** 3 · The status as a word after the artist, in 9px spaced capitals. */
function StatusWord({ status }: { status: StatusKind }) {
  return <span className="wp-status-word" style={statusStyle(status)} data-status={status} title={statusTitle(status)}>{STATUS_WORD[status]}</span>;
}

/** 4 · A one-pixel rule on the row's bottom line, under the title, in the status colour. */
function StatusRule({ status }: { status: StatusKind }) {
  return <span className="wp-status-rule" style={statusStyle(status)} data-status={status} role="img" aria-label={statusTitle(status)} title={statusTitle(status)} />;
}

/** 5 · A thin arc that fills one third for each analysis step, after the duration. A track not analysed yet has a dashed, empty circle. */
function StatusArc({ status }: { status: StatusKind }) {
  const done = STATUS_STEPS[status];
  const radius = 6.5;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className="wp-status-arc" style={statusStyle(status)} width="18" height="18" viewBox="0 0 18 18" role="img" aria-label={statusTitle(status)} data-status={status}>
      <title>{statusTitle(status)}</title>
      <circle cx="9" cy="9" r={radius} className="wp-arc-track" strokeDasharray={done === 0 ? '1.5 2.6' : undefined} />
      {done > 0 && <circle cx="9" cy="9" r={radius} className="wp-arc-fill" strokeDasharray={`${(circumference * done) / 3} ${circumference}`} transform="rotate(-90 9 9)" />}
    </svg>
  );
}

function MockRow({ track, selected, onSelect, Wave, styleId }: { track: PreviewTrack; selected: boolean; onSelect: () => void; Wave: (props: WaveProps) => React.ReactNode; styleId: string }) {
  const amps = waveformAmplitudes(track.seed, BARS);
  return (
    <TrackTableRow selected={selected} onClick={onSelect} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}>
      <TrackNameCell
        title={track.title}
        artist={track.artist}
        selected={selected}
        dense
        hideArtwork
        hideSelectionBar
        status={track.status}
        hideStatus={styleId !== 'bars'}
        artistSuffix={styleId === 'mirror' ? <StatusWord status={track.status} /> : undefined}
        nameClassName="w-[340px] shrink-0"
        leading={<span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', selected ? 'text-primary' : 'text-muted-foreground')}><Play size={14} fill="currentColor" /></span>}
      >
        {styleId === 'twotone' && <StatusRule status={track.status} />}
        <div className="audition-row-wave flex min-w-0 flex-col"><Wave track={track} amps={amps} /></div>
      </TrackNameCell>
      <td className="px-3 py-1.5 font-mono text-[13px] font-bold tabular-nums">{track.bpm.toFixed(1)}</td>
      <td className="px-3 py-1.5">{track.key}</td>
      <td className="w-[178px] px-3 py-1.5 text-xs text-muted-foreground"><span className="block truncate">{track.genre}</span></td>
      <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">{track.format}</td>
      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{track.playlists}</td>
      <td className="w-[80px] whitespace-nowrap px-3 py-1.5 text-left font-mono text-[13px] text-muted-foreground">
        {styleId === 'fade' ? <span className="wp-duration-status">{track.duration}<StatusArc status={track.status} /></span> : track.duration}
      </td>
    </TrackTableRow>
  );
}

/** Row 2 is drawn by the real reusable TrackListing, so what you see here is what the production lists use. */
const LISTING_COLUMNS: TrackListingColumn<PreviewTrack>[] = [
  { id: 'bpm', label: 'BPM', cellClassName: 'font-mono text-[13px] font-bold tabular-nums', render: (track) => track.bpm.toFixed(1) },
  { id: 'key', label: 'Key', render: (track) => track.key },
  { id: 'genre', label: 'Genre', headClassName: 'w-[178px]', cellClassName: 'w-[178px] text-xs text-muted-foreground', render: (track) => <span className="block truncate">{track.genre}</span> },
  { id: 'format', label: 'Format', cellClassName: 'whitespace-nowrap text-xs text-muted-foreground', render: (track) => track.format },
  { id: 'playlists', label: 'Playlists', cellClassName: 'whitespace-nowrap tabular-nums', render: (track) => track.playlists },
  { id: 'duration', label: 'Duration', headClassName: 'w-[80px] text-left', cellClassName: 'w-[80px] whitespace-nowrap text-left font-mono text-[13px] text-muted-foreground', render: (track) => track.duration },
];

function PreviewRow({ n, style }: { n: number; style: typeof STYLES[number] }) {
  const [selected, setSelected] = useState(PREVIEW_TRACKS[0].id);
  if (style.id === 'pill') {
    return (
      <section className="wp-row" data-testid="waveform-row" data-style={style.id} aria-label={style.title}>
        <div className="wp-row-heading"><span className="wp-row-number">{n}</span><strong>{style.title}</strong><span>{style.concept} <b>{style.selected}</b> <em>{style.status}</em></span></div>
        <div className={cn('studio audition-studio wp-stage', `wp-style-${style.id}`)}>
          <TrackListing
            tracks={PREVIEW_TRACKS}
            columns={LISTING_COLUMNS}
            selectedId={selected}
            onSelect={(track) => setSelected(track.id)}
            getTitle={(track) => track.title}
            getArtist={(track) => track.artist}
            getStatus={(track) => track.status}
            renderLeading={(track, isSelected) => <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', isSelected ? 'text-primary' : 'text-muted-foreground')}><Play size={14} fill="currentColor" /></span>}
            renderWaveform={(track) => <div className="track-listing__wave"><style.Wave track={track} amps={waveformAmplitudes(track.seed, BARS)} /></div>}
            ariaLabel={`${style.title} tracks`}
          />
        </div>
      </section>
    );
  }
  return (
    <section className="wp-row" data-testid="waveform-row" data-style={style.id} aria-label={style.title}>
      <div className="wp-row-heading"><span className="wp-row-number">{n}</span><strong>{style.title}</strong><span>{style.concept} <b>{style.selected}</b> <em>{style.status}</em></span></div>
      <div className={cn('studio audition-studio wp-stage', `wp-style-${style.id}`)}>
        <section className="audition-library cue-browser" aria-label={`${style.title} library`}>
          <div className="audition-table-scroll overflow-auto scrollbar-none">
            <TrackTable className="min-w-[900px]" aria-label={`${style.title} tracks`}>
              <TrackTableHead>{COLUMNS.map((label) => <TrackTableHeadCell key={label} label={label} className={label === 'Genre' ? 'w-[178px]' : label === 'Duration' ? 'w-[80px] text-left' : undefined} />)}</TrackTableHead>
              <TrackTableBody>
                {PREVIEW_TRACKS.map((track) => <MockRow key={track.id} track={track} selected={track.id === selected} onSelect={() => setSelected(track.id)} Wave={style.Wave} styleId={style.id} />)}
              </TrackTableBody>
            </TrackTable>
          </div>
        </section>
      </div>
    </section>
  );
}

export function WaveformPreviewMockupsContent() {
  return (
    <div className="wp-lab" data-testid="waveform-mockups">
      <div className="wp-intro">
        <span className="wp-eyebrow">Layout Lab / Waveform Preview</span>
        <h1>Five ways to preview a track in the list.</h1>
        <p>Each row is five tracks in the Audition library, built from the real table pieces and the page’s own look. Only two things change from row to row: how the waveform is drawn, and how the cue points are marked. Click a track to select it.</p>
      </div>
      {STYLES.map((style, i) => <PreviewRow key={style.id} n={i + 1} style={style} />)}
    </div>
  );
}
