import { ChevronRight } from '@carbon/icons-react';
import { cn } from '../../lib/utils';

interface GenreTileProps {
  name: string;
  artistCount: number;
  /** A genre the user saved as a favorite. */
  favorite?: boolean;
  onOpen: () => void;
}

/** A genre as a tile: how many artists it has, its name, and an arrow. Opens that genre's artists. */
export function GenreTile({ name, artistCount, favorite = false, onOpen }: GenreTileProps) {
  return (
    <button type="button" className={cn('discovery-genre-tile', favorite && 'discovery-genre-tile--favorite')} onClick={onOpen} aria-label={`Open ${name}`} data-testid="genre-tile">
      <span className="discovery-genre-tile-count"><span>{artistCount.toLocaleString()}</span><small>{artistCount === 1 ? 'Artist' : 'Artists'}</small></span>
      <span className="discovery-genre-tile-foot">
        <span className="discovery-genre-tile-name">{name}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </span>
    </button>
  );
}
