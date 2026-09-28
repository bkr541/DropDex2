import type { RekordboxTrack } from '../../types';
import {
  roulettePreviewPreparationService,
  type RoulettePreviewPreparationService,
} from '../../features/roulette/roulettePreviewPreparationService';
import type {
  RoulettePreparedAuditionAsset,
  RoulettePreviewPreparationState,
  RoulettePreviewWindow,
} from '../../features/roulette/roulettePreview';
import type { RouletteSourceRole } from '../../features/roulette/rouletteSession';
import {
  ROULETTE_SEPARATOR_VERSION,
  stemTypeForRole,
  type StemAssetReadiness,
  type StemAssetType,
} from '../../features/roulette/stemAssets';
import {
  rouletteStemAssetService,
  type StemAssetService,
} from '../../features/roulette/stemAssetService';

export type FlipLabStemLifecycleStatus =
  | 'idle'
  | 'checking'
  | 'not-prepared'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'source-missing'
  | 'local-missing'
  | 'error';

export interface FlipLabStemRoleState {
  role: RouletteSourceRole;
  trackId: string | null;
  stemType: StemAssetType;
  status: FlipLabStemLifecycleStatus;
  progress: number | null;
  message: string | null;
  window: RoulettePreviewWindow | null;
  asset: RoulettePreparedAuditionAsset | null;
}

export interface FlipLabStemLifecycleDependencies {
  stemAssets: Pick<StemAssetService, 'getReadiness'>;
  previewPreparation: Pick<
    RoulettePreviewPreparationService,
    'prepare' | 'getState' | 'subscribe' | 'cancel'
  >;
}

export interface FlipLabStemLifecycle {
  select(role: RouletteSourceRole, track: RekordboxTrack | null): Promise<FlipLabStemRoleState>;
  refresh(role: RouletteSourceRole): Promise<FlipLabStemRoleState>;
  getState(role: RouletteSourceRole): FlipLabStemRoleState;
  subscribe(listener: (role: RouletteSourceRole, state: FlipLabStemRoleState) => void): () => void;
  dispose(): void;
}

const LOCAL_ASSET_STALE_PATTERN = /\b(stale|changed after|not available on this installation|ready stem metadata is incomplete|unsupported separator)\b/i;
const SOURCE_MISSING_PATTERN = /\b(local media path|source media|track source|reconnect.*source|audio file)\b/i;

export function createInitialFlipLabStemState(role: RouletteSourceRole): FlipLabStemRoleState {
  return {
    role,
    trackId: null,
    stemType: stemTypeForRole(role),
    status: 'idle',
    progress: null,
    message: null,
    window: null,
    asset: null,
  };
}

function stateForTrack(
  role: RouletteSourceRole,
  trackId: string,
  status: FlipLabStemLifecycleStatus,
  updates: Partial<Omit<FlipLabStemRoleState, 'role' | 'trackId' | 'stemType' | 'status'>> = {},
): FlipLabStemRoleState {
  return {
    role,
    trackId,
    stemType: stemTypeForRole(role),
    status,
    progress: updates.progress ?? null,
    message: updates.message ?? null,
    window: updates.window ?? null,
    asset: updates.asset ?? null,
  };
}

function readinessState(
  role: RouletteSourceRole,
  trackId: string,
  readiness: StemAssetReadiness,
): FlipLabStemRoleState {
  const reason = readiness.reason ?? null;
  const databaseReadyButUnavailable = readiness.asset?.status === 'ready' && readiness.status !== 'ready';
  const staleLocalTruth = Boolean(reason && LOCAL_ASSET_STALE_PATTERN.test(reason));

  if (databaseReadyButUnavailable || staleLocalTruth) {
    return stateForTrack(role, trackId, 'local-missing', { message: reason ?? 'The prepared stem is not usable on this installation.' });
  }

  switch (readiness.status) {
    case 'ready':
      // Local HQ truth is valid, but Flip Lab still needs the canonical audition
      // window from preview preparation before the role is fully audition-ready.
      return stateForTrack(role, trackId, 'checking', { message: 'Resolving audition window…' });
    case 'preparing':
      return stateForTrack(
        role,
        trackId,
        readiness.asset?.status === 'pending' ? 'queued' : 'processing',
        { message: reason },
      );
    case 'failed':
      return stateForTrack(role, trackId, 'failed', { message: reason ?? 'Stem preparation failed.' });
    case 'unavailable':
      return stateForTrack(role, trackId, 'not-prepared', { message: reason });
  }
}

export function flipLabStateFromPreview(
  state: RoulettePreviewPreparationState,
): FlipLabStemRoleState {
  const shared = {
    progress: state.progress,
    message: state.message,
    window: state.window,
    asset: state.asset,
  };

  switch (state.status) {
    case 'queued':
      return stateForTrack(state.role, state.trackId, 'queued', shared);
    case 'running':
      return stateForTrack(state.role, state.trackId, 'processing', shared);
    case 'ready':
      if (!state.asset || !state.window) {
        return stateForTrack(state.role, state.trackId, 'error', {
          ...shared,
          message: 'Prepared audition media is missing its asset or audition window.',
        });
      }
      return stateForTrack(state.role, state.trackId, 'ready', shared);
    case 'source-required':
      return stateForTrack(state.role, state.trackId, 'source-missing', shared);
    case 'cancelled':
      return stateForTrack(state.role, state.trackId, 'not-prepared', shared);
    case 'failed':
      if (state.recoveryAction === 'runtime-setup') {
        return stateForTrack(state.role, state.trackId, 'error', shared);
      }
      if (state.recoveryAction === 'reconnect-source' || (state.message && SOURCE_MISSING_PATTERN.test(state.message))) {
        return stateForTrack(state.role, state.trackId, 'source-missing', shared);
      }
      return stateForTrack(state.role, state.trackId, 'failed', shared);
  }
}

