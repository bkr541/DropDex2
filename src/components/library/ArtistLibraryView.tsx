import './library-studio.css';
import '../ui/studio-surface.css';
import { useMemo, useState } from 'react';
import { MusicNote, Upload } from 'iconoir-react/regular';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { useLibraryStats } from '../../hooks/useRekordboxTracks';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import type { PlaylistWithCount } from '../../lib/queries/rekordbox';
import type { RekordboxTrack, UserPlaylistProfile } from '../../types';
import { CuePointsTrackPanel, CuePointsView } from '../cues/CuePointsView';
import { ControlButton } from '../ui/controls';
import { RecentlyAddedPanel } from './LibraryView';
import { LibraryTabBar } from './LibraryTabBar';
import { ArtistsPanel, GenresPanel, PlaylistsPanel } from './LibraryTabPanels';
import { artistLibraryTabs, type ArtistLibraryTab } from './artistLibraryTabs';

export interface ArtistLibraryViewProps {
  importId: string;
  playlists: PlaylistWithCount[];
  playlistsLoading: boolean;
  playlistProfilesByRbId: Map<string, UserPlaylistProfile>;
  recentTracks: RekordboxTrack[];
  recentTracksLoading: boolean;
  onPlaylistClick: (playlist: PlaylistWithCount) => void;
  onEditPlaylist: (playlist: PlaylistWithCount) => void;
  onImport: () => void;
  onTrackClick: (track: RekordboxTrack) => void;
}

/** Recently Added with its own waveform loading and playback, since the Artist Library has no shared table state. */
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

export function ArtistLibraryView({
  importId, playlists, playlistsLoading, playlistProfilesByRbId, recentTracks, recentTracksLoading,
  onPlaylistClick, onEditPlaylist, onImport, onTrackClick,
}: ArtistLibraryViewProps) {
  const { stats, loading: statsLoading } = useLibraryStats(importId);
  const [activeTab, setActiveTab] = useState<ArtistLibraryTab>('tracks');
  // The track picked in the Tracks table. The table selects the first track on load.
  const [selectedTrack, setSelectedTrack] = useState<RekordboxTrack | null>(null);
  const panelTrackIds = useMemo(() => (selectedTrack ? [selectedTrack.id] : []), [selectedTrack]);
  const panelWaveforms = useTrackPreviewWaveforms(importId, panelTrackIds);
  const tabs = useMemo(() => artistLibraryTabs(), []);

  const genreStats = useMemo(() => (stats?.genreTotals ?? []).map(({ name, count }) => [name, count] as const), [stats?.genreTotals]);
  const artistStats = useMemo(() => (stats?.artistTotals ?? []).map(({ name, count }) => [name, count] as const), [stats?.artistTotals]);

  return (
    <div className="lib-scope studio-surface artist-library-studio" data-testid="artist-library">
      {/* The selected track's waveform, cue points and beat grid: the same panel as Track Intelligence. */}
      {selectedTrack && (
        <CuePointsTrackPanel
          key={selectedTrack.id}
          track={selectedTrack}
          waveformState={panelWaveforms.getState(selectedTrack.id)}
          onRetryWaveform={() => panelWaveforms.retry([selectedTrack.id])}
        />
      )}

      <LibraryTabBar<ArtistLibraryTab> tabs={tabs} activeTab={activeTab} onChange={setActiveTab} ariaLabel="Library sections" />

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
      <div className={activeTab === 'tracks' ? undefined : 'hidden'} data-testid="artist-library-tracks-panel">
        <CuePointsView mode="artist-library" importId={importId} onImport={onImport} onTrackOpen={onTrackClick} onSelectedTrackChange={setSelectedTrack} />
      </div>
      {activeTab === 'genres' && <GenresPanel genreStats={genreStats} loading={statsLoading} />}
      {activeTab === 'artists' && <ArtistsPanel artistStats={artistStats} loading={statsLoading} />}
    </div>
  );
}

export function ArtistLibraryEmptyState({ onImport }: { onImport?: () => void }) {
  return (
    <div className="lib-scope studio-surface p-8 text-center">
      <MusicNote width={40} height={40} aria-hidden="true" className="mx-auto mb-4 text-primary" />
      <h2 className="text-[26px] font-light tracking-[-0.035em]">Artist Library</h2>
      <p className="mt-2 text-sm text-muted-foreground">Import a library to start reviewing your collection.</p>
      {onImport && <ControlButton variant="primary" onClick={onImport} className="mt-5"><Upload width={16} height={16} aria-hidden="true" /> Import library</ControlButton>}
    </div>
  );
}
