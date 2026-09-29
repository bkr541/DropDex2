import type { RekordboxTrack } from '../../types';
import type { DesktopRouletteStemPreparationResult } from '../../types/dropdex-desktop';
import { fetchImportById } from '../../lib/queries/rekordbox';
import { resolveRouletteSourceMedia } from '../../features/roulette/rouletteSourceMedia';

export type FlipLabSeparationResult =
  | { ok: true; vocalLocator: string; instrumentalLocator: string }
  | { ok: false; cancelled: boolean; message: string };

function desktop() {
  if (typeof window === 'undefined') return null;
  return window.dropdexDesktop?.isElectron ? window.dropdexDesktop : null;
}

function trackDurationMs(track: RekordboxTrack): number | null {
  if (track.duration_ms != null) return Math.max(0, Math.round(track.duration_ms));
  if (track.duration_seconds != null) return Math.max(0, Math.round(track.duration_seconds * 1000));
  return null;
}

function failureMessage(
  track: RekordboxTrack,
  error: Extract<DesktopRouletteStemPreparationResult, { ok: false }>['error'],
): string {
  switch (error.kind) {
    case 'source_media_required':
      return `Connect the USB that has "${track.title}" and press Flip again.`;
    case 'not_found':
      return `"${track.title}" isn't on the connected USB where your library says it should be.`;
    case 'permission_denied':
      return `Your computer blocked DropDex from reading "${track.title}" on the USB. Allow access and press Flip again.`;
    case 'source_media_mismatch':
      return `The connected USB doesn't have "${track.title}". Connect the right USB and press Flip again.`;
    case 'runtime_unavailable':
      return 'Stem separation isn\'t set up on this computer yet.';
    case 'source_changed':
      return `"${track.title}" changed while its stems were being made. Press Flip again.`;
    default:
      return `Couldn't separate the stems for "${track.title}". ${error.message}`;
  }
}

type TrackSuccess = { ok: true; vocals: string; instrumental: string };
type TrackFailure = { ok: false; cancelled: boolean; message: string };

async function separateTrack(
  track: RekordboxTrack,
  onProgress: (progress: number) => void,
): Promise<TrackSuccess | TrackFailure> {
  const bridge = desktop();
  if (!bridge) {
    return { ok: false, cancelled: false, message: 'Stem separation only works in the DropDex desktop app.' };
  }
  const deviceName = (await fetchImportById(track.import_id))?.device_name ?? null;
  const media = resolveRouletteSourceMedia(track, deviceName);
  if (media.status !== 'ok') {
    return { ok: false, cancelled: false, message: `"${track.title}" doesn't have a usable file location on the USB.` };
  }

  const unsubscribe = bridge.onFlipLabSeparationProgress((payload) => {
    if (payload.trackId === track.id) onProgress(payload.progress);
  });
  try {
    const input = {
      trackId: track.id,
      sourceSegments: media.sourceSegments,
      expectedVolumeName: media.expectedVolumeName,
      expectedDurationMs: trackDurationMs(track),
    };
    let result = await bridge.separateFlipLabTrack(input);
    // After an import, DropDex hands the USB back to Rekordbox. Reclaim the
    // remembered drive once and retry before asking the user to reconnect.
    if (!result.ok && (result as Extract<DesktopRouletteStemPreparationResult, { ok: false }>).error.kind === 'source_media_required') {
      const reconnect = await bridge.reconnectUsb(media.expectedVolumeName);
      if (reconnect.reconnected) result = await bridge.separateFlipLabTrack(input);
    }
    if (!result.ok) {
      const failure = result as Extract<DesktopRouletteStemPreparationResult, { ok: false }>;
      return {
        ok: false,
        cancelled: failure.error.kind === 'cancelled',
        message: failure.error.kind === 'cancelled' ? 'Stem separation was stopped.' : failureMessage(track, failure.error),
      };
    }
    onProgress(1);
    return { ok: true, vocals: result.outputs.vocals.locator, instrumental: result.outputs.instrumental.locator };
  } finally {
    unsubscribe();
  }
}

/**
 * Separates the vocal track, then the instrumental track, reporting one
 * combined 0..1 progress value. Stems stay on this computer only; cached
 * files come back immediately.
 */
export async function separateFlipLabPair(
  vocalTrack: RekordboxTrack,
  instrumentalTrack: RekordboxTrack,
  onProgress: (progress: number) => void,
): Promise<FlipLabSeparationResult> {
  onProgress(0);
  const vocal = await separateTrack(vocalTrack, (p) => onProgress(p * 0.5));
  if (!vocal.ok) return vocal as TrackFailure;
  onProgress(0.5);
  const instrumental = vocalTrack.id === instrumentalTrack.id
    ? vocal
    : await separateTrack(instrumentalTrack, (p) => onProgress(0.5 + p * 0.5));
  if (!instrumental.ok) return instrumental as TrackFailure;
  onProgress(1);
  return {
    ok: true,
    vocalLocator: (vocal as TrackSuccess).vocals,
    instrumentalLocator: (instrumental as TrackSuccess).instrumental,
  };
}

export async function cancelFlipLabSeparation(trackIds: string[]): Promise<void> {
  const bridge = desktop();
  if (!bridge) return;
  await Promise.allSettled(trackIds.map((id) => bridge.cancelRouletteStems(id)));
}

export async function clearFlipLabStemCache(): Promise<{ ok: boolean; message: string | null }> {
  if (typeof window !== 'undefined') {
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key?.startsWith('dropdex:flip-lab-session:')) keys.push(key);
      }
      keys.forEach((key) => window.localStorage.removeItem(key));
    } catch { /* storage may be unavailable */ }
  }
  const bridge = desktop();
  if (!bridge) return { ok: true, message: null };
  const result = await bridge.clearFlipLabStemCache();
  if (result.ok) return { ok: true, message: null };
  const failure = result as Extract<typeof result, { ok: false }>;
  return { ok: false, message: failure.error.message };
}

export async function loadFlipLabStemAudio(
  locator: string,
  context: BaseAudioContext,
): Promise<AudioBuffer> {
  const bridge = desktop();
  if (!bridge) throw new Error('Stem playback only works in the DropDex desktop app.');
  const resolved = await bridge.resolveStemAsset(locator);
  if (!resolved.ok) throw new Error('A separated stem file is missing. Empty the stem cache and press Flip again.');
  const response = await fetch(resolved.source.url);
  if (!response.ok) throw new Error('A separated stem file could not be read.');
  return context.decodeAudioData(await response.arrayBuffer());
}
