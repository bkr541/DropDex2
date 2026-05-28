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
  const completionPct = setlist.completion_pct != null ? Math.round(setlist.completion_pct) : null;

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

        {/* Source badge */}
        <div className="absolute bottom-2.5 left-2.5 bg-background/80 backdrop-blur-sm px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest text-muted-foreground border border-[var(--color-border-subtle)]">
          1001TL
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 p-4 gap-3">
        {/* Title + creator */}
        <div>
          <h3 className="font-bold text-sm leading-snug line-clamp-2">{title}</h3>
          {setlist.creator_username && (
            <p className="text-[10px] text-muted-foreground mt-0.5 font-mono uppercase tracking-tighter truncate">
              {setlist.creator_username}
            </p>
          )}
        </div>

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

        {/* Completion bar */}
        {(setlist.ided_tracks != null || setlist.total_tracks != null) && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-[var(--color-avatar-bg)] rounded-full overflow-hidden">
              {completionPct != null && (
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.min(completionPct, 100)}%` }}
                />
              )}
            </div>
            <span className="text-[10px] font-mono text-muted-foreground shrink-0">
              {setlist.ided_tracks ?? '?'}/{setlist.total_tracks ?? '?'} IDed
              {completionPct != null ? ` (${completionPct}%)` : ''}
            </span>
          </div>
        )}

        {/* Style chips */}
        {setlist.music_styles && setlist.music_styles.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {setlist.music_styles.slice(0, 3).map((style) => (
              <span
                key={style}
                className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest bg-primary/10 text-primary"
              >
                {style}
              </span>
            ))}
            {setlist.music_styles.length > 3 && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-muted-foreground">
                +{setlist.music_styles.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Views + likes */}
        {(setlist.views != null || setlist.likes != null) && (
          <div className="flex gap-3">
            {setlist.views != null && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Eye size={10} />
                {setlist.views.toLocaleString()}
              </span>
            )}
            {setlist.likes != null && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Heart size={10} />
                {setlist.likes.toLocaleString()}
              </span>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center gap-2 mt-auto pt-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen(setlist);
            }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all active:scale-95 bg-primary/10 text-primary hover:bg-primary/20"
          >
            View Tracks
            <ChevronRight size={12} />
          </button>
          {setlist.source_url && (
            <a
              href={setlist.source_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-2 rounded-xl bg-[var(--color-avatar-bg)] text-muted-foreground hover:text-foreground transition-colors"
              title="View on 1001Tracklists"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}
