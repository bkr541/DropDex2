import { useEffect, useMemo, useState } from 'react';
import { Music, Upload } from '@carbon/icons-react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { useLibraryStats } from '../../hooks/useRekordboxTracks';
import { useSpotifyAvailability } from '../../hooks/useSpotifyAvailability';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import type { PlaylistWithCount } from '../../lib/queries/rekordbox';
import type { RekordboxImport, RekordboxTrack, UserPlaylistProfile, UserProfile } from '../../types';
import { CuePointsView } from '../cues/CuePointsView';
import { ControlButton } from '../ui/controls';
import { ArtistProfileCard, DesktopLibraryHero, RecentlyAddedPanel } from './LibraryView';
import { LibraryHero } from './LibraryHero';
import { bpmRangeStatsFrom, keyStatsFrom } from './libraryInsights';
import { LibraryTabBar } from './LibraryTabBar';
import { ArtistsPanel, GenresPanel, PlaylistsPanel } from './LibraryTabPanels';
import { reviewTabs, type ReviewTab } from './reviewTabs';
import { SpotifyLibraryTab } from './SpotifyLibraryTab';

export interface ReviewViewProps {
  importId: string;
  latestImport: RekordboxImport;
  profile: UserProfile | null;
  playlists: PlaylistWithCount[];
  playlistsLoading: boolean;
  playlistProfilesByRbId: Map<string, UserPlaylistProfile>;
  recentTracks: RekordboxTrack[];
  recentTracksLoading: boolean;
  spotifyAccessToken: string | null;
  onPlaylistClick: (playlist: PlaylistWithCount) => void;
  onEditPlaylist: (playlist: PlaylistWithCount) => void;
  onImport: () => void;
  onResumeAnalysis?: (importId: string) => void;
  onShowIncompleteAnalysis: () => void;
  onTrackClick: (track: RekordboxTrack) => void;
}

/** Recently Added with its own waveform loading and playback, since Review has no shared table state. */
function ReviewRecentlyAdded({
  importId, tracks, loading, onTrackClick,
}: { importId: string; tracks: RekordboxTrack[]; loading: boolean; onTrackClick: (track: RekordboxTrack) => void }) {
  const trackIds = useMemo(() => tracks.map((track) => track.id), [tracks]);
  const { getState, retry } = useTrackPreviewWaveforms(importId, trackIds);
  const { activeTrack, status, playIntent, toggleTrack } = useAudioPlayer();
  const { status: usbStatus } = useUsbConnection();
  return (
    <RecentlyAddedPanel
      tracks={tracks}
      loading={loading}
      getWaveformState={getState}
      retryWaveform={retry}
      activeTrack={activeTrack}
      playerStatus={status}
      playIntent={playIntent}
      usbConnected={usbStatus === 'connected'}
      onTrackClick={onTrackClick}
      onPlay={(track) => { void toggleTrack(track); }}
    />
  );
}

export function ReviewView({
  importId, latestImport, profile, playlists, playlistsLoading, playlistProfilesByRbId, recentTracks, recentTracksLoading,
  spotifyAccessToken, onPlaylistClick, onEditPlaylist, onImport, onResumeAnalysis, onShowIncompleteAnalysis, onTrackClick,
}: ReviewViewProps) {
  const { stats, loading: statsLoading } = useLibraryStats(importId);
  const [activeTab, setActiveTab] = useState<ReviewTab>('tracks');
  const spotifyAvailable = useSpotifyAvailability(spotifyAccessToken);
  const tabs = useMemo(() => reviewTabs(spotifyAvailable), [spotifyAvailable]);

  useEffect(() => {
    if (spotifyAvailable === false && activeTab === 'spotify') setActiveTab('tracks');
  }, [activeTab, spotifyAvailable]);

  const topGenres = useMemo(() => (stats?.genreTotals ?? []).slice(0, 8).map(({ name, count }) => [name, count] as const), [stats?.genreTotals]);
  const genreStats = useMemo(() => (stats?.genreTotals ?? []).map(({ name, count }) => [name, count] as const), [stats?.genreTotals]);
  const artistStats = useMemo(() => (stats?.artistTotals ?? []).map(({ name, count }) => [name, count] as const), [stats?.artistTotals]);
  const bpmRangeStats = useMemo(() => bpmRangeStatsFrom(stats?.bpmTotals), [stats?.bpmTotals]);
  const keyStats = useMemo(() => keyStatsFrom(stats?.keyTotals), [stats?.keyTotals]);
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
              bpmRangeStats={bpmRangeStats} keyStats={keyStats}
              largestPlaylistName={largestPlaylist?.name ?? null} onImport={onImport}
              onResumeAnalysis={onResumeAnalysis} onShowIncompleteAnalysis={onShowIncompleteAnalysis} />
          </div>
          <div className="lg:hidden">
            <LibraryHero latestImport={latestImport} profile={profile} onImport={onImport} onResumeAnalysis={onResumeAnalysis} />
          </div>
        </div>
      </div>

      <LibraryTabBar<ReviewTab> tabs={tabs} activeTab={activeTab} onChange={setActiveTab} ariaLabel="Library sections" />

      {activeTab === 'playlists' && (
        <PlaylistsPanel
          playlists={playlists}
          loading={playlistsLoading}
          profilesByRbId={playlistProfilesByRbId}
          onPlaylistClick={onPlaylistClick}
          onEditPlaylist={onEditPlaylist}
        />
      )}
      {activeTab === 'recently-added' && (
        <ReviewRecentlyAdded importId={importId} tracks={recentTracks} loading={recentTracksLoading} onTrackClick={onTrackClick} />
      )}
      {/* Kept mounted so its search and filters are still there when you come back to Tracks. */}
      <div className={activeTab === 'tracks' ? undefined : 'hidden'} data-testid="review-tracks-panel">
        <CuePointsView mode="review" importId={importId} onImport={onImport} onTrackOpen={onTrackClick} />
      </div>
      {activeTab === 'genres' && <GenresPanel genreStats={genreStats} loading={statsLoading} />}
      {activeTab === 'artists' && <ArtistsPanel artistStats={artistStats} loading={statsLoading} />}
      {activeTab === 'spotify' && spotifyAvailable && spotifyAccessToken && <SpotifyLibraryTab accessToken={spotifyAccessToken} />}
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
