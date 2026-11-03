import type { ElementType, HTMLAttributes, ReactNode, TableHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-display.css';
import { Artwork } from './Artwork';

export type TrackTableStatus = 'ready' | 'warning' | 'error' | 'none';

const STATUS_DOT: Record<TrackTableStatus, string> = {
  ready: 'bg-emerald-400',
  warning: 'bg-amber-400',
  error: 'bg-red-400',
  none: 'bg-muted-foreground/40',
};

/** The Cue Points track table. Rows, header cells and the name cell below are its parts. */
export function TrackTable({ className, children, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cn('cue-browser__table w-full border-collapse text-left', className)} {...props}>
      {children}
    </table>
  );
}

export function TrackTableBody({ children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className="divide-y divide-[var(--color-border-faint)]" {...props}>{children}</tbody>;
}

export function TrackTableHead({ children, large = false }: { children: ReactNode; /** 12px headings instead of 9px. */ large?: boolean }) {
  return (
    <thead className={cn('font-bold uppercase tracking-widest text-muted-foreground', large ? 'text-xs' : 'text-[9px]')}>
      <tr className="border-b border-[var(--color-border-faint)]">{children}</tr>
    </thead>
  );
}

export interface TrackTableSort<K extends string = string> {
  column: K;
  direction: 'asc' | 'desc';
}

export function TrackTableHeadCell<K extends string>({
  label, column, sort, onSort, sticky = true, icon: Icon, iconSize = 14, className, ...props
}: Omit<ThHTMLAttributes<HTMLTableCellElement>, 'onClick'> & {
  /** Shown to the left of the heading text. */
  icon?: ElementType;
  iconSize?: number;
  /** Keep the header visible while the list scrolls. */
  sticky?: boolean;
  label: ReactNode;
  /** Sort key. Leave out for a column that cannot be sorted. */
  column?: K;
  sort?: TrackTableSort<K> | null;
  onSort?: (column: K) => void;
}) {
  const active = column !== undefined && sort?.column === column;
  return (
    <th
      aria-sort={active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn('select-none bg-[var(--color-background)] px-3 py-2', sticky && 'sticky top-0 z-10', !(column !== undefined && onSort) && 'normal-case tracking-normal', className)}
      {...props}
    >
      {(() => {
        const content = Icon
          ? (<span className="inline-flex items-center gap-1.5"><Icon size={iconSize} className="shrink-0" aria-hidden="true" />{label}</span>)
          : label;
        return column !== undefined && onSort ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
            aria-label={`Sort by ${typeof label === 'string' ? label : column}`}
            onClick={() => onSort(column)}
          >
            {content}
            <span className={cn('text-primary', !active && 'invisible')} aria-hidden="true">{sort?.direction === 'desc' ? '↓' : '↑'}</span>
          </button>
        ) : content;
      })()}
    </th>
  );
}

export function TrackTableRow({
  selected, className, children, ...props
}: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      tabIndex={0}
      aria-selected={selected}
      className={cn(
        'cue-browser__row cursor-pointer outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50',
        selected ? 'cue-browser__row--selected' : 'hover:bg-[var(--color-surface-hover)]',
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

/**
 * The first cell of a track row: status dot, selection bar, artwork, title and
 * artist, then anything passed as children (usually the mini waveform).
 */
export function TrackNameCell({
  title, artist, artworkSrc, selected, status = 'none', nameClassName, dense = false, children,
}: {
  title: string;
  artist: string | null | undefined;
  artworkSrc?: string | null;
  selected?: boolean;
  status?: TrackTableStatus;
  /** Width of the text column. The Cue Points table fixes it so waveforms line up. */
  nameClassName?: string;
  /** Closer together: less space between the status dot and the artwork, a 12px title, and artwork as tall as the title and artist lines together (30px). */
  dense?: boolean;
  children?: ReactNode;
}) {
  return (
    <td className="px-3 py-1.5">
      <div className={cn('group flex min-w-0 items-center', dense ? 'gap-1.5' : 'gap-2.5')}>
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[status])} aria-hidden="true" />
        <span className={cn('h-8 w-0.5 shrink-0 rounded-full', selected ? 'bg-primary' : 'bg-transparent')} aria-hidden="true" />
        <Artwork src={artworkSrc} alt={`Artwork for ${title}`} fallbackTitle="No artwork" className={cn('shrink-0 rounded-[6px]', dense ? 'h-[30px] w-[30px]' : 'h-9 w-9')} />
        <div className={cn('min-w-0', nameClassName ?? 'w-[346px] shrink-0')}>
          <p className={cn('truncate font-bold', dense ? 'text-xs' : 'text-sm', 'leading-tight', selected && 'text-primary')}>{title}</p>
          <p className="truncate text-[10px] text-muted-foreground">{artist ?? 'Artist Not Available'}</p>
        </div>
        {children}
      </div>
    </td>
  );
}
