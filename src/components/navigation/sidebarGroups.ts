export interface SidebarEntry {
  key: string;
}

/**
 * Splits the sidebar's entries at the active one: everything above it, the active entry itself, and
 * everything below it. With no active entry, everything is in one group above.
 */
export function splitAtActive<T extends SidebarEntry>(
  entries: readonly T[],
  activeKey: string | null,
): { before: T[]; active: T | null; after: T[] } {
  const index = activeKey == null ? -1 : entries.findIndex((entry) => entry.key === activeKey);
  if (index < 0) return { before: [...entries], active: null, after: [] };
  return { before: entries.slice(0, index), active: entries[index], after: entries.slice(index + 1) };
}

/** Which sidebar entry is the current page, if any. The profile page highlights the profile entry. */
export function activeSidebarKey(currentView: string, navViews: readonly string[]): string | null {
  if (navViews.includes(currentView)) return currentView;
  if (currentView === 'settings') return 'profile';
  return null;
}
