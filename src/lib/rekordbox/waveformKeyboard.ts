import { clampProgress } from './waveformRenderer';

export function nextWaveformSeekFraction(
  key: string,
  currentFraction: number,
  seekStep = 0.01,
): number | null {
  const current = clampProgress(currentFraction);
  const step = Math.max(0.001, Math.min(0.25, seekStep));
  let next: number;

  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      next = current - step;
      break;
    case 'ArrowRight':
    case 'ArrowUp':
      next = current + step;
      break;
    case 'PageDown':
      next = current - Math.max(0.1, step);
      break;
    case 'PageUp':
      next = current + Math.max(0.1, step);
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = 1;
      break;
    default:
      return null;
  }

  return clampProgress(next);
}
