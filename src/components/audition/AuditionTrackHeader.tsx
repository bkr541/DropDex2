import { Checkmark, ChevronLeft, ChevronRight, Close, Renew } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { Artwork } from '../ui/display/Artwork';
import { KeyBadge } from '../ui/display/KeyBadge';
import { formatClock } from './auditionTracks';
import type { RekordboxTrack } from '../../types';

interface AuditionTrackHeaderProps {
  track: RekordboxTrack | null;
  durationMs: number | null;
  /** "14 of 387", or null when the track is not in the current list. */
  positionLabel: string | null;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}

// Keep / Maybe / Remove are shown so the layout is final, but they are not
// connected to anything yet. They stay disabled and say so on hover.
const DECISIONS = [
  { id: 'keep', label: 'Keep', Icon: Checkmark, tone: 'border-emerald-400/55 text-emerald-300' },
  { id: 'maybe', label: 'Maybe', Icon: Renew, tone: 'border-white/25 text-foreground' },
  { id: 'remove', label: 'Remove', Icon: Close, tone: 'border-red-400/55 text-red-300' },
] as const;

const NAV_BUTTON = 'flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-[var(--color-border-subtle)] disabled:hover:text-foreground';

function Divider() {
  return <span aria-hidden="true" className="h-3 w-px shrink-0 bg-white/15" />;
}

export function AuditionTrackHeader({ track, durationMs, positionLabel, onPrevious, onNext }: AuditionTrackHeaderProps) {
  return (
    <section
      data-testid="audition-track-header"
      aria-label="Selected track"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-card)]/60 px-3.5 py-3"
    >
      <div className="flex min-w-0 flex-1 basis-[320px] items-center gap-3.5">
        <Artwork
          src={track?.artwork_path}
          alt={track ? `Artwork for ${track.title}` : 'No track selected'}
          fallbackTitle="No artwork"
          className="h-14 w-14 shrink-0 rounded-md"
        />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold leading-tight" title={track?.title}>
            {track?.title ?? 'Select a track'}
          </h2>
          {track ? (
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] text-muted-foreground">
              <KeyBadge camelotKey={track.musical_key} variant="text" className="!text-[13px]" />
              <Divider />
              <span className="font-mono tabular-nums">{track.bpm != null ? `${track.bpm.toFixed(0)} BPM` : '— BPM'}</span>
              <Divider />
              <span className="font-mono tabular-nums">{durationMs != null ? formatClock(durationMs) : '—'}</span>
              {track.genre ? (
                <>
                  <Divider />
                  <span className="truncate">{track.genre}</span>
                </>
              ) : null}
              {track.artist ? (
                <>
                  <Divider />
                  <span className="truncate">{track.artist}</span>
                </>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-[13px] text-muted-foreground">Pick a track from the library below.</p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2" role="group" aria-label="Track decision">
        {DECISIONS.map(({ id, label, Icon, tone }) => (
          <span key={id} title="Coming soon" className="inline-flex">
            <button
              type="button"
              disabled
              aria-label={`${label} (coming soon)`}
              data-testid={`audition-decision-${id}`}
              className={cn(
                'inline-flex h-9 min-w-[96px] cursor-not-allowed items-center justify-center gap-2 rounded-md border bg-transparent px-3.5 text-sm font-medium opacity-55',
                tone,
              )}
            >
              <Icon size={16} />
              {label}
            </button>
          </span>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-2.5" role="group" aria-label="Move between tracks">
        <button type="button" aria-label="Previous track" title="Previous track" className={NAV_BUTTON} disabled={!onPrevious} onClick={() => onPrevious?.()}>
          <ChevronLeft size={18} />
        </button>
        <span className="min-w-[74px] text-center font-mono text-[13px] tabular-nums text-muted-foreground" data-testid="audition-position">
          {positionLabel ?? '—'}
        </span>
        <button type="button" aria-label="Next track" title="Next track" className={NAV_BUTTON} disabled={!onNext} onClick={() => onNext?.()}>
          <ChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}
