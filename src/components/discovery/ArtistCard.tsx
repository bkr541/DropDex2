import { NavArrowRight } from 'iconoir-react/regular';
import { cn } from '../../lib/utils';
import { DiscoveryAvatar } from './DiscoveryAvatar';

interface ArtistCardProps {
  name: string;
  imageUrl: string | null;
  /** Genres, or "aka …" for a search match. */
  subtitle?: string | null;
  /** Number of sets; leave out where it is not known and the card shows "View artist" instead. */
  setCount?: number | null;
  onOpen: () => void;
  className?: string;
}

/**
 * An artist: a large photo, their name over a supporting line, and along the bottom how many sets they
 * have (or "View artist") with an arrow. The whole card opens the artist.
 */
export function ArtistCard({ name, imageUrl, subtitle, setCount, onOpen, className }: ArtistCardProps) {
  return (
    <button type="button" className={cn('discovery-artist-card', className)} onClick={onOpen} aria-label={`Open ${name}`} data-testid="artist-card">
      <DiscoveryAvatar name={name} imageUrl={imageUrl} size="xl" />
      <span className="discovery-artist-card-copy">
        <span className="discovery-artist-card-name">{name}</span>
        {subtitle ? <span className="discovery-artist-card-sub">{subtitle}</span> : null}
      </span>
      <span className="discovery-artist-card-foot">
        {setCount != null ? (
          <span className="discovery-artist-card-stat"><span>{setCount.toLocaleString()}</span><small>{setCount === 1 ? 'Set' : 'Sets'}</small></span>
        ) : (
          <small>View artist</small>
        )}
        <NavArrowRight width={16} height={16} aria-hidden="true" />
      </span>
    </button>
  );
}
