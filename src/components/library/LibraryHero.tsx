import { useState } from 'react';
import { FileUp, CheckCircle2, Music, ListMusic, Calendar, User } from 'lucide-react';
import type { RekordboxImport, UserProfile } from '../../types';

interface LibraryHeroProps {
  latestImport: RekordboxImport;
  profile: UserProfile | null;
  onImport: () => void;
}

export function LibraryHero({ latestImport, profile, onImport }: LibraryHeroProps) {
  const [imgError, setImgError] = useState(false);

  const libraryName = profile?.display_name
    ? profile.display_name.toUpperCase()
    : 'MY LIBRARY';

  const avatarUrl = profile?.avatar_url ?? null;
  const initials = profile?.display_name
    ? profile.display_name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : null;

  const importedDate = new Date(latestImport.imported_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  const shortDate = new Date(latestImport.imported_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
  const isToday = new Date(latestImport.imported_at).toDateString() === new Date().toDateString();

  return (
    <div className="glass rounded-3xl border border-[var(--color-border-subtle)] overflow-hidden">
      <div className="flex flex-col lg:flex-row">

        {/* ── Left: main info ── */}
        <div className="flex-1 p-6 md:p-8 flex gap-6 items-start">
          {/* Profile avatar */}
          <div className="relative shrink-0 hidden sm:block">
            {avatarUrl && !imgError ? (
              <img
                src={avatarUrl}
                alt={profile?.display_name ?? 'Profile'}
                onError={() => setImgError(true)}
                className="w-20 h-20 rounded-full object-cover ring-4 ring-primary/25 shadow-xl"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/25 to-primary/5 border-2 border-primary/20 flex items-center justify-center shadow-lg">
                {initials ? (
                  <span className="text-2xl font-black text-primary">{initials}</span>
                ) : (
                  <User size={32} className="text-primary/70" />
                )}
              </div>
            )}
            <div className="absolute inset-[-6px] rounded-full border border-primary/10 pointer-events-none" />
            <div className="absolute inset-[-13px] rounded-full border border-primary/5 pointer-events-none" />
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground mb-1">Library</p>
            <h1 className="text-2xl md:text-3xl font-black uppercase leading-tight tracking-tight">
              {libraryName}
            </h1>
            <p className="text-xs font-semibold mt-2">
              {latestImport.track_count.toLocaleString()} tracks across {latestImport.playlist_count} playlists
            </p>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
              Imported from {latestImport.source_filename} · {importedDate}
            </p>

            <div className="flex flex-wrap gap-3 mt-5">
              <button
                onClick={onImport}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm hover:bg-primary/90 transition-all active:scale-95 shadow-md"
              >
                <FileUp size={14} />
                Import New Library
              </button>
            </div>
          </div>
        </div>

        {/* ── Right: status + stats ── */}
        <div className="lg:w-72 shrink-0 border-t lg:border-t-0 lg:border-l border-[var(--color-border-subtle)] bg-[var(--color-surface)]/40 p-6 flex flex-col gap-4">
          <div>
            <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-2">
              Library Status
            </p>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-green-500 shrink-0" />
              <span className="font-bold text-sm text-green-500">Import Complete</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Last imported {isToday ? 'today' : importedDate}
            </p>
          </div>

          <div className="border-t border-[var(--color-border-subtle)]" />

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <Music size={13} className="text-muted-foreground" />
              <span className="text-xl font-black tabular-nums leading-none">
                {latestImport.track_count >= 1000
                  ? `${(latestImport.track_count / 1000).toFixed(1)}k`
                  : latestImport.track_count}
              </span>
              <span className="text-[8px] uppercase tracking-widest text-muted-foreground font-bold">Tracks</span>
            </div>
            <div className="flex flex-col gap-1">
              <ListMusic size={13} className="text-muted-foreground" />
              <span className="text-xl font-black tabular-nums leading-none">{latestImport.playlist_count}</span>
              <span className="text-[8px] uppercase tracking-widest text-muted-foreground font-bold">Playlists</span>
            </div>
            <div className="flex flex-col gap-1">
              <Calendar size={13} className="text-muted-foreground" />
              <span className="text-base font-black leading-none mt-0.5">{shortDate}</span>
              <span className="text-[8px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">Last Import</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
