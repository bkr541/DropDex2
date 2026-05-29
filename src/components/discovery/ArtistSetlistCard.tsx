import { useState } from 'react';
import { motion } from 'motion/react';
import {
  Calendar,
  Clock,
  Music2,
  Eye,
  Heart,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { DiscoverySetlistResult } from '../../types';

interface ArtistSetlistCardProps {
  setlist: DiscoverySetlistResult;
  onOpen: (setlist: DiscoverySetlistResult) => void;
}

function ArtworkImage({ url, title }: { url: string; title: string }) {
  const [err, setErr] = useState(false);
  if (!err) {
    return (
      <img
        src={url}
        alt={title}
        className="w-full h-full object-cover"
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center">
      <Music2 size={36} className="text-primary/20" />
    </div>
  );
}

export function ArtistSetlistCard({ setlist, onOpen }: ArtistSetlistCardProps) {
  const title = setlist.title ?? 'Untitled Set';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onOpen(setlist)}
      className={cn(
        'flex flex-col rounded-2xl overflow-hidden border transition-all shadow-sm cursor-pointer',
        'border-[var(--color-border-subtle)] bg-[var(--color-surface)]',
        'hover:shadow-md hover:border-primary/30 hover:bg-[var(--color-surface-hover)]',
      )}
    >
      {/* Artwork */}
      <div className="relative aspect-[4/3] w-full bg-[var(--color-avatar-bg)] overflow-hidden">
        {setlist.artwork_url ? (
          <ArtworkImage url={setlist.artwork_url} title={title} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music2 size={36} className="text-primary/20" />
          </div>
        )}

        {/* Top-left: Views + Likes */}
        {(setlist.views != null || setlist.likes != null) && (
          <div className="absolute top-2 left-2 flex gap-1.5">
            {setlist.views != null && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-background/80 backdrop-blur-sm text-[9px] font-bold text-muted-foreground border border-[var(--color-border-subtle)]">
                <Eye size={9} />
                {setlist.views.toLocaleString()}
              </span>
            )}
            {setlist.likes != null && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-background/80 backdrop-blur-sm text-[9px] font-bold text-muted-foreground border border-[var(--color-border-subtle)]">
                <Heart size={9} />
                {setlist.likes.toLocaleString()}
              </span>
            )}
          </div>
        )}

        {/* Top-right: Share button */}
        {setlist.source_url && (
          <a
            href={setlist.source_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-background/80 backdrop-blur-sm text-muted-foreground hover:text-foreground transition-colors border border-[var(--color-border-subtle)]"
            title="View on 1001Tracklists"
          >
            <ExternalLink size={12} />
          </a>
        )}

        {/* Bottom: Genre/style chips */}
        {setlist.music_styles && setlist.music_styles.length > 0 && (
          <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1">
            {setlist.music_styles.slice(0, 3).map((style) => (
              <span
                key={style}
                className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest bg-background/80 backdrop-blur-sm text-primary border border-primary/20"
              >
                {style}
              </span>
            ))}
            {setlist.music_styles.length > 3 && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-background/80 backdrop-blur-sm text-muted-foreground">
                +{setlist.music_styles.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 p-4 gap-3">
        {/* Title */}
        <h3 className="font-bold text-sm leading-snug line-clamp-2">{title}</h3>

        {/* Date + duration */}
        {(setlist.set_date || setlist.duration_text) && (
          <div className="flex flex-wrap gap-3">
            {setlist.set_date && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Calendar size={10} />
                {setlist.set_date}
              </span>
            )}
            {setlist.duration_text && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock size={10} />
                {setlist.duration_text}
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-auto pt-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen(setlist);
            }}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all active:scale-95 bg-primary/10 text-primary hover:bg-primary/20"
          >
            View Tracks
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
