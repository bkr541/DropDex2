import { useState } from 'react';
import { User } from '@carbon/icons-react';

/** A round artist photo with a hairline ring, or their initials when there is no photo. */
export function DiscoveryAvatar({ name, imageUrl, size = 'md' }: { name: string; imageUrl: string | null; size?: 'md' | 'xl' }) {
  const [failed, setFailed] = useState(false);
  const className = size === 'xl' ? 'studio-avatar studio-avatar--xl' : 'studio-avatar';
  if (imageUrl && !failed) {
    return <img src={imageUrl} alt="" onError={() => setFailed(true)} className={className} />;
  }
  const initials = name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('');
  return <span className={className} aria-hidden="true">{initials || <User size={size === 'xl' ? 24 : 16} />}</span>;
}
