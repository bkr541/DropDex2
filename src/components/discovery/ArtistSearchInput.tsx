import { CircleDash, Close } from '@carbon/icons-react';
import { ControlButton, SearchControl } from '../ui/controls';

interface ArtistSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  loading: boolean;
  placeholder?: string;
}

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
    <div className="relative mx-[3px] my-[3px]">
      <SearchControl
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pr-11"
        icon={loading ? <CircleDash className="animate-spin text-primary" size={16} aria-hidden="true" /> : undefined}
      />
      {value && (
        <ControlButton variant="ghost" onClick={onClear} aria-label="Clear search" className="absolute right-4 top-1/2 -translate-y-1/2">
          <Close size={16} />
        </ControlButton>
      )}
    </div>
  );
}