export function isFlipLabStemUsable(
  state: FlipLabStemRoleState,
  trackId: string | null | undefined,
): boolean {
  return Boolean(
    trackId
    && state.trackId === trackId
    && state.status === 'ready'
    && state.asset
    && state.window,
  );
}

export function flipLabStemStatusPresentation(state: FlipLabStemRoleState): {
  label: string;
  color: string;
} {
  switch (state.status) {
    case 'idle':
      return { label: 'Not selected', color: '#4b5563' };
    case 'checking':
      return { label: 'Checking…', color: '#94a3b8' };
    case 'not-prepared':
      return { label: 'Not prepared', color: '#f59e0b' };
    case 'queued':
    case 'processing':
      return { label: 'Preparing…', color: '#f59e0b' };
    case 'ready':
      return { label: 'Ready', color: '#22c55e' };
    case 'failed':
      return { label: 'Failed', color: '#ef4444' };
    case 'source-missing':
      return { label: 'Source missing', color: '#ef4444' };
    case 'local-missing':
      return { label: 'Local asset missing', color: '#f97316' };
    case 'error':
      return { label: 'Error', color: '#ef4444' };
  }
}

export function createFlipLabStemLifecycle(
  dependencies: FlipLabStemLifecycleDependencies,
): FlipLabStemLifecycle {
  const states: Record<RouletteSourceRole, FlipLabStemRoleState> = {
    vocal: createInitialFlipLabStemState('vocal'),
    instrumental: createInitialFlipLabStemState('instrumental'),
  };
  const selections: Record<RouletteSourceRole, RekordboxTrack | null> = {
    vocal: null,
    instrumental: null,
  };
  const versions: Record<RouletteSourceRole, number> = { vocal: 0, instrumental: 0 };
  const inFlight = new Map<RouletteSourceRole, Promise<FlipLabStemRoleState>>();
  const listeners = new Set<(role: RouletteSourceRole, state: FlipLabStemRoleState) => void>();

  const publish = (role: RouletteSourceRole, state: FlipLabStemRoleState) => {
    states[role] = state;
    for (const listener of listeners) listener(role, state);
    return state;
  };

  const isCurrent = (role: RouletteSourceRole, trackId: string, version: number) => (
    selections[role]?.id === trackId && versions[role] === version
  );

  const unsubscribePreview = dependencies.previewPreparation.subscribe((preview) => {
    if (selections[preview.role]?.id !== preview.trackId) return;
    publish(preview.role, flipLabStateFromPreview(preview));
  });

  const runSelection = (
    role: RouletteSourceRole,
    track: RekordboxTrack,
    version: number,
  ): Promise<FlipLabStemRoleState> => {
    const request = (async () => {
      try {
        const readiness = await dependencies.stemAssets.getReadiness(
          track.id,
          stemTypeForRole(role),
          { expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION },
        );
        if (!isCurrent(role, track.id, version)) return states[role];
        publish(role, readinessState(role, track.id, readiness));

        // The preview service is the canonical audition path. It reuses a usable
        // HQ stem when one exists, otherwise creates/caches the role-specific
        // 16-bar preview and publishes queued/running/terminal states.
        const prepared = await dependencies.previewPreparation.prepare(track, role);
        if (!isCurrent(role, track.id, version)) return states[role];
        return publish(role, flipLabStateFromPreview(prepared));
      } catch (error) {
        if (!isCurrent(role, track.id, version)) return states[role];
        return publish(role, stateForTrack(role, track.id, 'error', {
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    })();

    inFlight.set(role, request);
    void request.finally(() => {
      if (inFlight.get(role) === request) inFlight.delete(role);
    });
    return request;
  };

  const select = async (
    role: RouletteSourceRole,
    track: RekordboxTrack | null,
  ): Promise<FlipLabStemRoleState> => {
    const current = selections[role];
    if (track && current?.id === track.id) {
      return inFlight.get(role) ?? states[role];
    }

    selections[role] = track;
    const version = ++versions[role];
    if (current && current.id !== track?.id) {
      // Invalidate first, then stop obsolete preview work without blocking the
      // new selection/import lifecycle.
      void dependencies.previewPreparation.cancel(current.id, role).catch(() => false);
    }
    if (!track) return publish(role, createInitialFlipLabStemState(role));

    const existingPreview = dependencies.previewPreparation.getState(track.id, role);
    if (existingPreview) {
      // Cached service state is useful for immediate UI continuity, but do not
      // trust a previous Ready result as current local-file truth. Revalidate
      // below before declaring the newly selected role usable.
      publish(
        role,
        existingPreview.status === 'ready'
          ? stateForTrack(role, track.id, 'checking', {
              message: 'Revalidating audition media…',
              window: existingPreview.window,
            })
          : flipLabStateFromPreview(existingPreview),
      );
    } else {
      publish(role, stateForTrack(role, track.id, 'checking'));
    }

    return runSelection(role, track, version);
  };

  const refresh = async (role: RouletteSourceRole): Promise<FlipLabStemRoleState> => {
    const track = selections[role];
    if (!track) return states[role];
    const version = ++versions[role];
    publish(role, stateForTrack(role, track.id, 'checking'));
    return runSelection(role, track, version);
  };

  return {
    select,
    refresh,
    getState: (role) => states[role],
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      unsubscribePreview();
      listeners.clear();
      inFlight.clear();
    },
  };
}

export const flipLabStemLifecycle = createFlipLabStemLifecycle({
  stemAssets: rouletteStemAssetService,
  previewPreparation: roulettePreviewPreparationService,
});
