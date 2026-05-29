import { useState } from 'react';
import { Calendar, Music2 } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import type { DiscoverySetlistResult } from '../../types';

interface SetlistFeedCardProps {
  setlist: DiscoverySetlistResult;
  onOpen: (setlist: DiscoverySetlistResult) => void;
}

function ArtworkImage({ url, title }: { url: string; title: string }) {
  const [err, setErr] = useState(false);
  if (err) return <FallbackArtwork />;
  return (
    <img
      src={url}
      alt={title}
      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      onError={() => setErr(true)}
    />
  );
}

function FallbackArtwork() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-primary/5">
      <Music2 size={24} className="text-primary/20" />
    </div>
  );
}

export function SetlistFeedCard({ setlist, onOpen }: SetlistFeedCardProps) {
  const title = setlist.title ?? 'Untitled Set';
  const completionPct = setlist.completion_pct != null ? Math.round(setlist.completion_pct) : null;

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={() => onOpen(setlist)}
      className={cn(
        'group w-44 shrink-0 text-left rounded-2xl overflow-hidden border transition-all shadow-sm cursor-pointer',
        'border-[var(--color-border-subtle)] bg-[var(--color-surface)]',
        'hover:shadow-md hover:border-primary/30 hover:bg-[var(--color-surface-hover)]',
      )}
    >
      {/* Artwork */}
      <div className="relative aspect-video overflow-hidden bg-[var(--color-avatar-bg)]">
        {setlist.artwork_url ? (
          <ArtworkImage url={setlist.artwork_url} title={title} />
        ) : (
          <FallbackArtwork />
        )}

        {/* Date badge */}
        {setlist.set_date && (
          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 bg-background/80 backdrop-blur-sm px-1.5 py-0.5 rounded text-[9px] font-mono text-muted-foreground border border-[var(--color-border-subtle)]">
            <Calendar size={8} />
            {setlist.set_date}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-3 space-y-2">
        <p className="text-xs font-bold leading-snug line-clamp-2 group-hover:text-primary transition-colors">
          {title}
        </p>

        {/* Completion bar */}
        {completionPct != null && (
          <div className="space-y-1">
            <div className="h-1 bg-[var(--color-avatar-bg)] rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: `${Math.min(completionPct, 100)}%` }}
              />
            </div>
            <p className="text-[9px] font-mono text-muted-foreground">
              {setlist.ided_tracks ?? '?'}/{setlist.total_tracks ?? '?'} IDed ({completionPct}%)
            </p>
          </div>
        )}

        {/* Style chips */}
        {setlist.music_styles && setlist.music_styles.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {setlist.music_styles.slice(0, 2).map((style) => (
              <span
                key={style}
                className="px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest bg-primary/10 text-primary"
              >
                {style}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.button>
  );
}
