import { motion } from 'motion/react';
import {
  Calendar,
  Clock,
  Music2,
  Eye,
  Heart,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { DiscoverySetlistResult } from '../../types';

interface ArtistSetlistCardProps {
  setlist: DiscoverySetlistResult;
  isSelected: boolean;
  onSelect: (setlist: DiscoverySetlistResult) => void;
}

export function ArtistSetlistCard({ setlist, isSelected, onSelect }: ArtistSetlistCardProps) {
  const title = setlist.title ?? 'Untitled Set';
  const completionPct = setlist.completion_pct != null ? Math.round(setlist.completion_pct) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex flex-col rounded-2xl overflow-hidden border transition-all',
        isSelected
          ? 'border-primary/60 shadow-[0_4px_20px_rgba(207,107,101,0.2)] bg-[var(--color-surface-hover)]'
          : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] hover:border-primary/20',
      )}
    >
      {/* Artwork */}
      <div className="relative aspect-video w-full bg-[var(--color-avatar-bg)] overflow-hidden">
        {setlist.artwork_url ? (
          <img src={setlist.artwork_url} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music2 size={32} className="text-primary/20" />
          </div>
        )}
        {isSelected && (
          <div className="absolute top-2 right-2 bg-primary rounded-full p-0.5">
            <CheckCircle2 size={14} className="text-white" />
          </div>
        )}
        <div className="absolute bottom-2 left-2 bg-background/80 backdrop-blur-sm px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest text-muted-foreground border border-[var(--color-border-subtle)]">
          1001TL
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 p-4 gap-3">
        <div>
          <h3 className="font-bold text-sm leading-snug line-clamp-2">{title}</h3>
          {setlist.creator_username && (
            <p className="text-[10px] text-muted-foreground mt-0.5 font-mono uppercase tracking-tighter truncate">
              {setlist.creator_username}
            </p>
          )}
        </div>

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

        {(setlist.ided_tracks != null || setlist.total_tracks != null) && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-[var(--color-avatar-bg)] rounded-full overflow-hidden">
              {completionPct != null && (
                <div
                  className="h-full bg-primary rounded-full"
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
            onClick={() => onSelect(setlist)}
            className={cn(
              'flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all active:scale-95',
              isSelected
                ? 'bg-primary text-white'
                : 'bg-primary/10 text-primary hover:bg-primary/20',
            )}
          >
            {isSelected ? 'Selected' : 'Select Set'}
          </button>
          {setlist.source_url && (
            <a
              href={setlist.source_url}
              target="_blank"
              rel="noopener noreferrer"
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
