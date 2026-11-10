import { useState } from 'react';
import { User } from 'iconoir-react/regular';
import { cn } from '../../lib/utils';

/** A round artist photo with a hairline ring, or their initials when there is no photo. */
export function DiscoveryAvatar({ name, imageUrl, size = 'md', className }: {
  name: string;
  imageUrl: string | null;
  size?: 'md' | 'xl';
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const avatarClass = cn('studio-avatar', size === 'xl' && 'studio-avatar--xl', className);
  if (imageUrl && imageUrl !== failedUrl) {
    return <img src={imageUrl} alt="" loading="lazy" onError={() => setFailedUrl(imageUrl)} className={avatarClass} />;
  }
  const initials = name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('');
  return <span className={avatarClass} aria-hidden="true">{initials || <User width={size === 'xl' ? 24 : 16} height={size === 'xl' ? 24 : 16} aria-hidden="true" />}</span>;
}
