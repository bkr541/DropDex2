import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, it, expect } from 'vitest';
import {
  ImportProgressModal,
  issueBadgeLabel,
  userFriendlyIssueReason,
} from './ImportProgressModal';

// ── Stable structure ──────────────────────────────────────────────────────────

describe('ImportProgressModal', () => {
  it('renders a dialog shell with correct ARIA attributes', () => {
    const html = renderToStaticMarkup(
      createElement(ImportProgressModal, {}, createElement('p', {}, 'content')),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="import-progress-title"');
  });

  it('renders children inside the scrollable region', () => {
    const html = renderToStaticMarkup(
      createElement(ImportProgressModal, {}, createElement('p', { id: 'child' }, 'hello')),
    );
    expect(html).toContain('hello');
  });

  it('renders abortOverlay when provided', () => {
    const html = renderToStaticMarkup(
      createElement(
        ImportProgressModal,
        { abortOverlay: createElement('div', { id: 'overlay' }, 'abort') },
        createElement('p', {}, 'body'),
      ),
    );
    expect(html).toContain('abort');
    expect(html).toContain('body');
  });

  it('renders nothing for abortOverlay when undefined', () => {
    const html = renderToStaticMarkup(
      createElement(ImportProgressModal, { abortOverlay: undefined }, createElement('p', {}, 'x')),
    );
    // overlay wrapper should not appear
    expect(html).not.toContain('inset-0 z-10');
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
