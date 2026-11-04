/** Which sidebar entry is the current page, if any. The profile page highlights the profile entry. */
export function activeSidebarKey(currentView: string, navViews: readonly string[]): string | null {
  if (navViews.includes(currentView)) return currentView;
  if (currentView === 'settings') return 'profile';
  return null;
}
