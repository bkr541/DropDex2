import { useEffect, useState, type ReactNode } from 'react';
import { UserAvatar } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import '../dropdex-display.css';

export type AvatarSize = 'sm' | 'md' | 'lg';
export type AvatarRing = 'none' | 'blue' | 'spectrum';

export interface AvatarProps {
  src?: string | null;
  alt?: string;
  initials?: string;
  icon?: ReactNode;
  size?: AvatarSize;
  ring?: AvatarRing;
  className?: string;
}

export function Avatar({
  src,
  alt,
  initials,
  icon,
  size = 'md',
  ring = 'none',
  className,
}: AvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const canRenderImage = Boolean(src) && !failed;
  const fallbackLabel = alt || (initials ? `Avatar for ${initials}` : 'User avatar');

  return (
    <span
      className={cn('dd-avatar', `dd-avatar--${size}`, `dd-avatar--ring-${ring}`, className)}
      data-avatar-state={canRenderImage ? 'image' : initials ? 'initials' : 'icon'}
    >
      <span className="dd-avatar__inner">
        {canRenderImage ? (
          <img src={src ?? undefined} alt={alt ?? ''} onError={() => setFailed(true)} />
        ) : (
          <span className="dd-avatar__fallback" role="img" aria-label={fallbackLabel}>
            {initials
              ? <strong>{initials}</strong>
              : <span aria-hidden="true">{icon ?? <UserAvatar />}</span>}
          </span>
        )}
      </span>
    </span>
  );
}
