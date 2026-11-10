import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Play, Trash } from 'iconoir-react/regular';
import { useAudioDockTracks } from '../../contexts/AudioDockWorkspaceContext';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { logger } from '../../lib/logger';
import { trackIdentityKey } from '../../lib/preview/trackIdentity';
import { deleteCloudTrack, fetchCloudTracks, type CloudTrack } from '../../lib/queries/trackPreviews';
import { ControlButton, ToolbarIconButton, ToolbarIconGroup } from '../ui/controls';
import { RecordTrackListing } from '../ui/display/RecordTrackListing';
import { Dialog, EmptyState, StatusLoader } from '../ui/feedback';
import { NoticeCard } from '../ui/feedback/NoticeCard';

export function CloudTrackDeleteDialog({ title, inline, deleting = false, error, onClose, onDelete }: {
  title: string;
  inline?: boolean;
  deleting?: boolean;
  error?: string | null;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <Dialog
      title="Delete Cloud copy?"
      destructive
      inline={inline}
      onClose={deleting ? undefined : onClose}
      actions={[
        { label: 'Cancel', variant: 'secondary', disabled: deleting, onClick: onClose },
        { label: deleting ? 'Deleting…' : 'Delete', variant: 'danger', disabled: deleting, onClick: onDelete },
      ]}
    >
      <p>The synced copy of <strong>{title}</strong> will be removed from DropDex Cloud. Your original audio file and library record will stay in place.</p>
      {error && <div className="mt-3"><NoticeCard tone="error">{error}</NoticeCard></div>}
    </Dialog>
  );
}

const NO_TRACKS: CloudTrack[] = [];

export function CloudTracksGroup({ userId, syncing, onBack }: {
  userId: string;
  syncing: boolean;
  onBack: () => void;
}) {
  const player = useAudioPlayer();
  const [tracks, setTracks] = useState<CloudTrack[]>(NO_TRACKS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [target, setTarget] = useState<CloudTrack | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const playable = useMemo(() => tracks.filter(({ cloudPreview }) => cloudPreview.status === 'ready'), [tracks]);
  useAudioDockTracks(playable);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    void fetchCloudTracks(userId, controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      setTracks(items);
      setLoading(false);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      logger.error('preview.list.failed', { message: error instanceof Error ? error.message : String(error) });
      setLoadError(true);
      setLoading(false);
    });
    return () => controller.abort();
  }, [userId, syncing, revision]);

  const remove = async () => {
    if (!target || deletingRef.current || syncing) return;
    const copy = target.cloudPreview;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);

    const active = player.activeTrack;
    if (active && (active.cloudPreview?.id === copy.id || (player.source === 'cloud' && trackIdentityKey(active) === copy.identityKey))) player.stop();

    try {
      await deleteCloudTrack(copy);
      setTracks((items) => items.filter((item) => item.cloudPreview.id !== copy.id));
      setTarget(null);
    } catch (error) {
      logger.error('preview.delete.failed', { previewId: copy.id, message: error instanceof Error ? error.message : String(error) });
      setDeleteError('Could not finish removing this Cloud copy. Try again.');
      setRevision((current) => current + 1);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  return (
    <section className="profile-cloud-tracks" aria-labelledby="profile-cloud-tracks-title">
      <div className="flex items-center gap-2">
        <ToolbarIconButton label="Back to Streaming" onClick={onBack} autoFocus><ArrowLeft width={16} height={16} aria-hidden="true" /></ToolbarIconButton>
        <h2 id="profile-cloud-tracks-title" className="profile-heading">Cloud tracks</h2>
      </div>
      {loading && <div className="flex justify-center py-8"><StatusLoader label="Loading Cloud tracks" /></div>}
      {loadError && (
        <NoticeCard tone="error" action={<ControlButton variant="secondary" onClick={() => setRevision((current) => current + 1)}>Retry</ControlButton>}>
          Could not load your Cloud tracks.
        </NoticeCard>
      )}
      {player.activeTrack?.cloudPreview?.userId === userId && player.status === 'error' && (
        <NoticeCard tone="error">{player.error}</NoticeCard>
      )}
      {!loading && !loadError && tracks.length === 0 && (
        <EmptyState title="No synced tracks" message="Tracks you sync will appear here." />
      )}
      {tracks.length > 0 && (
        <RecordTrackListing
          ariaLabel="Tracks in DropDex Cloud"
          tracks={tracks}
          importId={tracks.find((track) => track.import_id)?.import_id || null}
          renderLeading={() => null}
          selectedId={player.activeTrack?.cloudPreview ? player.activeTrack.id : null}
          followPlayback
          scrollStyle={{ maxHeight: '26rem' }}
          rowKey={(track) => track.cloudPreview.id}
          actions={(track) => (
            <ToolbarIconGroup className="justify-center">
              <ToolbarIconButton
                label={'Listen to ' + track.title}
                disabled={track.cloudPreview.status !== 'ready'}
                onClick={() => void player.playTrack(track)}
              >
                <Play width={16} height={16} aria-hidden="true" />
              </ToolbarIconButton>
              <ToolbarIconButton
                label={'Delete Cloud copy of ' + track.title}
                title={syncing ? 'Wait for Cloud sync to finish before deleting' : undefined}
                disabled={syncing}
                onClick={() => { setDeleteError(null); setTarget(track); }}
              >
                <Trash width={16} height={16} aria-hidden="true" />
              </ToolbarIconButton>
            </ToolbarIconGroup>
          )}
        />
      )}
      {target && (
        <CloudTrackDeleteDialog title={target.title} deleting={deleting} error={deleteError} onClose={() => setTarget(null)} onDelete={() => void remove()} />
      )}
    </section>
  );
}
