import { nextRecordSort } from '../ui/display/recordTrackSorting';
import { useTrackPlaylistCounts } from '../../hooks/useTrackPlaylistCounts';
import { RecordTrackListing } from '../ui/display/RecordTrackListing';
import type { TrackTableSort } from '../ui/display';
import { useMemo, useState, type MouseEvent } from 'react';
import { Refresh } from 'iconoir-react/regular';
import type { DropLabCandidate } from '../../hooks/useDropLabFlipPicks';
import type { DropLabTrackAnalysis } from '../../hooks/useDropLabAnalysis';
import { ContextMenu, SearchControl } from '../ui/controls';
import { candidateStatus } from './candidateStatus';
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


/** The candidate list: the shared track listing. Rows drag onto the timeline or load from a right-click menu. */
export function CandidateRotation({ candidates, analyses, activeCandidateId, loading, usbReady, onLoadTrack }: CandidateRotationProps) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TrackTableSort<CandidateSortColumn> | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; trackId: string; title: string } | null>(null);
  const candidateIds = useMemo(() => candidates.map(({ track }) => track.id), [candidates]);
  const playlistCounts = useTrackPlaylistCounts(candidateIds);
  const rows = useMemo(() => arrangeCandidates(candidates, search, sort, playlistCounts.counts), [candidates, search, sort, playlistCounts.counts]);

  const listingRows = useMemo(() => rows.map(({ track }) => track), [rows]);
  const candidatesById = useMemo(() => new Map(rows.map((candidate) => [candidate.track.id, candidate])), [rows]);

  function handleSort(column: CandidateSortColumn) {
    setSort((current) => nextRecordSort(current, column));
  }

  function openMenu(event: MouseEvent<HTMLTableRowElement>, track: DropLabCandidate['track']) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, trackId: track.id, title: track.title });
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
          {loading && <Refresh width={13} height={13} className="animate-spin" aria-label="Loading candidates" />}
          {countLabel}
        </span>
      </div>

      {loading && candidates.length === 0 ? (
        <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground" role="status">
          <Refresh className="animate-spin text-control-primary" width={22} height={22} aria-hidden="true" />
          Finding candidates…
        </div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="font-bold">{candidates.length === 0 ? 'No compatible drop candidates were found for this track.' : 'No candidates match this search.'}</p>
          {candidates.length > 0 && <p className="mt-1 text-sm text-muted-foreground">Clear the search to see every candidate.</p>}
        </div>
      ) : (
        <RecordTrackListing
          tracks={listingRows}
          selectedId={activeCandidateId}
          onSelect={(track) => onLoadTrack(track.id, 'drop', 'click')}
          getWaveformState={(id) => analyses.get(id)?.waveformState ?? { status: 'idle', trackId: id }}
          getActions={(track) => {
            const candidate = candidatesById.get(track.id);
            return [
              { id: 'build', label: 'Load As Build', hint: 'Left', onSelect: () => onLoadTrack(track.id, 'build', 'menu') },
              { id: 'drop', label: 'Load As Drop', hint: 'Right', onSelect: () => onLoadTrack(track.id, 'drop', 'menu') },
              { id: 'status', label: candidateStatus(analyses.get(track.id), usbReady).text },
              ...(candidate ? [{ id: 'match', label: candidate.matchLabel, hint: candidate.reasons.slice(0, 2).map(({ label }) => label).join(' · ') }] : []),
            ];
          }}
          playlistCounts={playlistCounts}
          sort={sort}
          onSort={(column) => handleSort(column as CandidateSortColumn)}
          rowProps={(row) => ({
            'data-testid': 'drop-lab-candidate-row',
            draggable: true,
            title: candidateStatus(analyses.get(row.id), usbReady).text + '. Drag onto the timeline, or open Actions to load this track.',
            onDragStart: (event) => {
              event.dataTransfer.setData(DROP_LAB_TRACK_MIME, row.id);
              event.dataTransfer.setData('text/plain', row.title);
              event.dataTransfer.effectAllowed = 'copy';
            },
            onContextMenu: (event) => openMenu(event as MouseEvent<HTMLTableRowElement>, row),
          })}
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
