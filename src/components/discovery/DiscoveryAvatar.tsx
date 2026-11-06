import { useState } from 'react';
import { User } from '@carbon/icons-react';

/** A round artist photo with a hairline ring, or their initials when there is no photo. */
export function DiscoveryAvatar({ name, imageUrl, large = false }: { name: string; imageUrl: string | null; large?: boolean }) {
  const className = large ? 'studio-avatar studio-avatar--lg' : 'studio-avatar';
  const [failed, setFailed] = useState(false);
  if (imageUrl && !failed) {
    return <img src={imageUrl} alt="" onError={() => setFailed(true)} className={className} />;
  }
  const initials = name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('');
  return <span className={className} aria-hidden="true">{initials || <User size={16} />}</span>;
}
