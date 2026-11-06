/** The groups on the Library overview page that the user can show or hide. */
export const LIBRARY_OVERVIEW_WIDGETS = [
  { id: 'usbImport', label: 'USB Import', description: 'Your USB, when it was last imported, and the Import Library button.' },
  { id: 'trackAnalysis', label: 'Track Analysis', description: 'How many of your tracks have been analyzed, with Resume Analysis when it needs finishing.' },
  { id: 'topGenres', label: 'Top Genres', description: 'The genres that make up most of your library.' },
  { id: 'bpmDistribution', label: 'BPM Distribution', description: 'How your tracks are spread across tempo ranges.' },
  { id: 'keyProfile', label: 'Key Profile', description: 'Your most common keys, on the Camelot wheel.' },
] as const;

export type LibraryOverviewWidgetId = typeof LIBRARY_OVERVIEW_WIDGETS[number]['id'];

const KNOWN_IDS: ReadonlySet<string> = new Set(LIBRARY_OVERVIEW_WIDGETS.map((widget) => widget.id));

export function isLibraryOverviewWidgetId(value: unknown): value is LibraryOverviewWidgetId {
  return typeof value === 'string' && KNOWN_IDS.has(value);
}

/** The hidden groups from stored data. Names that are not groups (for example from a newer or older version) are ignored. */
export function parseHiddenWidgets(value: unknown): ReadonlySet<LibraryOverviewWidgetId> {
  return new Set(Array.isArray(value) ? value.filter(isLibraryOverviewWidgetId) : []);
}

/** Stored form: a list in the order the groups appear on the page, so the same choice always saves the same way. */
export function serializeHiddenWidgets(hidden: ReadonlySet<LibraryOverviewWidgetId>): LibraryOverviewWidgetId[] {
  return LIBRARY_OVERVIEW_WIDGETS.map((widget) => widget.id).filter((id) => hidden.has(id));
}

export function withWidgetVisibility(
  hidden: ReadonlySet<LibraryOverviewWidgetId>,
  id: LibraryOverviewWidgetId,
  visible: boolean,
): ReadonlySet<LibraryOverviewWidgetId> {
  const next = new Set(hidden);
  if (visible) next.delete(id);
  else next.add(id);
  return next;
}

export const NO_HIDDEN_WIDGETS: ReadonlySet<LibraryOverviewWidgetId> = new Set();
