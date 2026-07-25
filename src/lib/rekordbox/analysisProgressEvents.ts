export const REKORDBOX_ANALYSIS_PROGRESS_EVENT = 'dropdex:rekordbox-analysis-progress';

export interface RekordboxAnalysisProgressDetail {
  importId: string;
  tracksReady: number;
}

export function announceRekordboxAnalysisProgress(
  detail: RekordboxAnalysisProgressDetail,
): void {
  window.dispatchEvent(new CustomEvent(REKORDBOX_ANALYSIS_PROGRESS_EVENT, { detail }));
}

export function subscribeToRekordboxAnalysisProgress(
  listener: (detail: RekordboxAnalysisProgressDetail) => void,
): () => void {
  const handle = (event: Event) => {
    const detail = (event as CustomEvent<RekordboxAnalysisProgressDetail>).detail;
    if (!detail?.importId) return;
    listener(detail);
  };
  window.addEventListener(REKORDBOX_ANALYSIS_PROGRESS_EVENT, handle);
  return () => window.removeEventListener(REKORDBOX_ANALYSIS_PROGRESS_EVENT, handle);
}
