import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { classifyUnavailableReason } from './useRouletteRuntimeReadiness';

const root = process.cwd();
const readinessSource = fs.readFileSync(
  path.join(root, 'src/features/roulette/useRouletteRuntimeReadiness.ts'),
  'utf8',
);

describe('classifyUnavailableReason', () => {
  it('classifies runtime_missing as setup-required', () => {
    expect(classifyUnavailableReason('runtime_missing')).toBe('setup-required');
  });

  it('classifies model_missing as setup-required', () => {
    expect(classifyUnavailableReason('model_missing')).toBe('setup-required');
  });

  it('classifies dependency_unavailable as setup-required', () => {
    expect(classifyUnavailableReason('dependency_unavailable')).toBe('setup-required');
  });

  it('classifies decoder_unavailable as temporarily-unavailable', () => {
    expect(classifyUnavailableReason('decoder_unavailable')).toBe('temporarily-unavailable');
  });

  it('classifies storage_unavailable as temporarily-unavailable', () => {
    expect(classifyUnavailableReason('storage_unavailable')).toBe('temporarily-unavailable');
  });

  it('classifies unexpected_failure as temporarily-unavailable', () => {
    expect(classifyUnavailableReason('unexpected_failure')).toBe('temporarily-unavailable');
  });
});

describe('useRouletteRuntimeReadiness structural guarantees', () => {
  it('calls getRouletteRuntimeHealth, not just isElectron', () => {
    expect(readinessSource).toContain('getRouletteRuntimeHealth');
  });

  it('starts in checking state when in Electron', () => {
    expect(readinessSource).toContain("status: 'checking'");
  });

  it('starts in unavailable state when not in Electron', () => {
    expect(readinessSource).toContain("status: 'unavailable'");
  });

  it('re-checks on window focus', () => {
    expect(readinessSource).toContain("addEventListener('focus'");
  });

  it('re-checks on a periodic interval', () => {
    expect(readinessSource).toContain('RUNTIME_HEALTH_REFRESH_MS');
    expect(readinessSource).toContain('setInterval');
  });
});
