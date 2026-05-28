import { useState, useRef, type ChangeEvent } from 'react';
import { Loader2, Upload, RefreshCw, Check, FolderOpen, ListMusic } from 'lucide-react';
import { cn, formatPlaylistDuration, getDeterministicBars } from '../../lib/utils';
import { uploadPlaylistArtwork } from '../../lib/queries/storage';
import { upsertPlaylistProfile, buildPlaylistIdentityKey } from '../../lib/queries/userPlaylists';
import type { RekordboxImport, UserPlaylistProfile } from '../../types';
import type { PlaylistWithCount } from '../../lib/queries/rekordbox';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

function PlaylistFallbackArt({ isFolder, seed }: { isFolder: boolean; seed: string }) {
  const bars = getDeterministicBars(seed, 28);
  return (
    <div
      className={cn(
        'w-full h-full flex items-center justify-center relative overflow-hidden',
        isFolder
          ? 'bg-gradient-to-br from-primary/20 to-primary/5'
          : 'bg-gradient-to-br from-secondary/20 to-secondary/5',
      )}
    >
      <div className="absolute bottom-0 left-0 right-0 h-1/2 px-3 pb-3 opacity-25">
        <div className="flex items-end gap-[1.5px] h-full w-full">
          {bars.map((h, i) => (
            <div
              key={i}
              className={cn('flex-1 rounded-full', isFolder ? 'bg-primary' : 'bg-secondary')}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>
      <div
        className={cn(
          'relative z-10 w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm',
          isFolder ? 'bg-primary/25 text-primary' : 'bg-secondary/25 text-secondary',
        )}
      >
        {isFolder ? <FolderOpen size={26} /> : <ListMusic size={26} />}
      </div>
    </div>
  );
}

export interface PlaylistEditViewProps {
  playlist: PlaylistWithCount;
  latestImport: RekordboxImport;
  userId: string;
  existingProfile: UserPlaylistProfile | null;
  avgBpm?: string | null;
  totalDuration?: number | null;
  topKey?: string | null;
  onImport: () => void;
  onSaved: (saved: UserPlaylistProfile) => void;
}

export function PlaylistEditView({
  playlist,
  latestImport,
  userId,
  existingProfile,
  avgBpm,
  totalDuration,
  topKey,
  onImport,
  onSaved,
}: PlaylistEditViewProps) {
  const identityKey = buildPlaylistIdentityKey(
    latestImport.device_name ?? '',
    playlist.rekordbox_playlist_id,
  );

  const [displayName, setDisplayName] = useState(existingProfile?.display_name ?? '');
  const [description, setDescription] = useState(existingProfile?.description ?? '');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayedArtwork = previewUrl ?? existingProfile?.artwork_url ?? null;

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSaveError(null);
    setImgError(false);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setSaveError('Please select a JPEG, PNG, WebP, or GIF image.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setSaveError('Image must be smaller than 10 MB.');
      return;
    }
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updates: Partial<Pick<UserPlaylistProfile, 'display_name' | 'description' | 'artwork_url'>> = {
        display_name: displayName.trim() || null,
        description: description.trim() || null,
      };

      if (pendingFile) {
        const url = await uploadPlaylistArtwork(userId, identityKey, pendingFile);
        updates.artwork_url = url;
      }

      const result = await upsertPlaylistProfile(userId, identityKey, updates);
      setSaved(true);
      setPendingFile(null);
      onSaved(result);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 md:max-w-4xl md:mx-auto pb-8">

      {/* ── Rescan Device — prominent ── */}
      <div className="glass rounded-3xl p-5 border border-[var(--color-border-subtle)] bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <RefreshCw size={15} className="text-primary shrink-0" />
              <h3 className="font-black text-sm">Rescan Device</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Import your latest Rekordbox export to update tracks and playlists. Your custom
              artwork, display names, and descriptions are stored separately and survive every
              rescan automatically.
            </p>
          </div>
          <button
            onClick={onImport}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-primary/90 transition-all active:scale-95 shrink-0 shadow-sm"
          >
            <RefreshCw size={13} />
            Rescan Device
          </button>
        </div>
      </div>

      {/* ── Artwork + Stats ── */}
      <div className="flex flex-col md:flex-row gap-6 items-start">

        {/* Artwork column */}
        <div className="w-full md:w-52 xl:w-60 shrink-0 space-y-3">
          <div className="aspect-square rounded-2xl overflow-hidden border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {displayedArtwork && !imgError ? (
              <img
                src={displayedArtwork}
                alt={playlist.name}
                className="w-full h-full object-cover"
                onError={() => setImgError(true)}
              />
            ) : (
              <PlaylistFallbackArt isFolder={playlist.is_folder} seed={playlist.id} />
            )}
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-[var(--color-border-subtle)] hover:border-primary/40 text-muted-foreground hover:text-primary text-xs font-bold uppercase tracking-widest transition-all"
          >
            <Upload size={13} />
            {pendingFile
              ? 'Change Artwork'
              : existingProfile?.artwork_url
              ? 'Replace Artwork'
              : 'Upload Artwork'}
          </button>

          {pendingFile && (
            <p className="text-[10px] text-muted-foreground text-center truncate px-1">
              {pendingFile.name}
            </p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* Stats + form column */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* Metadata stats */}
          <div className="glass rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Tracks', value: String(playlist.track_count), accent: false },
              { label: 'Avg BPM', value: avgBpm ?? '—', accent: false },
              { label: 'Runtime', value: totalDuration ? formatPlaylistDuration(totalDuration) : '—', accent: false },
              { label: 'Top Key', value: topKey ?? '—', accent: !!topKey },
            ].map(({ label, value, accent }) => (
              <div key={label}>
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mb-0.5">
                  {label}
                </p>
                <p className={cn('font-black text-sm font-mono', accent && 'text-secondary')}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* Device + import info */}
          <p className="text-[10px] text-muted-foreground font-mono px-0.5">
            {latestImport.device_name ? `Device: ${latestImport.device_name} · ` : ''}
            Imported {new Date(latestImport.imported_at).toLocaleDateString()}
          </p>

          {/* Custom display name */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Custom Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => { setDisplayName(e.target.value); setSaved(false); }}
              placeholder={playlist.name}
              maxLength={120}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/50"
            />
            <p className="text-[10px] text-muted-foreground">
              Leave blank to use the original Rekordbox name.
            </p>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => { setDescription(e.target.value); setSaved(false); }}
              placeholder="What's this playlist for? Notes, vibes, occasion…"
              rows={3}
              maxLength={500}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/50 resize-none"
            />
          </div>

          {/* Error */}
          {saveError && (
            <p className="text-xs text-red-400 font-medium px-0.5">{saveError}</p>
          )}

          {/* Save action */}
          <button
            onClick={handleSave}
            disabled={saving}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all active:scale-95',
              saved
                ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                : 'bg-primary text-white hover:bg-primary/90 shadow-sm',
              saving && 'opacity-60 cursor-not-allowed',
            )}
          >
            {saving ? (
              <><Loader2 size={13} className="animate-spin" /> Saving…</>
            ) : saved ? (
              <><Check size={13} /> Saved</>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
