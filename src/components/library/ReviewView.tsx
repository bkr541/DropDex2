import { useMemo } from 'react';
import { Music, Upload } from '@carbon/icons-react';
import { useLibraryStats } from '../../hooks/useRekordboxTracks';
import type { PlaylistWithCount } from '../../lib/queries/rekordbox';
import type { RekordboxImport, RekordboxTrack, UserProfile } from '../../types';
import { CuePointsView } from '../cues/CuePointsView';
import { ControlButton } from '../ui/controls';
import { ArtistProfileCard, DesktopLibraryHero } from './LibraryView';
import { LibraryHero } from './LibraryHero';

export interface ReviewViewProps {
  importId: string;
  latestImport: RekordboxImport;
  profile: UserProfile | null;
  playlists: PlaylistWithCount[];
  onImport: () => void;
  onResumeAnalysis?: (importId: string) => void;
  onShowIncompleteAnalysis: () => void;
  onTrackClick: (track: RekordboxTrack) => void;
}

export function ReviewView({ importId, latestImport, profile, playlists, onImport, onResumeAnalysis, onShowIncompleteAnalysis, onTrackClick }: ReviewViewProps) {
  const { stats } = useLibraryStats(importId);
  const topGenres = useMemo(() => (stats?.genreTotals ?? []).slice(0, 8).map(({ name, count }) => [name, count] as const), [stats?.genreTotals]);
  const largestPlaylist = useMemo(() => playlists.filter((playlist) => !playlist.is_folder).sort((a, b) => b.track_count - a.track_count)[0], [playlists]);

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex items-start gap-5">
        <div className="hidden w-[250px] shrink-0 lg:block xl:w-[268px]">
          <ArtistProfileCard profile={profile} latestImport={latestImport} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="hidden lg:block">
            <DesktopLibraryHero latestImport={latestImport} profile={profile} topGenres={topGenres}
              mostCommonBpm={stats?.mostCommonBpm ?? null} mostCommonKey={stats?.mostCommonKey ?? null}
              largestPlaylistName={largestPlaylist?.name ?? null} onImport={onImport}
              onResumeAnalysis={onResumeAnalysis} onShowIncompleteAnalysis={onShowIncompleteAnalysis} />
          </div>
          <div className="lg:hidden">
            <LibraryHero latestImport={latestImport} profile={profile} onImport={onImport} onResumeAnalysis={onResumeAnalysis} />
          </div>
        </div>
      </div>
      <CuePointsView mode="review" importId={importId} onImport={onImport} onTrackOpen={onTrackClick} />
    </div>
  );
}

export function ReviewEmptyState({ onImport }: { onImport?: () => void }) {
  return (
    <div className="glass rounded-2xl border border-[var(--color-border-subtle)] p-8 text-center">
      <Music size={40} className="mx-auto mb-4 text-primary" />
      <h2 className="text-2xl font-black uppercase tracking-tight">Review your library</h2>
      <p className="mt-2 text-sm text-muted-foreground">Import a library to start reviewing your collection.</p>
      {onImport && <ControlButton variant="primary" onClick={onImport} className="mt-5"><Upload size={16} /> Import library</ControlButton>}
    </div>
  );
}
