import { MusicNote, Playlist } from 'iconoir-react/regular';
import { focusNavigationPeer, getNextNavigationIndex } from '../ui/display/navigation';
import '../library/library-studio.css';

type TrackSource = 'library' | 'playlists';
const SOURCES = [
  { id: 'library', label: 'Tracks', Icon: MusicNote },
  { id: 'playlists', label: 'Playlists', Icon: Playlist },
] as const;

/** Independent source switch, using Library's tab styling within the filter row. */
export function TrackSourceTabs({ value, onChange }: { value: TrackSource; onChange: (value: TrackSource) => void }) {
  return <div className="lib-tabs cue-browser__source-tabs" role="tablist" aria-label="Cue Points browser source" data-testid="cue-browser-source-tabs">
    {SOURCES.map(({ id, label, Icon }, index) => <button key={id} type="button" role="tab"
      aria-selected={value === id} tabIndex={value === id ? 0 : -1} className="lib-tab"
      onClick={() => onChange(id)} onKeyDown={(event) => {
        const next = getNextNavigationIndex(event.key, index, SOURCES.length);
        if (next == null) return;
        event.preventDefault();
        onChange(SOURCES[next].id);
        focusNavigationPeer(event, '[role="tab"]', next);
      }}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />{label}
    </button>)}
  </div>;
}
