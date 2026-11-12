import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { InfoCircle } from 'iconoir-react/regular';
import { Dialog } from '../feedback/Dialog';
import { logger } from '../../../lib/logger';
import { fetchTrackBeatGrid, fetchTrackCues, fetchTrackPhrases, type BeatGridRow, type CueRow, type PhraseRow } from '../../../lib/queries/analysisData';
import { fetchTrackPlaylists, type TrackPlaylistMembership } from '../../../lib/queries/rekordbox';
import { formatTime } from '../../../lib/music/trackTiming';
import { durationMsForTrack } from '../../../lib/music/trackTiming';
import { barWindows } from '../../../lib/music/audioIntelligence';
import { useTrackAudioAnalysis } from '../../../hooks/useTrackAudioAnalysis';
import { AudioIntelligencePanel, usePlayheadMs } from './AudioIntelligencePanel';
import './track-details.css';

type Loaded<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

/** Reads one thing about the track and reports when it is ready or why it could not be read, in the app's logger as well as on screen. */
function useLoaded<T>(label: string, trackId: string, load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    logger.info(`library.trackdetails.${label}.start`, { trackId });
    load().then((data) => {
      if (cancelled) return;
      logger.info(`library.trackdetails.${label}.loaded`, { trackId });
      setState({ status: 'ready', data });
    }).catch((error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`library.trackdetails.${label}.failed`, { trackId, message });
      setState({ status: 'error', message });
    });
    return () => { cancelled = true; };
    // `load` is rebuilt every render; the track is what decides when to read again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, label]);
  return state;
}

const LABELS: Record<string, string> = { bpm: 'BPM', isrc: 'ISRC', file_path: 'File path', file_format: 'Format', rekordbox_content_id: 'Rekordbox content ID', import_id: 'Import ID', master_db_id: 'Master DB ID', master_content_id: 'Master content ID', date_added: 'Added on' };
const label = (key: string) => LABELS[key] ?? `${key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}`;

function formatValue(key: string, value: unknown): ReactNode {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'duration_ms' && typeof value === 'number') return `${formatTime(value)} (${value.toLocaleString()} ms)`;
  if (key === 'duration_seconds' && typeof value === 'number') return `${formatTime(value * 1000)} (${value.toLocaleString()} s)`;
  if (key === 'file_size_bytes' && typeof value === 'number') return `${(value / (1024 * 1024)).toFixed(1)} MB (${value.toLocaleString()} bytes)`;
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString() : String(value);
  if (typeof value === 'object') return <pre className="td-json">{JSON.stringify(value, null, 2)}</pre>;
  return String(value);
}

const isAnalysisField = (key: string) => key.startsWith('analysis_') || ['analysed_bits', 'cue_update_count', 'information_update_count'].includes(key);

function Rows({ entries }: { entries: Array<[string, unknown]> }) {
  if (entries.length === 0) return <p className="td-empty">Nothing stored.</p>;
  return (
    <dl className="td-rows">
      {entries.map(([key, value]) => (
        <div key={key} className="td-row"><dt>{label(key)}</dt><dd>{formatValue(key, value)}</dd></div>
      ))}
    </dl>
  );
}

/** The Audio Intelligence panel, once the beat grid, phrases and cues it draws on have loaded. */
function AudioIntelligenceSection({ beatGrid, phrases, cues, track }: {
  beatGrid: Loaded<BeatGridRow | null>;
  phrases: Loaded<PhraseRow[]>;
  cues: Loaded<CueRow[]>;
  track: { id: string; title: string; artist?: string | null } & Record<string, unknown>;
}) {
  const playheadMs = usePlayheadMs(track.id);
  const bars = useMemo(() => (beatGrid.status === 'ready' && beatGrid.data ? barWindows(beatGrid.data.beats, null) : []), [beatGrid]);
  const analysis = useTrackAudioAnalysis(track as { id: string; title: string; file_path?: string | null }, bars);
  const waiting = [beatGrid, phrases, cues].find((state) => state.status !== 'ready');
  if (waiting?.status === 'error') return <section className="td-section"><p className="td-error" role="alert">Audio Intelligence could not load. {waiting.message}</p></section>;
  if (waiting || beatGrid.status !== 'ready' || phrases.status !== 'ready' || cues.status !== 'ready') return <section className="td-section"><p className="td-empty">Loading Audio Intelligence…</p></section>;
  const durationMs = durationMsForTrack({ duration_ms: (track.duration_ms as number | null | undefined) ?? null, duration_seconds: (track.duration_seconds as number | null | undefined) ?? null }, beatGrid.data, phrases.data);
  return <AudioIntelligencePanel track={track} beatGrid={beatGrid.data} phrases={phrases.data} cues={cues.data} durationMs={durationMs} playheadMs={playheadMs} audio={{ state: analysis.state, onAnalyze: () => void analysis.run() }} />;
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="td-section">
      <h3 className="td-heading">{title}{count != null && <span>{count}</span>}</h3>
      {children}
    </section>
  );
}

