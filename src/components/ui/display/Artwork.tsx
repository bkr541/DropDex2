import { useEffect, useState, type ReactNode } from 'react';
import { MusicAdd } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import '../dropdex-display.css';

export type ArtworkAspect = 'square' | 'video' | 'portrait';
export type ArtworkFit = 'cover' | 'contain';

export interface ArtworkProps {
  src?: string | null;
  alt: string;
  aspect?: ArtworkAspect;
  fit?: ArtworkFit;
  fallbackTitle?: string;
  fallbackDescription?: string;
  fallbackIcon?: ReactNode;
  overlay?: ReactNode;
  className?: string;
  imageClassName?: string;
}

export function Artwork({
  src,
  alt,
  aspect = 'square',
  fit = 'cover',
  fallbackTitle,
  fallbackDescription,
  fallbackIcon,
  overlay,
  className,
  imageClassName,
}: ArtworkProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const canRenderImage = Boolean(src) && !failed;

  return (
    <div
      className={cn('dd-artwork', `dd-artwork--${aspect}`, className)}
      data-artwork-state={canRenderImage ? 'image' : 'fallback'}
    >
      {canRenderImage ? (
        <img
          src={src ?? undefined}
          alt={alt}
          className={cn('dd-artwork__image', `dd-artwork__image--${fit}`, imageClassName)}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="dd-artwork__fallback" role="img" aria-label={alt}>
          <span className="dd-artwork__fallback-icon" aria-hidden="true">
            {fallbackIcon ?? <MusicAdd size={30} />}
          </span>
          {fallbackTitle && <strong>{fallbackTitle}</strong>}
          {fallbackDescription && <small>{fallbackDescription}</small>}
        </div>
      )}
      {overlay != null && <div className="dd-artwork__overlay">{overlay}</div>}
    </div>
  );
}
