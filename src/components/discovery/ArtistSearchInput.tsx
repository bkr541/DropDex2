import { Search, X, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

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
    <div className="relative">
      {loading ? (
        <Loader2
          className="absolute left-4 top-1/2 -translate-y-1/2 text-primary animate-spin"
          size={18}
        />
      ) : (
        <Search
          className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
          size={18}
        />
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-2xl',
          'py-4 pl-12 pr-12 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all',
          'font-medium text-foreground placeholder:text-muted-foreground',
        )}
      />
      {value && (
        <button
          onClick={onClear}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Clear search"
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}
