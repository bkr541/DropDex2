import { Activity, Music2 } from 'lucide-react';
import { cn, formatKey } from '../../lib/utils';
import type { DropPoint } from '../../lib/music/dropPointResolver';
import type { RekordboxTrack } from '../../types';

interface DropLabTrackHeaderProps {
  label: string;
  track: RekordboxTrack | null;
  dropPoint: DropPoint | null;
  muted?: boolean;
}

function initials(track: RekordboxTrack | null): string {
  if (!track) return '--';
  return `${track.artist?.[0] ?? track.title?.[0] ?? '?'}${track.title?.[0] ?? '?'}`.toUpperCase();
}

export function DropLabTrackHeader({ label, track, dropPoint, muted }: DropLabTrackHeaderProps) {
  const bpm = track?.bpm != null ? track.bpm.toFixed(1) : '--';
  const key = formatKey(track?.musical_key ?? null);
  const rating = track?.rating ?? 0;

  return (
    <div className={cn('flex gap-4 min-w-0', muted && 'opacity-70')}>
      <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-avatar-bg)] flex items-center justify-center shrink-0 shadow-sm">
        <span className="font-black text-xl text-muted-foreground">{initials(track)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-1">{label}</p>
        <h3 className="text-xl md:text-2xl font-black italic uppercase leading-tight truncate">
          {track?.title ?? 'No track selected'}
        </h3>
        <p className="text-sm font-bold text-primary uppercase tracking-widest truncate">
          {track?.artist ?? 'Artist not stored'}
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="px-2 py-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-faint)] text-[10px] font-mono font-bold">
            {bpm} BPM
          </span>
          <span className="px-2 py-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-faint)] text-[10px] font-mono font-bold text-secondary">
            {key}
          </span>
          <span className="px-2 py-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-faint)] text-[10px] font-mono font-bold flex items-center gap-1.5">
            <Activity size={12} className="text-primary" />
            {rating > 0 ? `${rating}/5` : '--'}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Music2 size={12} />
          <span>{dropPoint ? `${dropPoint.label} · ${dropPoint.confidence}` : 'Drop point unavailable'}</span>
        </div>
      </div>
    </div>
  );
}

