import type { RouletteSourceRole } from './rouletteSession';

export const ROULETTE_RECENT_HISTORY_LIMIT = 6;

export function roulettePairKey(vocalTrackId: string, instrumentalTrackId: string): string {
  return `${vocalTrackId}\u0000${instrumentalTrackId}`;
}

function rememberBounded(values: string[], value: string, limit: number): void {
  const existingIndex = values.indexOf(value);
  if (existingIndex >= 0) values.splice(existingIndex, 1);
  values.push(value);
  while (values.length > limit) values.shift();
}

/** Runtime-only repeat avoidance. Nothing here is persisted across app launches. */
export class RouletteSelectionHistory {
  private readonly recentSources: Record<RouletteSourceRole, string[]> = {
    vocal: [],
    instrumental: [],
  };
  private readonly recentPairs: string[] = [];

  constructor(private readonly limit = ROULETTE_RECENT_HISTORY_LIMIT) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('Roulette selection history limit must be a positive integer.');
    }
  }

  snapshot() {
    return {
      vocalTrackIds: [...this.recentSources.vocal],
      instrumentalTrackIds: [...this.recentSources.instrumental],
      pairKeys: [...this.recentPairs],
    };
  }

  rememberSource(role: RouletteSourceRole, trackId: string | null | undefined): void {
    if (!trackId) return;
    rememberBounded(this.recentSources[role], trackId, this.limit);
  }

  rememberPair(vocalTrackId: string | null | undefined, instrumentalTrackId: string | null | undefined): void {
    if (!vocalTrackId || !instrumentalTrackId) return;
    this.rememberSource('vocal', vocalTrackId);
    this.rememberSource('instrumental', instrumentalTrackId);
    rememberBounded(this.recentPairs, roulettePairKey(vocalTrackId, instrumentalTrackId), this.limit);
  }
}
