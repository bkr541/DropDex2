import type { RouletteCandidateAnalysis } from '../../features/roulette/rouletteMatching';

export const FLIP_LAB_ROW_HEIGHT = 51;
export const FLIP_LAB_LIST_OVERSCAN = 6;
export const FLIP_LAB_MAX_RENDERED_ROWS = 40;

export interface FlipLabWindowRange {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

export function filterFlipLabCandidates(
  candidates: readonly RouletteCandidateAnalysis[],
  search: string,
): RouletteCandidateAnalysis[] {
  const query = search.trim().toLowerCase();
  if (!query) return candidates as RouletteCandidateAnalysis[];
  return candidates.filter((candidate) => (
    `${candidate.track.title} ${candidate.track.artist ?? ''}`
      .toLowerCase()
      .includes(query)
  ));
}

export function computeFlipLabWindowRange(
  totalRows: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = FLIP_LAB_ROW_HEIGHT,
  overscan = FLIP_LAB_LIST_OVERSCAN,
  maxRenderedRows = FLIP_LAB_MAX_RENDERED_ROWS,
): FlipLabWindowRange {
  if (totalRows <= 0) {
    return { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 };
  }

  const safeRowHeight = Math.max(1, rowHeight);
  const safeViewportHeight = Math.max(safeRowHeight, viewportHeight);
  const visibleRows = Math.max(1, Math.ceil(safeViewportHeight / safeRowHeight));
  const renderedRows = Math.min(
    totalRows,
    Math.max(visibleRows, Math.min(maxRenderedRows, visibleRows + Math.max(0, overscan) * 2)),
  );
  const desiredStart = Math.max(0, Math.floor(Math.max(0, scrollTop) / safeRowHeight) - Math.max(0, overscan));
  const maxStart = Math.max(0, totalRows - renderedRows);
  const startIndex = Math.min(desiredStart, maxStart);
  const endIndex = Math.min(totalRows, startIndex + renderedRows);

  return {
    startIndex,
    endIndex,
    topSpacerHeight: startIndex * safeRowHeight,
    bottomSpacerHeight: Math.max(0, (totalRows - endIndex) * safeRowHeight),
  };
}

export function scrollTopForFlipLabSelection(
  selectedIndex: number,
  currentScrollTop: number,
  viewportHeight: number,
  rowHeight = FLIP_LAB_ROW_HEIGHT,
): number {
  if (selectedIndex < 0) return Math.max(0, currentScrollTop);
  const safeRowHeight = Math.max(1, rowHeight);
  const safeViewportHeight = Math.max(safeRowHeight, viewportHeight);
  const rowTop = selectedIndex * safeRowHeight;
  const rowBottom = rowTop + safeRowHeight;
  const viewportTop = Math.max(0, currentScrollTop);
  const viewportBottom = viewportTop + safeViewportHeight;

  if (rowTop < viewportTop) return rowTop;
  if (rowBottom > viewportBottom) return Math.max(0, rowBottom - safeViewportHeight);
  return viewportTop;
}

export function isCurrentFlipLabLoad(
  requestGeneration: number,
  activeGeneration: number,
  requestImportId: string,
  activeImportId: string | null,
  signal: AbortSignal,
): boolean {
  return !signal.aborted
    && requestGeneration === activeGeneration
    && requestImportId === activeImportId;
}
