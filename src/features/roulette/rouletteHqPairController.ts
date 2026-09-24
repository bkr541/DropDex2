import type { RekordboxTrack } from '../../types';
import type { RouletteSourceRole } from './rouletteSession';
import {
  rouletteStemPreparationService,
  type RouletteStemPreparationOutcome,
} from './stemPreparationService';

export type RouletteHqPairUiStatus = 'idle' | 'preparing' | 'ready' | 'partial' | 'failed' | 'cancelled';

export interface RouletteHqPairUiState {
  status: RouletteHqPairUiStatus;
  progress: number;
  activeRole: RouletteSourceRole | null;
  completedRoles: RouletteSourceRole[];
  message: string | null;
  recoveryAction?: 'reconnect-source' | null;
  requiredVolumeName?: string | null;
}

export interface RouletteHqPairController {
  preparePair(vocalTrack: RekordboxTrack, instrumentalTrack: RekordboxTrack): Promise<RouletteHqPairUiState>;
  cancel(): Promise<boolean>;
  getState(): RouletteHqPairUiState;
}

interface RouletteHqPairControllerDependencies {
  prepare(track: RekordboxTrack): Promise<RouletteStemPreparationOutcome>;
  cancel(trackId: string): Promise<boolean>;
  onState?(state: RouletteHqPairUiState): void;
  onTrackReady?(role: RouletteSourceRole, track: RekordboxTrack): Promise<void> | void;
}

export const INITIAL_ROULETTE_HQ_STATE: RouletteHqPairUiState = {
  status: 'idle',
  progress: 0,
  activeRole: null,
  completedRoles: [],
  message: null,
  recoveryAction: null,
  requiredVolumeName: null,
};

export function createRouletteHqPairController(
  dependencies: RouletteHqPairControllerDependencies = {
    prepare: rouletteStemPreparationService.prepare,
    cancel: rouletteStemPreparationService.cancel,
  },
): RouletteHqPairController {
  let state = INITIAL_ROULETTE_HQ_STATE;
  let activeTrackId: string | null = null;
  let cancelled = false;
  let inFlight: Promise<RouletteHqPairUiState> | null = null;

  const publish = (next: RouletteHqPairUiState) => {
    state = next;
    dependencies.onState?.(next);
    return next;
  };

  const preparePair = async (vocalTrack: RekordboxTrack, instrumentalTrack: RekordboxTrack) => {
    if (inFlight) return inFlight;
    cancelled = false;

    inFlight = (async () => {
      const completedRoles: RouletteSourceRole[] = [];
      const failures: string[] = [];
      let recoveryAction: 'reconnect-source' | null = null;
      let requiredVolumeName: string | null = null;
      const queue: Array<[RouletteSourceRole, RekordboxTrack]> = [
        ['vocal', vocalTrack],
        ['instrumental', instrumentalTrack],
      ];

      publish({ status: 'preparing', progress: 0, activeRole: 'vocal', completedRoles: [], message: null });

      for (let index = 0; index < queue.length; index += 1) {
        const [role, track] = queue[index];
        if (cancelled) break;
        activeTrackId = track.id;
        publish({
          status: 'preparing',
          progress: index / queue.length,
          activeRole: role,
          completedRoles: [...completedRoles],
          message: null,
        });

        const outcome = await dependencies.prepare(track);
        if (outcome.status === 'cancelled' || cancelled) {
          cancelled = true;
          break;
        }
        if (outcome.status === 'ready') {
          completedRoles.push(role);
          await dependencies.onTrackReady?.(role, track);
        } else {
          failures.push(outcome.message ?? `${role === 'vocal' ? 'Vocal' : 'Instrumental'} HQ preparation failed.`);
          if (outcome.recoveryAction === 'reconnect-source') {
            recoveryAction = 'reconnect-source';
            requiredVolumeName = outcome.requiredVolumeName ?? null;
          }
        }

        publish({
          status: 'preparing',
          progress: (index + 1) / queue.length,
          activeRole: recoveryAction === 'reconnect-source'
            ? null
            : index + 1 < queue.length ? queue[index + 1][0] : null,
          completedRoles: [...completedRoles],
          message: failures[0] ?? null,
        });
        if (recoveryAction === 'reconnect-source') break;
      }

      activeTrackId = null;
      if (cancelled) {
        return publish({
          status: 'cancelled',
          progress: completedRoles.length / queue.length,
          activeRole: null,
          completedRoles: [...completedRoles],
          message: 'High-quality stem preparation was cancelled.',
        });
      }
      if (completedRoles.length === queue.length) {
        return publish({ status: 'ready', progress: 1, activeRole: null, completedRoles, message: null });
      }
      if (completedRoles.length > 0) {
        return publish({
          status: 'partial',
          progress: 1,
          activeRole: null,
          completedRoles,
          message: failures[0] ?? 'One high-quality stem could not be prepared.',
          recoveryAction,
          requiredVolumeName,
        });
      }
      return publish({
        status: 'failed',
        progress: 1,
        activeRole: null,
        completedRoles: [],
        message: failures[0] ?? 'High-quality stem preparation failed.',
        recoveryAction,
        requiredVolumeName,
      });
    })().finally(() => {
      inFlight = null;
      activeTrackId = null;
    });

    return inFlight;
  };

  const cancel = async () => {
    cancelled = true;
    return activeTrackId ? dependencies.cancel(activeTrackId) : Boolean(inFlight);
  };

  return { preparePair, cancel, getState: () => state };
}
