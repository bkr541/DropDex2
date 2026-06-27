import { Loader2 } from 'lucide-react';
import { CandidateRow } from './CandidateRow';
import type { DropLabCandidate } from '../../hooks/useDropLabCandidates';
import type { DropLabTrackAnalysis } from '../../hooks/useDropLabAnalysis';

interface CandidateRotationProps {
  candidates: DropLabCandidate[];
  analyses: Map<string, DropLabTrackAnalysis>;
  activeCandidateId: string | null;
  loading: boolean;
  onSelect: (trackId: string) => void;
}

export function CandidateRotation({
  candidates,
  analyses,
  activeCandidateId,
  loading,
  onSelect,
}: CandidateRotationProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Candidate Rotation</h3>
        {loading && <Loader2 size={14} className="animate-spin text-muted-foreground" aria-label="Loading candidates" />}
      </div>
      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1" role="listbox" aria-label="Drop Lab candidates">
        {loading && candidates.length === 0 ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-20 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-faint)] animate-pulse" />
          ))
        ) : candidates.length === 0 ? (
          <p className="text-xs text-muted-foreground italic text-center py-6">
            No compatible drop candidates were found for this track.
          </p>
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

