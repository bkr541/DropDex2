import { useState, type HTMLAttributes, type ReactNode, type Ref, type TdHTMLAttributes, type UIEventHandler } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu, type ContextMenuItem } from '../controls/ContextMenu';
import { MoreHoriz } from 'iconoir-react/regular';
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
  selectedIds?: ReadonlySet<string>;
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
  getActions?: (track: T) => ContextMenuItem[];
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
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  topSpacer?: number;
  bottomSpacer?: number;
  'data-testid'?: string;
  tableTestId?: string;
  ariaLabel: string;
}

/**
 * The one track listing. A raised-nothing table in the graphite look: capital column names, hairline rows, the green status dot, a play
 * button, the title and artist, a waveform with a dot above each cue, then the columns the page asks for and an Actions column at the
 * far right. The selected track has a coral edge and a faint wash.
 */
export function TrackListing<T extends { id: string }>({
  tracks, columns, selectedId, selectedIds, onSelect, getTitle, getArtist, getStatus, renderLeading, renderWaveform, nameClassName = 'w-[340px] shrink-0',
  actions = true, getActions, sort, onSort, trackSort, trackLabel = 'Track', rowProps, rowKey, className, tableClassName, scrollStyle, scrollRef, onScroll, topSpacer, bottomSpacer, 'data-testid': testId, tableTestId, ariaLabel,
}: TrackListingProps<T>) {
  const [menu, setMenu] = useState<{ track: T; anchor: HTMLButtonElement } | null>(null);
  const menuTrack = menu && tracks.find((track) => track.id === menu.track.id);
  const items = menuTrack && getActions ? getActions(menuTrack) : [];
  const columnCount = 1 + columns.length + Number(Boolean(actions));
  const spacer = (height?: number) => height ? (
    <tr className="track-listing__spacer" aria-hidden="true"><td colSpan={columnCount} style={{ height }} /></tr>
  ) : null;
  const heading = (column: string | undefined) => (column !== undefined && onSort ? { column, sort, onSort } : {});
  return (
    <div className={cn('track-listing', className)} data-testid={testId}>
      <div className="track-listing__scroll overflow-auto scrollbar-none" style={scrollStyle} ref={scrollRef} onScroll={onScroll}>
        <TrackTable className={cn('track-listing__table min-w-[900px]', tableClassName)} data-testid={tableTestId} aria-label={ariaLabel}>
          <TrackTableHead>
            <TrackTableHeadCell label={trackLabel} uppercase {...heading(trackSort)} />
            {columns.map((column) => (
              <TrackTableHeadCell key={column.id} label={column.label} uppercase className={column.headClassName} {...heading(column.sort)} />
            ))}
            {actions && <TrackTableHeadCell label="Actions" uppercase className="w-[88px] text-center" />}
          </TrackTableHead>
          <TrackTableBody>
            {spacer(topSpacer)}
            {tracks.map((track, index) => {
              const selected = selectedIds?.has(track.id) ?? track.id === selectedId;
              const extra = rowProps?.(track, selected) ?? {};
              return (
                <TrackTableRow
                  key={rowKey ? rowKey(track, index) : track.id}
                  selected={selected}
                  tabIndex={onSelect ? 0 : -1}
                  onClick={onSelect ? () => onSelect(track) : undefined}
                  onKeyDown={(event) => {
                    if (onSelect && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(track); }
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
                        <button
                          type="button"
                          className="track-listing__actions-button"
                          aria-label={'Actions for ' + getTitle(track)}
                          aria-haspopup={getActions ? 'menu' : undefined}
                          aria-expanded={getActions ? menu?.track.id === track.id : undefined}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (getActions) setMenu({ track, anchor: event.currentTarget });
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <MoreHoriz width={18} height={18} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  )}
                </TrackTableRow>
              );
            })}
            {spacer(bottomSpacer)}
          </TrackTableBody>
        </TrackTable>
      </div>
      {menu && items.length > 0 && createPortal(
        <ContextMenu
          x={menu.anchor.getBoundingClientRect().left}
          y={menu.anchor.getBoundingClientRect().bottom + 4}
          items={items}
          ariaLabel={'Actions for ' + getTitle(menu.track)}
          onClose={() => { setMenu(null); menu.anchor.focus(); }}
        />,
        document.body,
      )}
    </div>
  );
}
