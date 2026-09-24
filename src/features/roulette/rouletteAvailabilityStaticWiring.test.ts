import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const availabilitySource = fs.readFileSync(
  path.join(root, 'src/features/roulette/useRouletteMatchingAvailability.ts'),
  'utf8',
);
const viewSource = fs.readFileSync(
  path.join(root, 'src/components/roulette/RouletteView.tsx'),
  'utf8',
);
const contextSource = fs.readFileSync(
  path.join(root, 'src/features/roulette/RouletteSessionContext.tsx'),
  'utf8',
);
const readinessSource = fs.readFileSync(
  path.join(root, 'src/features/roulette/useRouletteRuntimeReadiness.ts'),
  'utf8',
);

describe('Roulette availability refresh wiring', () => {
  it('subscribes to analysis progress to refresh stale availability', () => {
    expect(availabilitySource).toContain('subscribeToRekordboxAnalysisProgress');
  });

  it('adds a periodic refresh so a mounted view does not stay stale indefinitely', () => {
    expect(availabilitySource).toContain('ROULETTE_AVAILABILITY_REFRESH_MS');
    expect(availabilitySource).toContain('setInterval');
  });

  it('refreshes on window focus', () => {
    expect(availabilitySource).toContain("addEventListener('focus'");
  });
});

describe('Roulette runtime readiness — not just Electron detection', () => {
  it('RouletteSessionContext uses useRouletteRuntimeReadiness rather than bare isElectron check', () => {
    expect(contextSource).toContain('useRouletteRuntimeReadiness');
    expect(contextSource).not.toMatch(/matchingAvailable\s*=\s*rouletteDesktopMatchingAvailable\(\)/);
  });

  it('readiness hook calls getRouletteRuntimeHealth, not just isElectron', () => {
    expect(readinessSource).toContain('getRouletteRuntimeHealth');
  });

  it('setup-required and temporarily-unavailable statuses are distinguishable', () => {
    expect(readinessSource).toContain('setup-required');
    expect(readinessSource).toContain('temporarily-unavailable');
  });
});

describe('Roulette action availability — per-partner compatibility', () => {
  it('canChangeVocal is used instead of candidateAvailability.available for Change Vocal', () => {
    expect(viewSource).toContain('canChangeVocal');
    expect(viewSource).not.toMatch(/canChangeVocal\s*=\s*matchingAvailable\s*&&\s*candidateAvailability\.available/);
  });

  it('canChangeInstrumental is used instead of candidateAvailability.available for Change Instrumental', () => {
    expect(viewSource).toContain('canChangeInstrumental');
  });

  it('canRouletteBoth gates the Roulette Both button', () => {
    expect(viewSource).toContain('canRouletteBoth');
    expect(viewSource).not.toMatch(/!candidateAvailability\.available.*Roulette Both/);
  });

  it('shows "No more compatible sources" when replacements are exhausted', () => {
    expect(viewSource).toContain('No more compatible sources');
  });
});

describe('Roulette initial load — retryable without remount', () => {
  it('uses a promise ref instead of a boolean guard to track initial load', () => {
    expect(viewSource).toContain('initialLoadPromise');
    expect(viewSource).not.toContain('initialLoadRequested');
  });

  it('clears the promise ref when the request settles so retry is possible', () => {
    expect(viewSource).toMatch(/initialLoadPromise\.current\s*=\s*null/);
  });

  it('blocks duplicate concurrent initializations', () => {
    expect(viewSource).toMatch(/if\s*\(\s*initialLoadPromise\.current\s*\)/);
  });

  it('exposes a Retry button after initial load failure', () => {
    expect(viewSource).toContain("command.status === 'error'");
    expect(viewSource).toContain('requestInitialLoad');
    expect(viewSource).toContain('Retry');
  });
});


describe('Roulette truthful count and recovery presentation', () => {
  it('carries explicit pair-count truncation metadata instead of inferring from a UI magic number', () => {
    expect(availabilitySource).toContain('compatiblePairCountIsTruncated');
    expect(viewSource).toContain('formatRouletteCompatiblePairCount');
    expect(viewSource).not.toMatch(/compatiblePairCount\s*===\s*512/);
  });

  it('uses reconnect for missing source media and Retry only for retryable preview failures', () => {
    expect(viewSource).toContain('actionLabel="Reconnect"');
    expect(viewSource).toContain("preview.recoveryAction === 'retry'");
    expect(viewSource).toContain("preview.recoveryAction === 'runtime-setup'");
  });

  it('only exposes initial-load Retry when the command is classified retryable', () => {
    expect(viewSource).toContain("state.command.recoveryAction === 'retry'");
  });
});