function Status<T>({ state, children }: { state: Loaded<T>; children: (data: T) => ReactNode }) {
  if (state.status === 'loading') return <p className="td-empty">Loading…</p>;
  if (state.status === 'error') return <p className="td-error" role="alert">Could not load this. {state.message}</p>;
  return <>{children(state.data)}</>;
}

/**
 * Everything DropDex has stored about one audio track, in a window that slides out from the right of the app: the track's own fields,
 * its analysis, its cue points, the playlists it is in, its beat grid and its phrases. The listing's details icon opens it.
 */
export function TrackDetailsSheet({ track, onClose }: { track: { id: string; title: string; artist?: string | null; import_id?: string | null } & Record<string, unknown>; onClose: () => void }) {
  const cues = useLoaded<CueRow[]>('cues', track.id, () => fetchTrackCues(track.id));
  const playlists = useLoaded<TrackPlaylistMembership[]>('playlists', track.id, () => (track.import_id ? fetchTrackPlaylists(track.import_id, track.id) : Promise.resolve([])));
  const beatGrid = useLoaded<BeatGridRow | null>('beatgrid', track.id, () => fetchTrackBeatGrid(track.id));
  const phrases = useLoaded<PhraseRow[]>('phrases', track.id, () => fetchTrackPhrases(track.id));
  const fields = Object.entries(track);
  const trackFields = fields.filter(([key]) => !isAnalysisField(key));
  const analysisFields = fields.filter(([key]) => isAnalysisField(key));
  return createPortal(
    <Dialog
      placement="right"
      title={track.title}
      icon={<InfoCircle width={24} height={24} aria-hidden="true" />}
      onClose={onClose}
      actions={[{ label: 'Close', variant: 'secondary', onClick: onClose }]}
    >
      <div className="td" data-testid="track-details">
        {track.artist && <p className="td-artist">{track.artist}</p>}

        <AudioIntelligenceSection beatGrid={beatGrid} phrases={phrases} cues={cues} track={track} />

        <Section title="Track" count={trackFields.length}><Rows entries={trackFields} /></Section>
        <Section title="Analysis" count={analysisFields.length}><Rows entries={analysisFields} /></Section>

        <Section title="Cue points" count={cues.status === 'ready' ? cues.data.length : undefined}>
          <Status state={cues}>{(rows) => rows.length === 0 ? <p className="td-empty">No cue points.</p> : (
            <ul className="td-list">
              {rows.map((cue) => (
                <li key={cue.id}>
                  <span className="td-swatch" style={{ background: cue.color_hex ?? '#8997AE' }} aria-hidden="true" />
                  <strong>{cue.cue_family === 'hot' ? `Hot cue ${cue.hot_cue_slot != null ? String.fromCharCode(65 + cue.hot_cue_slot) : ''}`.trim() : 'Memory cue'}{cue.point_type === 'loop' ? ' (loop)' : ''}</strong>
                  <span>{cue.start_ms != null ? formatTime(cue.start_ms) : '—'}{cue.end_ms != null ? ` – ${formatTime(cue.end_ms)}` : ''}</span>
                  {cue.comment && <em>{cue.comment}</em>}
                </li>
              ))}
            </ul>
          )}</Status>
        </Section>

        <Section title="Playlists" count={playlists.status === 'ready' ? playlists.data.length : undefined}>
          <Status state={playlists}>{(rows) => rows.length === 0 ? <p className="td-empty">In no playlists.</p> : (
            <ul className="td-list">{rows.map((entry) => <li key={entry.playlist.id}><strong>{entry.playlist.name}</strong><span>Position {entry.position + 1}</span></li>)}</ul>
          )}</Status>
        </Section>
      </div>
    </Dialog>,
    document.body,
  );
}
