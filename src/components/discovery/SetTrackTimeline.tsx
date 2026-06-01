import { ExternalLink } from 'lucide-react';
import type { DiscoverySetTrack } from '../../types';

export interface SetTrackTimelineProps {
  tracks: DiscoverySetTrack[];
  isTimedSet: boolean;
}

type TimelineGroup = {
  primary: DiscoverySetTrack;
  primaryIndex: number;
  layered: DiscoverySetTrack[];
};

function buildGroups(tracks: DiscoverySetTrack[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  let current: TimelineGroup | null = null;
  let n = 0;
  const orphans: DiscoverySetTrack[] = [];

  for (const t of tracks) {
    if (!t.played_with_previous) {
      if (current) groups.push(current);
      n++;
      current = { primary: t, primaryIndex: n, layered: [] };
    } else {
      if (current) current.layered.push(t);
      else orphans.push(t);
    }
  }
  if (current) {
    if (orphans.length) current.layered = [...orphans, ...current.layered];
    groups.push(current);
  }
  return groups;
}

function getCueLabel(t: DiscoverySetTrack, timed: boolean, n: number): string {
  if (timed && t.cue_text) return t.cue_text;
  if (t.cue_seconds != null) {
    const m = Math.floor(t.cue_seconds / 60);
    const s = t.cue_seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return `#${String(n).padStart(2, '0')}`;
}

function getTransitionLabel(a: DiscoverySetTrack, b: DiscoverySetTrack): string {
  if (
    a.cue_seconds != null &&
    b.cue_seconds != null &&
    b.cue_seconds > a.cue_seconds
  ) {
    const d = b.cue_seconds - a.cue_seconds;
    const m = Math.floor(d / 60);
    const s = d % 60;
    return `${m}:${String(s).padStart(2, '0')} until next`;
  }
  return 'next track';
}

// Rail zone is h-16 (64px). Node top sits at 42px → center at 49px.
// Connector line uses pb-[15px] so its bottom sits at 15px from container
// bottom = 49px from top, matching the node center.
const NODE_TOP = 42;

function PrimaryCard({ g }: { g: TimelineGroup }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-xl p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-mono font-bold text-primary">
          {String(g.primaryIndex).padStart(2, '0')}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {g.primary.duration_text && (
            <span className="text-[10px] font-mono text-muted-foreground">
              {g.primary.duration_text}
            </span>
          )}
          {g.primary.source_track_url && (
            <a
              href={g.primary.source_track_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary transition-colors"
              title="View on source"
            >
              <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>
      <p className="text-sm font-bold text-foreground leading-snug line-clamp-2 mb-0.5">
        {g.primary.title != null ? (
          g.primary.title
        ) : (
          <span className="italic font-normal opacity-40">Unknown Track</span>
        )}
      </p>
      {g.primary.artist_text && (
        <p className="text-[10px] text-muted-foreground truncate">
          {g.primary.artist_text}
        </p>
      )}
    </div>
  );
}

function LayeredCards({ tracks }: { tracks: DiscoverySetTrack[] }) {
  return (
    <div className="mt-2 ml-3 pl-3 border-l-2 border-dashed border-primary/20">
      <span className="text-[8px] font-bold uppercase tracking-widest text-secondary block mb-1.5">
        {tracks.length === 1 ? 'Layered Moment' : 'Layered Moments'}
      </span>
      <div className="space-y-1.5">
        {tracks.map((lt) => (
          <div
            key={lt.id}
            className="bg-primary/5 border border-primary/15 rounded-lg p-2"
          >
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[8px] font-bold text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                w/
              </span>
              {lt.source_track_url && (
                <a
                  href={lt.source_track_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                >
                  <ExternalLink size={9} />
                </a>
              )}
            </div>
            <p className="text-xs font-bold text-foreground leading-snug line-clamp-2">
              {lt.title != null ? (
                lt.title
              ) : (
                <span className="italic font-normal opacity-40">Unknown</span>
              )}
            </p>
            {lt.artist_text && (
              <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                {lt.artist_text}
              </p>
            )}
            {lt.duration_text && (
              <p className="text-[9px] font-mono text-muted-foreground/60 mt-0.5">
                {lt.duration_text}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SetTrackTimeline({ tracks, isTimedSet }: SetTrackTimelineProps) {
  const groups = buildGroups(tracks);

  if (!groups.length) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        No primary tracks found.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto scrollbar-none">
      <div className="min-w-max px-6 py-6 pb-8">
        <div className="flex items-start">

          {/* ── Legend ────────────────────────────────────────────────── */}
          <div className="w-[200px] shrink-0 pr-6 mr-6 border-r border-[var(--color-border-faint)] pt-3">
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-primary mb-1.5">
              Transition Timeline
            </p>
            <p className="text-[10px] text-muted-foreground leading-relaxed mb-4 max-w-[160px]">
              Follow the flow of the set with key transitions and layered moments.
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0 shadow-sm shadow-primary/40" />
                <span className="text-[9px] text-muted-foreground">Main track</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-secondary shrink-0 shadow-sm shadow-secondary/30" />
                <span className="text-[9px] text-muted-foreground">Layered w/</span>
              </div>
            </div>
          </div>

          {/* ── Groups + transition connectors ────────────────────────── */}
          {groups.map((g, gi) => (
            <div key={g.primary.id} className="flex items-start shrink-0">

              {/* Track column */}
              <div className="w-[280px] shrink-0 flex flex-col">

                {/* Rail zone — h-16 (64 px), node top at NODE_TOP */}
                <div className="h-16 relative">
                  <div className="absolute top-2 left-0 right-0 flex justify-center">
                    <span className="text-[9px] font-mono font-bold text-primary px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 whitespace-nowrap">
                      {getCueLabel(g.primary, isTimedSet, g.primaryIndex)}
                    </span>
                  </div>
                  <div
                    className="absolute left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-primary border-2 border-[var(--color-background)] shadow-md shadow-primary/40 z-10"
                    style={{ top: NODE_TOP }}
                  />
                </div>

                <PrimaryCard g={g} />
                {g.layered.length > 0 && <LayeredCards tracks={g.layered} />}
              </div>

              {/* Transition connector — not rendered after last group */}
              {gi < groups.length - 1 && (
                <div className="w-28 h-16 shrink-0 flex flex-col items-center justify-end pb-[15px] gap-0.5">
                  <span className="text-[7px] font-bold uppercase tracking-wider text-primary/60 border border-primary/20 bg-primary/5 px-1.5 py-px rounded-full whitespace-nowrap">
                    transition
                  </span>
                  <span className="text-[8px] font-mono text-muted-foreground/40 whitespace-nowrap text-center leading-tight">
                    {getTransitionLabel(g.primary, groups[gi + 1].primary)}
                  </span>
                  <div className="w-full h-px bg-primary/20 mt-1" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
