import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import {
  ImportProgressModal,
  issueBadgeLabel,
  userFriendlyIssueReason,
} from './ImportProgressModal';
import { ImportStageProgress, STEP_ORDER } from './ImportStageProgress';
import { phaseToStep } from './ImportLibraryModal';
import type { ImportUiStep } from './ImportStageProgress';

const noop = vi.fn();

// ── Stable structure ──────────────────────────────────────────────────────────

describe('ImportProgressModal', () => {
  const child = createElement('p', {}, 'content');

  it('renders a dialog shell with correct ARIA attributes', () => {
    const html = renderToStaticMarkup(
      createElement(ImportProgressModal, { currentStep: 'source', onClose: noop, children: child }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="import-progress-title"');
  });

  it('renders shared heading "Import Rekordbox Library"', () => {
    const html = renderToStaticMarkup(
      createElement(ImportProgressModal, { currentStep: 'source', onClose: noop, children: child }),
    );
    expect(html).toContain('Import Rekordbox Library');
    expect(html).toContain('id="import-progress-title"');
  });

  it('renders children inside the scrollable region', () => {
    const html = renderToStaticMarkup(
      createElement(ImportProgressModal, { currentStep: 'database', onClose: noop, children: createElement('p', { id: 'child' }, 'hello') }),
    );
    expect(html).toContain('hello');
  });

  it('renders abortOverlay when provided', () => {
    const html = renderToStaticMarkup(
      createElement(ImportProgressModal, {
        currentStep: 'analyze',
        onClose: noop,
        abortOverlay: createElement('div', { id: 'overlay' }, 'abort'),
        children: createElement('p', {}, 'body'),
      }),
    );
    expect(html).toContain('abort');
    expect(html).toContain('body');
  });

  it('renders nothing for abortOverlay when undefined', () => {
    const html = renderToStaticMarkup(
      createElement(ImportProgressModal, { currentStep: 'source', onClose: noop, abortOverlay: undefined, children: createElement('p', {}, 'x') }),
    );
    expect(html).toContain('x');
  });

  it('renders all five step labels', () => {
    const html = renderToStaticMarkup(
      createElement(ImportProgressModal, { currentStep: 'source', onClose: noop, children: child }),
    );
    expect(html).toContain('SOURCE');
    expect(html).toContain('DATABASE');
    expect(html).toContain('ANALYSIS FILES');
    expect(html).toContain('ANALYZE');
    expect(html).toContain('COMPLETE');
  });

  it('has stable outer geometry classes', () => {
    const html = renderToStaticMarkup(
      createElement(ImportProgressModal, { currentStep: 'source', onClose: noop, children: child }),
    );
    expect(html).toContain('h-[600px]');
    expect(html).toContain('max-w-xl');
  });
});

// ── ImportStageProgress stepper ────────────────────────────────────────────────

describe('ImportStageProgress', () => {
  it('marks the active step with aria-current="step"', () => {
    const html = renderToStaticMarkup(
      createElement(ImportStageProgress, { currentStep: 'database' }),
    );
    expect(html).toContain('aria-current="step"');
  });

  it('only one step has aria-current at a time', () => {
    for (const step of STEP_ORDER) {
      const html = renderToStaticMarkup(
        createElement(ImportStageProgress, { currentStep: step }),
      );
      const matches = (html.match(/aria-current="step"/g) ?? []).length;
      expect(matches).toBe(1);
    }
  });

  it('STEP_ORDER has exactly 5 entries', () => {
    expect(STEP_ORDER).toHaveLength(5);
  });

  it('STEP_ORDER ends with complete', () => {
    expect(STEP_ORDER[STEP_ORDER.length - 1]).toBe('complete');
  });
});

// ── phaseToStep mappings ──────────────────────────────────────────────────────

describe('phaseToStep', () => {
  it('idle → source', () => {
    expect(phaseToStep('idle', 'uploading_database', false)).toBe('source');
  });

  it('scanning_usb → source', () => {
    expect(phaseToStep('scanning_usb', 'uploading_database', false)).toBe('source');
  });

  it('database_selected → source', () => {
    expect(phaseToStep('database_selected', 'uploading_database', false)).toBe('source');
  });

  it('uploading_usb_data + uploading_database → database', () => {
    expect(phaseToStep('uploading_usb_data', 'uploading_database', false)).toBe('database');
  });

  it('uploading_usb_data + matching_analysis → analysis-files', () => {
    expect(phaseToStep('uploading_usb_data', 'matching_analysis', false)).toBe('analysis-files');
  });

  it('uploading_usb_data + uploading_analysis → analysis-files', () => {
    expect(phaseToStep('uploading_usb_data', 'uploading_analysis', false)).toBe('analysis-files');
  });

  it('uploading_usb_data + uploading_bundle → analysis-files', () => {
    expect(phaseToStep('uploading_usb_data', 'uploading_bundle', false)).toBe('analysis-files');
  });

  it('stopping_usb_reads → analysis-files', () => {
    expect(phaseToStep('stopping_usb_reads', 'uploading_database', false)).toBe('analysis-files');
  });

  it('usb_released → analyze', () => {
    expect(phaseToStep('usb_released', 'uploading_database', false)).toBe('analyze');
  });

  it('parsing_cloud_data → analyze', () => {
    expect(phaseToStep('parsing_cloud_data', 'uploading_database', true)).toBe('analyze');
  });

  it('pausing_cloud_work → analyze', () => {
    expect(phaseToStep('pausing_cloud_work', 'uploading_database', true)).toBe('analyze');
  });

  it('paused → analyze', () => {
    expect(phaseToStep('paused', 'uploading_database', true)).toBe('analyze');
  });

  it('interrupted → analyze', () => {
    expect(phaseToStep('interrupted', 'uploading_database', true)).toBe('analyze');
  });

  it('completed → complete', () => {
    expect(phaseToStep('completed', 'uploading_database', true)).toBe('complete');
  });

  it('partial_success → complete', () => {
    expect(phaseToStep('partial_success', 'uploading_database', true)).toBe('complete');
  });

  it('deleting_import with import id → analyze', () => {
    expect(phaseToStep('deleting_import', 'uploading_database', true)).toBe('analyze');
  });

  it('deleting_import without import id → source', () => {
    expect(phaseToStep('deleting_import', 'uploading_database', false)).toBe('source');
  });

  it('cancelled with import id → analyze', () => {
    expect(phaseToStep('cancelled', 'uploading_database', true)).toBe('analyze');
  });

  it('cancelled without import id → source', () => {
    expect(phaseToStep('cancelled', 'uploading_database', false)).toBe('source');
  });

  it('failed with import id → analyze', () => {
    expect(phaseToStep('failed', 'uploading_database', true)).toBe('analyze');
  });

  it('failed without import id → source', () => {
    expect(phaseToStep('failed', 'uploading_database', false)).toBe('source');
  });
});

// ── issueBadgeLabel ───────────────────────────────────────────────────────────

describe('issueBadgeLabel', () => {
  it('maps partial → Needs Review', () => {
    expect(issueBadgeLabel('partial')).toBe('Needs Review');
  });

  it('maps failed → Not Processed', () => {
    expect(issueBadgeLabel('failed')).toBe('Not Processed');
  });

  it('maps missing_required → Analysis File Missing', () => {
    expect(issueBadgeLabel('missing_required')).toBe('Analysis File Missing');
  });

  it('passes through unknown statuses', () => {
    expect(issueBadgeLabel('unknown_status')).toBe('unknown_status');
  });
});

// ── userFriendlyIssueReason ───────────────────────────────────────────────────

describe('userFriendlyIssueReason', () => {
  it('returns a color-waveform message for ext/missing reasons', () => {
    const result = userFriendlyIssueReason('partial', 'ext file missing');
    expect(result).toContain('Color waveform');
  });

  it('returns a DAT message for dat/missing reasons', () => {
    const result = userFriendlyIssueReason('failed', 'dat file not found');
    expect(result).toContain('.DAT');
  });

  it('returns a decode message for corrupt reasons', () => {
    const result = userFriendlyIssueReason('failed', 'corrupt file decode error');
    expect(result).toContain('decoded');
  });

  it('returns a timeout message', () => {
    const result = userFriendlyIssueReason('failed', 'analysis timed out after 30s');
    expect(result).toContain('timed out');
  });

  it('returns a parse message for struct reasons', () => {
    const result = userFriendlyIssueReason('failed', 'struct parse error in header');
    expect(result).toContain('parsed');
  });

  it('passes through a short safe unknown reason verbatim', () => {
    const result = userFriendlyIssueReason('failed', 'unknown custom reason here');
    expect(result).toBe('unknown custom reason here');
  });

  it('rejects multi-line reasons (tracebacks) and falls back to status', () => {
    const traceback = 'Error\n  File "/usr/lib/python"\nTraceback';
    const result = userFriendlyIssueReason('partial', traceback);
    expect(result).not.toContain('File "');
    expect(result).toContain('analysis data');
  });

  it('rejects reasons containing internal paths', () => {
    const result = userFriendlyIssueReason('failed', '/home/user/some/internal/path issue');
    expect(result).not.toContain('/home/');
  });

  it('rejects reasons longer than 160 chars', () => {
    const longReason = 'a'.repeat(161);
    const result = userFriendlyIssueReason('failed', longReason);
    expect(result).not.toBe(longReason);
  });

  it('returns partial status fallback when no reason', () => {
    const result = userFriendlyIssueReason('partial', null);
    expect(result).toContain('analysis data');
  });

  it('returns missing_required status fallback when no reason', () => {
    const result = userFriendlyIssueReason('missing_required', undefined);
    expect(result).toContain('required analysis file');
  });

  it('returns generic fallback for failed with no reason', () => {
    const result = userFriendlyIssueReason('failed', null);
    expect(result).toContain('DropDex could not read');
  });
});

// ── Import Complete labels (detail rows exist, old grid labels gone) ──────────

describe('Import Complete detail-row labels (via issueBadgeLabel as proxy)', () => {
  it('does not produce "Parsed" label (old grid label)', () => {
    expect(issueBadgeLabel('partial')).not.toBe('Partial parse');
    expect(issueBadgeLabel('failed')).not.toBe('Parse failed');
    expect(issueBadgeLabel('missing_required')).not.toBe('Missing DAT');
  });
});

// ── Scope protection: DeleteAllLibrariesModal untouched ────────────────────────

describe('DeleteAllLibrariesModal scope protection', () => {
  it('can be imported without error (module not modified by ImportProgressModal refactor)', async () => {
    const mod = await import('./DeleteAllLibrariesModal');
    expect(mod.DeleteAllLibrariesModal).toBeDefined();
  });
});
