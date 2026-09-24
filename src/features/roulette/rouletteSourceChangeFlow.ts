import type { RouletteSourceRole, RouletteTransportStatus } from './rouletteSession';

export type RouletteSourceChange = RouletteSourceRole | 'both';

export interface RouletteSourceChangeActions {
  stop(): void;
  replaceSource(role: RouletteSourceRole): Promise<boolean>;
  replaceBoth(): Promise<boolean>;
}

export function rouletteSourceChangeRequiresConfirmation(
  playbackStatus: 'idle' | 'loading' | 'playing' | 'error',
  transportStatus: RouletteTransportStatus,
): boolean {
  return playbackStatus === 'playing' || transportStatus === 'playing';
}

export async function executeRouletteSourceChange(
  actions: RouletteSourceChangeActions,
  change: RouletteSourceChange,
  options: { stopPlaybackFirst?: boolean } = {},
): Promise<boolean> {
  if (options.stopPlaybackFirst) actions.stop();
  return change === 'both'
    ? actions.replaceBoth()
    : actions.replaceSource(change);
}
