import { NavArrowRight } from 'iconoir-react/regular';
import { cn } from '../../lib/utils';
import { DiscoveryAvatar } from './DiscoveryAvatar';

interface ArtistCardProps {
  name: string;
  imageUrl: string | null;
  /** Genres, or "aka …" for a search match. */
  subtitle?: string | null;
  /** Number of sets, when known. */
  setCount?: number | null;
  onOpen: () => void;
  className?: string;
}

/** The portrait fills the card above its action footer. The whole card opens the artist. */
export function ArtistCard({ name, imageUrl, subtitle, setCount, onOpen, className }: ArtistCardProps) {
  return (
    <button type="button" className={cn('discovery-artist-card', className)} onClick={onOpen} aria-label={`Open ${name}`} data-testid="artist-card">
      <span className="discovery-artist-card-portrait">
        <DiscoveryAvatar name={name} imageUrl={imageUrl} size="xl" className="discovery-artist-card-photo" />
        <span className="discovery-artist-card-copy">
          {subtitle && <span className="discovery-artist-card-sub">{subtitle}</span>}
          <span className="discovery-artist-card-name">{name}</span>
        </span>
      </span>
      <span className="discovery-artist-card-foot">
        <span>View artist</span>
        <span className="discovery-artist-card-action">
          {setCount != null && <small>{setCount.toLocaleString()} {setCount === 1 ? 'set' : 'sets'}</small>}
          <NavArrowRight width={16} height={16} aria-hidden="true" />
        </span>
      </span>
    </button>
  );
}
