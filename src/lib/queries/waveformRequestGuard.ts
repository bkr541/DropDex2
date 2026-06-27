/** Pure request-gating helpers used by the waveform hook and race-condition tests. */
export function shouldAcceptWaveformResult(
  currentToken: number | undefined,
  requestToken: number,
): boolean {
  return currentToken === requestToken;
}

export function shouldExposeWaveformResult(
  activeImportId: string | null,
  requestImportId: string,
  activeTrackIds: ReadonlySet<string>,
  trackId: string,
): boolean {
  return activeImportId === requestImportId && activeTrackIds.has(trackId);
}
