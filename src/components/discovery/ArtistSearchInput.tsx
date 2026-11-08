import { Refresh, Xmark } from 'iconoir-react/regular';
import { ControlButton, SearchControl } from '../ui/controls';

interface ArtistSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  loading: boolean;
  placeholder?: string;
}

/** The search field in the Discovery header band. */
export function ArtistSearchInput({
  value,
  onChange,
  onClear,
  loading,
  placeholder = 'Search DropDex artists…',
}: ArtistSearchInputProps) {
  return (
    // mx-[3px] my-[3px]: gives the focus ring (outset box-shadow) room to render
    // without being clipped by any ancestor overflow boundary.
    <div className="discovery-search relative mx-[3px] my-[3px]" data-testid="discovery-search">
      <SearchControl
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pr-11"
        icon={loading ? <Refresh className="animate-spin text-control-primary" width={16} height={16} aria-hidden="true" /> : undefined}
      />
      {value && (
        <ControlButton variant="ghost" onClick={onClear} aria-label="Clear search" className="absolute right-4 top-1/2 -translate-y-1/2">
          <Xmark width={16} height={16} aria-hidden="true" />
        </ControlButton>
      )}
    </div>
  );
}
