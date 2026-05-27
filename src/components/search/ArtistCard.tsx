import { ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { SearchArtist } from '../../types';

const GENRE_PILL: Record<string, string> = {
  'Melodic Dubstep': 'bg-primary/10 text-primary',
  'Future Bass': 'bg-secondary/10 text-secondary',
};

const AVATAR_COLORS = [
  'bg-primary/20 text-primary',
  'bg-secondary/20 text-secondary',
  'bg-purple-500/20 text-purple-400',
  'bg-teal-500/20 text-teal-400',
  'bg-amber-500/20 text-amber-400',
  'bg-rose-500/20 text-rose-400',
];

export function artistAvatarColor(name: string): string {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

interface ArtistCardProps {
  artist: SearchArtist;
}

export function ArtistCard({ artist }: ArtistCardProps) {
  const initials = artist.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div
      className={cn(
        'w-44 shrink-0 flex flex-col rounded-2xl overflow-hidden border transition-all',
        'border-[var(--color-border-subtle)] bg-[var(--color-surface)]',
        'hover:bg-[var(--color-surface-hover)] hover:border-primary/20',
      )}
    >
      <div className="h-24 flex items-center justify-center bg-[var(--color-avatar-bg)]">
        <div
          className={cn(
            'w-14 h-14 rounded-full flex items-center justify-center text-xl font-black',
            artistAvatarColor(artist.name),
          )}
        >
          {initials}
        </div>
      </div>

      <div className="flex flex-col gap-2 p-3 flex-1">
        <p className="font-bold text-sm leading-tight truncate">{artist.name}</p>

        <div className="flex flex-wrap gap-1">
          {artist.genres.map((g) => (
            <span
              key={g}
              className={cn(
                'px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest',
                GENRE_PILL[g] ?? 'bg-[var(--color-avatar-bg)] text-muted-foreground',
              )}
            >
              {g}
            </span>
          ))}
        </div>

        {artist.source_artist_url && (
          <a
            href={artist.source_artist_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-auto flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink size={10} />
            1001Tracklists
          </a>
        )}
      </div>
    </div>
  );
}
