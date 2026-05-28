import { FileUp, Database } from 'lucide-react';
import type { RekordboxImport } from '../../types';

interface LibraryHeroProps {
  latestImport: RekordboxImport;
  onImport: () => void;
}

export function LibraryHero({ latestImport, onImport }: LibraryHeroProps) {
  const importedDate = new Date(latestImport.imported_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const displayName = latestImport.device_name ?? latestImport.source_filename;

  return (
    <div className="glass rounded-3xl p-6 md:p-8 border border-[var(--color-border-subtle)] relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-secondary/5 pointer-events-none" />

      <div className="relative">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
          {/* Identity */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <Database size={13} className="text-primary" />
              </div>
              <p className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground font-bold">
                Rekordbox Library
              </p>
            </div>
            <h1 className="text-2xl md:text-3xl font-black leading-tight truncate">{displayName}</h1>
            {latestImport.device_name && (
              <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                {latestImport.source_filename}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">Last imported {importedDate}</p>
          </div>

          {/* Stats */}
          <div className="flex gap-6 sm:gap-8 shrink-0">
            {[
              { value: latestImport.track_count.toLocaleString(), label: 'Tracks' },
              { value: String(latestImport.playlist_count), label: 'Playlists' },
              { value: latestImport.playlist_track_count.toLocaleString(), label: 'Placements' },
            ].map(({ value, label }) => (
              <div key={label} className="text-center">
                <p className="text-2xl md:text-3xl font-black font-mono">{value}</p>
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <button
            onClick={onImport}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all active:scale-95"
          >
            <FileUp size={13} />
            Import New Library
          </button>
        </div>
      </div>
    </div>
  );
}
