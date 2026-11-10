import { RecordTrackListing } from '../ui/display/RecordTrackListing';
import { useMemo, useState } from 'react';
import { Xmark } from 'iconoir-react/regular';
import type { RekordboxTrack } from '../../types';
import { SearchControl } from '../ui/controls';

const VISIBLE_LIMIT = 100;

/** Choose the source track from the whole library (the same pool Flip Lab uses). */
export function DropLabSourcePicker({
  tracks, loading, currentId, onPick, onClose,
}: { tracks: RekordboxTrack[]; loading: boolean; currentId: string | null; onPick: (track: RekordboxTrack) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = needle
      ? tracks.filter((track) => `${track.title} ${track.artist ?? ''}`.toLowerCase().includes(needle))
      : tracks;
    return [...list].sort((a, b) => a.title.localeCompare(b.title));
  }, [search, tracks]);
  return (
    <div
      role="dialog"
      aria-label="Choose a source track"
      className="absolute right-4 top-12 z-50 w-[960px] max-w-[calc(100%-2rem)] overflow-hidden dd-popup-surface"
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] p-2">
        <div className="min-w-0 flex-1"><SearchControl underline autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or artist…" aria-label="Search source tracks" /></div>
        <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1.5 text-muted-foreground transition-colors hover:text-foreground"><Xmark width={16} height={16} aria-hidden="true" /></button>
      </div>
      <div className="max-h-[50vh] overflow-y-auto">
        {loading && tracks.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading your library…</p>
        ) : matches.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No tracks match your search.</p>
        ) : (
          <RecordTrackListing
            tracks={matches.slice(0, VISIBLE_LIMIT)}
            selectedId={currentId}
            onSelect={onPick}
            ariaLabel="Library tracks"
          />
        )}
        {matches.length > VISIBLE_LIMIT && <p className="px-4 py-2 text-center text-[11px] text-muted-foreground">Showing {VISIBLE_LIMIT} of {matches.length}. Search to narrow it down.</p>}
      </div>
    </div>
  );
}
