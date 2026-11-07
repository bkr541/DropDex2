import type { HTMLAttributes, ReactNode, TdHTMLAttributes } from 'react';
import { OverflowMenuHorizontal } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import { TrackNameCell, TrackTable, TrackTableBody, TrackTableHead, TrackTableHeadCell, TrackTableRow, type TrackTableSort, type TrackTableStatus } from './TrackTable';
import './track-listing.css';

export interface TrackListingColumn<T> {
  id: string;
  label: ReactNode;
  /** Makes the heading a sort button, and is passed to `onSort`. */
  sort?: string;
  headClassName?: string;
  cellClassName?: string;
  /** What goes inside the cell. */
  render: (track: T) => ReactNode;
  cellProps?: (track: T) => TdHTMLAttributes<HTMLTableCellElement> & { 'data-testid'?: string };
}

export interface TrackListingProps<T extends { id: string }> {
  tracks: readonly T[];
  /** The columns after Track. An Actions column is added at the far right unless `actions` is false. */
  columns: readonly TrackListingColumn<T>[];
  selectedId?: string | null;
  onSelect?: (track: T) => void;
  getTitle: (track: T) => string;
  getArtist: (track: T) => string | null | undefined;
  /** The green dot: ready, warning, error or none. */
  getStatus: (track: T) => TrackTableStatus;
  /** Before the title, e.g. the play button. */
  renderLeading?: (track: T, selected: boolean) => ReactNode;
  /** After the title and artist, e.g. the waveform preview. */
  renderWaveform?: (track: T) => ReactNode;
  nameClassName?: string;
  /** The far-right Actions column. Its three dots do nothing yet. Pass a function to put something else there. */
  actions?: boolean | ((track: T) => ReactNode);
  sort?: TrackTableSort | null;
  onSort?: (key: string) => void;
  /** The sort key of the Track column. */
  trackSort?: string;
  /** The heading of the first column. */
  trackLabel?: string;
  rowProps?: (track: T, selected: boolean) => HTMLAttributes<HTMLTableRowElement> & { 'data-testid'?: string };
  rowKey?: (track: T, index: number) => string;
  className?: string;
  tableClassName?: string;
  scrollStyle?: React.CSSProperties;
  'data-testid'?: string;
  tableTestId?: string;
  ariaLabel: string;
}

/**
 * The one track listing. A raised-nothing table in the graphite look: capital column names, hairline rows, the green status dot, a play
 * button, the title and artist, a waveform with a triangle on each cue, then the columns the page asks for and an Actions column at the
 * far right. The selected track has a coral edge and a coral wash that fades out a little past the start of the waveform.
 */
export function TrackListing<T extends { id: string }>({
  tracks, columns, selectedId, onSelect, getTitle, getArtist, getStatus, renderLeading, renderWaveform, nameClassName = 'w-[340px] shrink-0',
  actions = true, sort, onSort, trackSort, trackLabel = 'Track', rowProps, rowKey, className, tableClassName, scrollStyle, 'data-testid': testId, tableTestId, ariaLabel,
}: TrackListingProps<T>) {
  const heading = (column: string | undefined) => (column !== undefined && onSort ? { column, sort, onSort } : {});
  return (
    <div className={cn('track-listing', className)} data-testid={testId}>
      <div className="track-listing__scroll overflow-auto scrollbar-none" style={scrollStyle}>
        <TrackTable className={cn('track-listing__table min-w-[900px]', tableClassName)} data-testid={tableTestId} aria-label={ariaLabel}>
          <TrackTableHead>
            <TrackTableHeadCell label={trackLabel} uppercase {...heading(trackSort)} />
            {columns.map((column) => (
              <TrackTableHeadCell key={column.id} label={column.label} uppercase className={column.headClassName} {...heading(column.sort)} />
            ))}
            {actions && <TrackTableHeadCell label="Actions" uppercase className="w-[88px] text-center" />}
          </TrackTableHead>
          <TrackTableBody>
            {tracks.map((track, index) => {
              const selected = track.id === selectedId;
              const extra = rowProps?.(track, selected) ?? {};
              return (
                <TrackTableRow
                  key={rowKey ? rowKey(track, index) : track.id}
                  selected={selected}
                  onClick={() => onSelect?.(track)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(track); }
                  }}
                  {...extra}
                >
                  <TrackNameCell
                    title={getTitle(track)}
                    artist={getArtist(track)}
                    selected={selected}
                    dense
                    hideArtwork
                    hideSelectionBar
                    status={getStatus(track)}
                    nameClassName={nameClassName}
                    leading={renderLeading?.(track, selected)}
                  >
                    {renderWaveform?.(track)}
                  </TrackNameCell>
                  {columns.map((column) => (
                    <td key={column.id} {...column.cellProps?.(track)} className={cn('px-3 py-1.5', column.cellClassName, column.cellProps?.(track)?.className)}>{column.render(track)}</td>
                  ))}
                  {actions && (
                    <td className="track-listing__actions px-3 py-1.5">
                      {typeof actions === 'function' ? actions(track) : (
                        // Not wired up yet: it only shows where a track's actions will go.
                        <button type="button" className="track-listing__actions-button" aria-label={`Actions for ${getTitle(track)}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                          <OverflowMenuHorizontal size={18} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  )}
                </TrackTableRow>
              );
            })}
          </TrackTableBody>
        </TrackTable>
      </div>
    </div>
  );
}
