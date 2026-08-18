import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-display.css';
import { SurfaceCard } from './SurfaceCard';

export interface PlaylistCardItem {
  id: string | number;
  title: string;
  artist?: string;
  meta?: ReactNode;
}

export interface PlaylistCardProps {
  title: string;
  subtitle?: string;
  metadata?: ReactNode;
  artwork?: ReactNode;
  items: PlaylistCardItem[];
  actionLabel: string;
  onAction: () => void;
  className?: string;
}

export function PlaylistCard({
  title,
  subtitle,
  metadata,
  artwork,
  items,
  actionLabel,
  onAction,
  className,
}: PlaylistCardProps) {
  return (
    <SurfaceCard className={cn('dd-playlist-card', className)}>
      <div className="dd-playlist-card__body">
        <div className={cn('dd-playlist-card__heading', artwork && 'dd-playlist-card__heading--with-artwork')}>
          {artwork != null && <div className="dd-playlist-card__artwork">{artwork}</div>}
          <div className="dd-playlist-card__title-wrap">
            <strong className="dd-playlist-card__title" title={title}>{title}</strong>
            {subtitle && <span className="dd-playlist-card__subtitle" title={subtitle}>{subtitle}</span>}
          </div>
          {metadata != null && <div className="dd-playlist-card__metadata">{metadata}</div>}
        </div>
        <div className="dd-playlist-card__items">
          {items.map((item, index) => (
            <div className="dd-playlist-card__item" key={item.id}>
              <span className="dd-playlist-card__index">{index + 1}</span>
              <span className="dd-playlist-card__copy">
                <strong title={item.title}>{item.title}</strong>
                {item.artist && <small title={item.artist}>{item.artist}</small>}
              </span>
              {item.meta != null && <span className="dd-playlist-card__item-meta">{item.meta}</span>}
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="dd-playlist-card__action"
        onClick={onAction}
        aria-label={actionLabel}
      >
        <span>{actionLabel}</span>
        <span aria-hidden="true">›</span>
      </button>
    </SurfaceCard>
  );
}
