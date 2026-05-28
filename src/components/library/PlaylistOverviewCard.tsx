import { useState } from 'react';
import { motion } from 'motion/react';
import { FolderOpen, ListMusic, Pencil } from 'lucide-react';
import { cn, getDeterministicBars } from '../../lib/utils';
import type { PlaylistWithCount } from '../../lib/queries/rekordbox';

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
      {/* Deterministic waveform background */}
      <div className="absolute bottom-0 left-0 right-0 h-1/2 px-2 pb-2 opacity-25">
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
          'relative z-10 w-11 h-11 rounded-xl flex items-center justify-center shadow-sm',
          isFolder ? 'bg-primary/25 text-primary' : 'bg-secondary/25 text-secondary',
        )}
      >
        {isFolder ? <FolderOpen size={20} /> : <ListMusic size={20} />}
      </div>
    </div>
  );
}

interface PlaylistOverviewCardProps {
  playlist: PlaylistWithCount;
  artworkUrl?: string | null;
  displayName?: string | null;
  onClick: () => void;
  onEdit?: () => void;
}

export function PlaylistOverviewCard({
  playlist,
  artworkUrl,
  displayName,
  onClick,
  onEdit,
}: PlaylistOverviewCardProps) {
  const [imgError, setImgError] = useState(false);
  const label = displayName || playlist.name;

  return (
    <div className="relative group">
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={onClick}
        className="text-left w-full rounded-2xl overflow-hidden border border-[var(--color-border-subtle)] hover:border-primary/25 hover:shadow-md transition-all bg-[var(--color-surface)]"
      >
        {/* Artwork or polished fallback */}
        <div className="relative aspect-video overflow-hidden">
          {artworkUrl && !imgError ? (
            <img
              src={artworkUrl}
              alt={label}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              onError={() => setImgError(true)}
            />
          ) : (
            <PlaylistFallbackArt isFolder={playlist.is_folder} seed={playlist.id} />
          )}
        </div>

        {/* Name + track count */}
        <div className="px-3 py-2.5 bg-[var(--color-surface)]">
          <h3 className="font-bold text-sm leading-snug line-clamp-1 group-hover:text-primary transition-colors">
            {label}
          </h3>
          <p className="text-[10px] text-muted-foreground font-mono uppercase mt-0.5">
            {playlist.track_count} tracks
          </p>
        </div>
      </motion.button>

      {/* Edit overlay — only shown for non-folder playlists */}
      {!playlist.is_folder && onEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="Edit playlist"
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-background/80 backdrop-blur-sm border border-[var(--color-border-subtle)] text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-all shadow-sm z-10"
        >
          <Pencil size={11} />
        </button>
      )}
    </div>
  );
}
