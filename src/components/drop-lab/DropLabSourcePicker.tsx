import { useMemo, useState } from 'react';
import { Close } from '@carbon/icons-react';
import type { RekordboxTrack } from '../../types';
import { dropLabKeyLabel } from '../../hooks/useDropLabFlipPicks';
import { SearchControl } from '../ui/controls';
import { camelotKeyColor } from '../ui/display/camelotKey';

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
      className="absolute right-4 top-12 z-50 w-[520px] max-w-[calc(100%-2rem)] overflow-hidden rounded-md border border-[var(--color-control-border)] bg-[var(--color-control-surface)] shadow-[0_12px_28px_rgba(0,0,0,0.4)]"
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] p-2">
        <div className="min-w-0 flex-1"><SearchControl underline autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or artist…" aria-label="Search source tracks" /></div>
        <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1.5 text-muted-foreground transition-colors hover:text-foreground"><Close size={16} /></button>
      </div>
      <div className="max-h-[50vh] overflow-y-auto" role="listbox" aria-label="Library tracks">
        {loading && tracks.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading your library…</p>
        ) : matches.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No tracks match your search.</p>
        ) : (
          matches.slice(0, VISIBLE_LIMIT).map((track) => {
            const key = dropLabKeyLabel(track);
            return (
              <button
                key={track.id}
                type="button"
                role="option"
                aria-selected={track.id === currentId}
                onClick={() => onPick(track)}
                className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none"
              >
                <div className="min-w-0 flex-1">
                  <div className={track.id === currentId ? 'truncate text-sm font-bold text-primary' : 'truncate text-sm font-bold'}>{track.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{track.artist ?? 'Artist not stored'}</div>
                </div>
                <span className="font-mono text-xs font-bold tabular-nums">{track.bpm != null ? track.bpm.toFixed(1) : '--'}</span>
                <span className="w-9 font-mono text-xs font-bold" style={{ color: camelotKeyColor(key) }}>{key}</span>
              </button>
            );
          })
        )}
        {matches.length > VISIBLE_LIMIT && <p className="px-4 py-2 text-center text-[11px] text-muted-foreground">Showing {VISIBLE_LIMIT} of {matches.length}. Search to narrow it down.</p>}
      </div>
    </div>
  );
}
