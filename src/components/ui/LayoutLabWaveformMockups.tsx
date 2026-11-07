import { useState, type CSSProperties } from 'react';
import { Play } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { TrackNameCell, TrackTable, TrackTableBody, TrackTableHead, TrackTableHeadCell, TrackTableRow } from './display';
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
 * 2 · Cue bars: the same waveform as row 1, with the same number of bars (120), all in the one gray (no coral drop). A cue is not drawn on top: the one bar of the
 * waveform at the cue's position is coloured in that cue's own colour, so the marker is exactly as tall as the waveform is there
 * and never extends past it.
 */
function WavePill({ track, amps }: WaveProps) {
  const cueAt = cueBars(track, amps.length);
  return (
    <div className="wp-wave wp-pill">
      <div className="wp-body">
        {amps.map((a, i) => {
          const cue = cueAt.get(i);
          return (
            <i
              key={i}
              className={cue ? 'wp-cue-bar' : undefined}
              title={cue ? cueTitle(cue) : undefined}
              style={{ height: `${a * 100}%`, '--wp-bar': cue ? cueColor(cue) : GRAY } as CSSProperties}
            />
          );
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
  { id: 'bars', title: 'Bars + Dots', concept: 'The Audition look: thin gray bars, the drop in coral, a dot in each cue’s colour above.', selected: 'Selected: coral title, a coral edge on the left and a faint coral wash (production).', Wave: WaveBars },
  { id: 'pill', title: 'Bars + Cue Bars', concept: 'The row 1 waveform with the same number of bars; the bars are rounded and all one gray, and the bar at each cue is that cue’s own soft colour (rose, sky, mint, lavender), exactly as tall as the waveform there.', selected: 'Selected: a coral glow that fades out to the right, with a thicker coral edge.', Wave: WavePill },
  { id: 'mirror', title: 'Mirrored Bars + Cue Columns', concept: 'Bars grow up and down from a centre line, the lower half fainter; each cue is the mirrored column at its position, in its own colour.', selected: 'Selected: the row lifts, a lighter graphite with a bright top line and a dark bottom line.', Wave: WaveMirror },
  { id: 'twotone', title: 'Two-tone Bars + Cue Bars', concept: 'Each bar is two shades of gray with a rounded cap; each cue is the bar at its position, two-tone in its own colour.', selected: 'Selected: a thin coral outline around the whole row, with the title in coral.', Wave: WaveTwoTone },
  { id: 'fade', title: 'Fade Bars + Cue Bars', concept: 'Bars on a baseline that fade toward the foot; each cue is the bar at its position, fading in its own colour.', selected: 'Selected: a lit row with a coral line along the bottom and a coral play icon.', Wave: WaveFade },
];

const COLUMNS = ['Track', 'BPM', 'Key', 'Genre', 'Format', 'Playlists', 'Duration'];

function MockRow({ track, selected, onSelect, Wave }: { track: PreviewTrack; selected: boolean; onSelect: () => void; Wave: (props: WaveProps) => React.ReactNode }) {
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
        status="ready"
        nameClassName="w-[340px] shrink-0"
        leading={<span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', selected ? 'text-primary' : 'text-muted-foreground')}><Play size={14} fill="currentColor" /></span>}
      >
        <div className="audition-row-wave flex min-w-0 flex-col"><Wave track={track} amps={amps} /></div>
      </TrackNameCell>
      <td className="px-3 py-1.5 font-mono text-[13px] font-bold tabular-nums">{track.bpm.toFixed(1)}</td>
      <td className="px-3 py-1.5">{track.key}</td>
      <td className="w-[178px] px-3 py-1.5 text-xs text-muted-foreground"><span className="block truncate">{track.genre}</span></td>
      <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">{track.format}</td>
      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{track.playlists}</td>
      <td className="w-[80px] whitespace-nowrap px-3 py-1.5 text-left font-mono text-[13px] text-muted-foreground">{track.duration}</td>
    </TrackTableRow>
  );
}

function PreviewRow({ n, style }: { n: number; style: typeof STYLES[number] }) {
  const [selected, setSelected] = useState(PREVIEW_TRACKS[0].id);
  return (
    <section className="wp-row" data-testid="waveform-row" data-style={style.id} aria-label={style.title}>
      <div className="wp-row-heading"><span className="wp-row-number">{n}</span><strong>{style.title}</strong><span>{style.concept} <b>{style.selected}</b></span></div>
      <div className={cn('studio audition-studio wp-stage', `wp-style-${style.id}`)}>
        <section className="audition-library cue-browser" aria-label={`${style.title} library`}>
          <div className="audition-table-scroll overflow-auto scrollbar-none">
            <TrackTable className="min-w-[900px]" aria-label={`${style.title} tracks`}>
              <TrackTableHead>{COLUMNS.map((label) => <TrackTableHeadCell key={label} label={label} className={label === 'Genre' ? 'w-[178px]' : label === 'Duration' ? 'w-[80px] text-left' : undefined} />)}</TrackTableHead>
              <TrackTableBody>
                {PREVIEW_TRACKS.map((track) => <MockRow key={track.id} track={track} selected={track.id === selected} onSelect={() => setSelected(track.id)} Wave={style.Wave} />)}
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
