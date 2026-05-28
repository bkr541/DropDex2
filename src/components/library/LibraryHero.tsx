import { useState } from 'react';
import { User, FileUp, Pencil } from 'lucide-react';
import { MusicNote01Icon } from 'hugeicons-react';
import { cn } from '../../lib/utils';
import type { RekordboxImport, UserProfile, UserGenrePreference } from '../../types';

interface LibraryHeroProps {
  latestImport: RekordboxImport;
  profile: UserProfile | null;
  genres: UserGenrePreference[];
  onImport: () => void;
  onEditProfile: () => void;
}

export function LibraryHero({
  latestImport,
  profile,
  genres,
  onImport,
  onEditProfile,
}: LibraryHeroProps) {
  const [imgError, setImgError] = useState(false);

  const displayName = profile?.display_name ?? 'My Artist Profile';
  const username = profile?.username ?? null;
  const avatarUrl = profile?.avatar_url ?? null;

  const initials = displayName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const importedDate = new Date(latestImport.imported_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="glass rounded-3xl p-6 md:p-8 border border-[var(--color-border-subtle)] relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />

      <div className="relative flex flex-col sm:flex-row items-center sm:items-start gap-6">
        {/* Avatar */}
        <div className="shrink-0">
          {avatarUrl && !imgError ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="w-24 h-24 md:w-32 md:h-32 rounded-full object-cover ring-4 ring-primary/25 shadow-xl"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-primary/10 ring-4 ring-primary/25 shadow-xl flex items-center justify-center">
              {initials ? (
                <span className="text-2xl md:text-3xl font-black text-primary">{initials}</span>
              ) : (
                <User size={40} className="text-primary/60" />
              )}
            </div>
          )}
        </div>

        {/* Info + actions */}
        <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-start gap-4">
          {/* Text block */}
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <p className="text-[8px] uppercase tracking-[0.25em] text-muted-foreground mb-0.5">
              User Profile
            </p>
            <h1 className="text-3xl md:text-4xl font-black leading-tight">{displayName}</h1>
            {username && (
              <p className="text-xs text-muted-foreground font-mono mt-0.5">@{username}</p>
            )}

            {/* Genre chips */}
            <div className="flex flex-wrap gap-1.5 mt-3 justify-center sm:justify-start min-h-[26px]">
              {genres.length > 0 ? (
                genres.map((g) => (
                  <span
                    key={g.genre_id}
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1 rounded-full',
                      'text-[9px] font-bold uppercase tracking-widest',
                      'bg-primary/10 text-primary border border-primary/15',
                    )}
                  >
                    <MusicNote01Icon size={9} className="shrink-0" />
                    {g.genre?.name}
                  </span>
                ))
              ) : (
                <button
                  onClick={onEditProfile}
                  className="text-[9px] text-muted-foreground hover:text-primary transition-colors font-bold uppercase tracking-widest hover:underline underline-offset-2"
                >
                  + Add Genres
                </button>
              )}
            </div>

            {/* Stats row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 justify-center sm:justify-start text-[10px] text-muted-foreground">
              <span className="font-semibold">
                <span className="text-foreground">{latestImport.track_count.toLocaleString()}</span>{' '}
                Tracks
              </span>
              <span className="opacity-30">·</span>
              <span className="font-semibold">
                <span className="text-foreground">{latestImport.playlist_count}</span> Playlists
              </span>
              <span className="opacity-30">·</span>
              <span>Last scanned {importedDate}</span>
              {latestImport.source_filename && (
                <>
                  <span className="opacity-30">·</span>
                  <span className="font-mono opacity-50 text-[9px]">
                    {latestImport.source_filename}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex sm:flex-col gap-2 items-center sm:items-end shrink-0">
            <button
              onClick={onEditProfile}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
                'text-[10px] font-bold uppercase tracking-widest shadow-sm',
                'bg-[var(--color-surface)] text-foreground border border-[var(--color-border-subtle)]',
                'hover:bg-[var(--color-surface-hover)] transition-all active:scale-95',
              )}
            >
              <Pencil size={11} />
              Edit Profile
            </button>
            <button
              onClick={onImport}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
                'text-[10px] font-bold uppercase tracking-widest shadow-sm',
                'bg-[var(--color-surface)] text-foreground border border-[var(--color-border-subtle)]',
                'hover:bg-[var(--color-surface-hover)] transition-all active:scale-95',
              )}
            >
              <FileUp size={11} />
              Rescan Library
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
