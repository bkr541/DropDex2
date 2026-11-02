import { useMemo, useState, type MouseEvent } from 'react';
import { CircleDash } from '@carbon/icons-react';
import type { DropLabCandidate } from '../../hooks/useDropLabFlipPicks';
import type { DropLabTrackAnalysis } from '../../hooks/useDropLabAnalysis';
import { ContextMenu, SearchControl } from '../ui/controls';
import { TrackTable, TrackTableBody, TrackTableHead, TrackTableHeadCell, type TrackTableSort } from '../ui/display';
import { arrangeCandidates, type CandidateSortColumn } from './arrangeCandidates';
import { CandidateRow } from './CandidateRow';
import type { DropLabLoadMethod, DropLabSide } from './dropLabDrag';

interface CandidateRotationProps {
  candidates: DropLabCandidate[];
  analyses: Map<string, DropLabTrackAnalysis>;
  activeCandidateId: string | null;
  loading: boolean;
  usbReady: boolean;
  onLoadTrack: (trackId: string, side: DropLabSide, method: DropLabLoadMethod) => void;
}

/** The candidate list: a Cue Points track table. Rows drag onto the timeline or load from a right-click menu. */
export function CandidateRotation({ candidates, analyses, activeCandidateId, loading, usbReady, onLoadTrack }: CandidateRotationProps) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TrackTableSort<CandidateSortColumn> | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; trackId: string; title: string } | null>(null);
  const rows = useMemo(() => arrangeCandidates(candidates, search, sort), [candidates, search, sort]);

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
        <div className="overflow-x-auto">
          <TrackTable className="min-w-[980px]" data-testid="drop-lab-candidate-table" aria-label="Drop Lab candidates">
            <TrackTableHead>
              <TrackTableHeadCell sticky={false} label="Candidate" column="title" sort={sort} onSort={handleSort} />
              <TrackTableHeadCell sticky={false} label="BPM" column="bpm" sort={sort} onSort={handleSort} className="w-[80px]" />
              <TrackTableHeadCell sticky={false} label="Key" column="key" sort={sort} onSort={handleSort} className="w-[90px]" />
              <TrackTableHeadCell sticky={false} label="Match" column="match" sort={sort} onSort={handleSort} className="w-[230px]" />
              <TrackTableHeadCell sticky={false} label="Status" className="w-[190px]" />
            </TrackTableHead>
            <TrackTableBody>
              {rows.map((candidate) => (
                <CandidateRow
                  key={candidate.track.id}
                  candidate={candidate}
                  analysis={analyses.get(candidate.track.id)}
                  active={candidate.track.id === activeCandidateId}
                  usbReady={usbReady}
                  onLoadAsDrop={() => onLoadTrack(candidate.track.id, 'drop', 'click')}
                  onContextMenu={(event) => openMenu(event, candidate)}
                />
              ))}
            </TrackTableBody>
          </TrackTable>
        </div>
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
