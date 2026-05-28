import { motion } from 'motion/react';
import { FolderOpen, TrendingUp } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { PlaylistWithCount } from '../../lib/queries/rekordbox';

interface PlaylistOverviewCardProps {
  playlist: PlaylistWithCount;
  onClick: () => void;
}

export function PlaylistOverviewCard({ playlist, onClick }: PlaylistOverviewCardProps) {
  const isFolder = playlist.is_folder;
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="text-left w-full glass p-4 rounded-2xl flex flex-col gap-3 border border-[var(--color-border-subtle)] hover:border-primary/20 hover:shadow-sm transition-all group"
    >
      <div
        className={cn(
          'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
          isFolder ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary',
        )}
      >
        {isFolder ? <FolderOpen size={16} /> : <TrendingUp size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-bold text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
          {playlist.name}
        </h3>
        <p className="text-[10px] text-muted-foreground font-mono uppercase mt-1">
          {playlist.track_count} tracks
        </p>
      </div>
    </motion.button>
  );
}
