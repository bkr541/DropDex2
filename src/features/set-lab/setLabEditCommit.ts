import type { SetLabAction } from './sessionReducer';
import type { SetLabDispatch } from './useSetLabSession';
import type { SetLabPreview } from './useSetLabPreview';

/** Read the current transport state at commit time, after async validation. */
export function commitSetLabEdit(
  action: SetLabAction,
  preview: Pick<SetLabPreview, 'getSnapshot' | 'stopAndReset'>,
  dispatch: SetLabDispatch,
  confirmed = false,
): 'confirm' | 'committed' | 'rejected' {
  if (!confirmed && preview.getSnapshot().status === 'playing') return 'confirm';
  return dispatch(action, preview.stopAndReset) ? 'committed' : 'rejected';
}
