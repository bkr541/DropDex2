import { useMemo, useState, type MouseEvent } from 'react';
import { CircleDash } from '@carbon/icons-react';
import type { DropLabCandidate } from '../../hooks/useDropLabFlipPicks';
import type { DropLabTrackAnalysis } from '../../hooks/useDropLabAnalysis';
import { ContextMenu, SearchControl } from '../ui/controls';
import { KeyBadge, TrackListing, TrackListingWaveform, type TrackListingColumn, type TrackTableSort } from '../ui/display';
import { CheckmarkFilled, WarningAlt } from '@carbon/icons-react';
import { dropLabKeyLabel } from '../../hooks/useDropLabFlipPicks';
import { durationMsForTrack } from '../../lib/music/trackTiming';
import { StatusBadge } from '../ui/feedback';
import { candidateStatus, matchTone } from './candidateStatus';
import { DROP_LAB_TRACK_MIME } from './dropLabDrag';
import { arrangeCandidates, type CandidateSortColumn } from './arrangeCandidates';
import type { DropLabLoadMethod, DropLabSide } from './dropLabDrag';

interface CandidateRotationProps {
  candidates: DropLabCandidate[];
  analyses: Map<string, DropLabTrackAnalysis>;
  activeCandidateId: string | null;
  loading: boolean;
  usbReady: boolean;
  onLoadTrack: (trackId: string, side: DropLabSide, method: DropLabLoadMethod) => void;
}

interface CandidateListingRow { id: string; candidate: DropLabCandidate }

/** The candidate list: the shared track listing. Rows drag onto the timeline or load from a right-click menu. */
export function CandidateRotation({ candidates, analyses, activeCandidateId, loading, usbReady, onLoadTrack }: CandidateRotationProps) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TrackTableSort<CandidateSortColumn> | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; trackId: string; title: string } | null>(null);
  const rows = useMemo(() => arrangeCandidates(candidates, search, sort), [candidates, search, sort]);

  const listingRows = useMemo<CandidateListingRow[]>(() => rows.map((candidate) => ({ id: candidate.track.id, candidate })), [rows]);
  const columns: TrackListingColumn<CandidateListingRow>[] = [
    { id: 'bpm', label: 'BPM', sort: 'bpm', headClassName: 'w-[80px]', cellClassName: 'font-mono text-[13px] font-bold tabular-nums', render: ({ candidate }) => (candidate.track.bpm != null ? candidate.track.bpm.toFixed(1) : '—') },
    { id: 'key', label: 'Key', sort: 'key', headClassName: 'w-[90px]', render: ({ candidate }) => <KeyBadge camelotKey={dropLabKeyLabel(candidate.track)} variant="badge" /> },
    {
      id: 'match', label: 'Match', sort: 'match', headClassName: 'w-[230px]',
      render: ({ candidate }) => (
        <>
          <StatusBadge tone={matchTone(candidate.matchLabel)}>{candidate.matchLabel}</StatusBadge>
          {candidate.reasons.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {candidate.reasons.slice(0, 2).map((reason) => (
                <span key={reason.label} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">{reason.label}</span>
              ))}
            </span>
          )}
        </>
      ),
    },
    {
      id: 'status', label: 'Status', headClassName: 'w-[190px]',
      render: (row) => {
        const status = candidateStatus(analyses.get(row.id), usbReady);
        return status.tone === 'ready'
          ? <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-emerald-400"><CheckmarkFilled size={12} /> {status.text}</span>
          : <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-amber-400"><WarningAlt size={12} /> {status.text}</span>;
      },
    },
  ];

  function handleSort(column: CandidateSortColumn) {
    setSort((current) => {
      if (!current || current.column !== column) return { column, direction: 'asc' };
      return current.direction === 'asc' ? { column, direction: 'desc' } : null;
    });
  }

  function openMenu(event: MouseEvent<HTMLTableRowElement>, candidate: DropLabCandidate) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, trackId: candidate.track.id, title: candidate.track.title });
  }

  const countLabel = search.trim() ? `${rows.length} of ${candidates.length} candidates` : `${candidates.length} candidates`;

  return (
    <section className="min-h-0 flex-1" data-testid="drop-lab-candidates">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2.5 border-b border-[var(--color-border-faint)] px-4 py-2.5 md:px-5" data-testid="drop-lab-candidate-filters">
        <h3 className="self-center text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Candidate rotation</h3>
        <div className="min-w-[200px] max-w-[320px] flex-1" data-testid="drop-lab-candidate-search">
          <SearchControl
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title or artist…"
            aria-label="Search candidates"
          />
        </div>
        <span className="ml-auto flex items-center gap-2 self-center font-mono text-[11px] tabular-nums text-muted-foreground">
          {loading && <CircleDash size={13} className="animate-spin" aria-label="Loading candidates" />}
          {countLabel}
        </span>
      </div>

      {loading && candidates.length === 0 ? (
        <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground" role="status">
          <CircleDash className="animate-spin text-primary" size={22} />
          Finding candidates…
        </div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="font-bold">{candidates.length === 0 ? 'No compatible drop candidates were found for this track.' : 'No candidates match this search.'}</p>
          {candidates.length > 0 && <p className="mt-1 text-sm text-muted-foreground">Clear the search to see every candidate.</p>}
        </div>
      ) : (
        <TrackListing<CandidateListingRow>
          tracks={listingRows}
          columns={columns}
          selectedId={activeCandidateId}
          onSelect={(row) => onLoadTrack(row.id, 'drop', 'click')}
          getTitle={(row) => row.candidate.track.title}
          getArtist={(row) => row.candidate.track.artist}
          getStatus={(row) => candidateStatus(analyses.get(row.id), usbReady).tone}
          nameClassName="w-[260px] shrink-0"
          renderWaveform={(row) => (
            <TrackListingWaveform
              waveformState={analyses.get(row.id)?.waveformState ?? { status: 'idle', trackId: row.id }}
              durationMs={analyses.get(row.id)?.durationMs ?? durationMsForTrack(row.candidate.track, null)}
              height={18}
              ariaLabel={`Waveform for ${row.candidate.track.title}`}
            />
          )}
          trackSort="title"
          trackLabel="Candidate"
          sort={sort}
          onSort={(column) => handleSort(column as CandidateSortColumn)}
          rowProps={(row) => ({
            'data-testid': 'drop-lab-candidate-row',
            draggable: true,
            title: 'Drag onto the timeline, or right-click to load this track',
            onDragStart: (event) => {
              event.dataTransfer.setData(DROP_LAB_TRACK_MIME, row.id);
              event.dataTransfer.setData('text/plain', row.candidate.track.title);
              event.dataTransfer.effectAllowed = 'copy';
            },
            onContextMenu: (event) => openMenu(event as MouseEvent<HTMLTableRowElement>, row.candidate),
          })}
          tableClassName="min-w-[980px]"
          tableTestId="drop-lab-candidate-table"
          ariaLabel="Drop Lab candidates"
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={`Load ${menu.title}`}
          onClose={() => setMenu(null)}
          items={[
            { id: 'build', label: 'Load As Build', hint: 'Left', onSelect: () => onLoadTrack(menu.trackId, 'build', 'menu') },
            { id: 'drop', label: 'Load As Drop', hint: 'Right', onSelect: () => onLoadTrack(menu.trackId, 'drop', 'menu') },
          ]}
        />
      )}
    </section>
  );
}
