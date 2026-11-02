import { CandidateRow, CANDIDATE_COLUMNS } from './CandidateRow';
import type { DropLabCandidate } from '../../hooks/useDropLabFlipPicks';
import type { DropLabTrackAnalysis } from '../../hooks/useDropLabAnalysis';
import { CircleDash } from '@carbon/icons-react';

interface CandidateRotationProps {
  candidates: DropLabCandidate[];
  analyses: Map<string, DropLabTrackAnalysis>;
  activeCandidateId: string | null;
  loading: boolean;
  onSelect: (trackId: string) => void;
}

/** The candidate list, as a Cue Points-style table. */
export function CandidateRotation({ candidates, analyses, activeCandidateId, loading, onSelect }: CandidateRotationProps) {
  return (
    <section className="min-h-0 flex-1">
      <div className="flex items-center justify-between px-5 py-3">
        <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Candidate rotation</h3>
        <span className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
          {loading && <CircleDash size={13} className="animate-spin" aria-label="Loading candidates" />}
          {candidates.length} candidates
        </span>
      </div>
      <div
        className="grid items-center border-y border-[var(--color-border-faint)] px-5 py-2 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground"
        style={{ gridTemplateColumns: CANDIDATE_COLUMNS }}
      >
        <span>Candidate</span><span>BPM</span><span>Key</span><span>Match</span><span>Why it fits</span><span>Status</span><span />
      </div>
      <div role="listbox" aria-label="Drop Lab candidates">
        {loading && candidates.length === 0 ? (
          Array.from({ length: 4 }).map((_, index) => <div key={index} className="m-3 h-12 animate-pulse rounded-lg bg-white/[0.05]" />)
        ) : candidates.length === 0 ? (
          <p className="py-8 text-center text-xs italic text-muted-foreground">No compatible drop candidates were found for this track.</p>
        ) : (
          candidates.map((candidate) => (
            <CandidateRow
              key={candidate.track.id}
              candidate={candidate}
              analysis={analyses.get(candidate.track.id)}
              active={candidate.track.id === activeCandidateId}
              onSelect={() => onSelect(candidate.track.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}
