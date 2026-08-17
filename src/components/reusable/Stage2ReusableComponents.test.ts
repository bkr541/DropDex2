import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseAppRoute, routeToUrl } from '../../navigation/appRoutes';
import {
  AnalysisStatusBadge,
  ProgressBar,
  StatusBadge,
  StatusLoader,
  clampProgress,
  progressPercent,
} from '../ui/DropDexFeedback';
import { Stage2Showcase } from './Stage2Showcase';

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe('Stage 2 reusable feedback primitives', () => {
  it('clamps progress values and handles invalid ranges without NaN widths', () => {
    expect(clampProgress(-20)).toBe(0);
    expect(clampProgress(0)).toBe(0);
    expect(clampProgress(48)).toBe(48);
    expect(clampProgress(100)).toBe(100);
    expect(clampProgress(140)).toBe(100);
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(clampProgress(50, Number.NaN, 100)).toBe(50);
    expect(clampProgress(50, 10, Number.NaN)).toBe(10);
    expect(progressPercent(50, 200)).toBe(25);
    expect(progressPercent(50, 0)).toBe(0);

    const zeroMarkup = render(React.createElement(ProgressBar, { value: 0, max: 100, showValue: true, label: 'zero progress' }));
    const markup = render(React.createElement(ProgressBar, { value: 140, max: 100, showValue: true, label: 'test progress' }));
    expect(zeroMarkup).toContain('aria-valuenow="0"');
    expect(zeroMarkup).toContain('width:0%');
    expect(markup).toContain('aria-valuenow="100"');
    expect(markup).toContain('width:100%');
    expect(markup).not.toContain('NaN');
  });

  it('renders status semantics with more than text color alone', () => {
    const success = render(React.createElement(StatusBadge, { tone: 'success', icon: React.createElement('span', null, '✓') }, 'Complete'));
    expect(success).toContain('dd-tone-success');
    expect(success).toContain('dd-status-badge__icon');
    expect(success).toContain('Complete');

    const analysis = render(React.createElement(AnalysisStatusBadge, { state: 'failed' }));
    expect(analysis).toContain('Analysis Failed');
    expect(analysis).toContain('dd-tone-error');
  });

  it('renders determinate loaders without JavaScript timers', () => {
    const markup = render(React.createElement(StatusLoader, { variant: 'dual-ring', label: 'Analyzing' }));
    expect(markup).toContain('role="status"');
    expect(markup).toContain('dd-loader--dual-ring');
  });
});

describe('Reusable Components Stage 2 route', () => {
  it('resolves the real reusable-components route and renders the complete Stage 2 board', () => {
    const route = parseAppRoute('/reusable-components');
    expect(route).toEqual({ name: 'reusable-components' });
    expect(routeToUrl(route)).toBe('/reusable-components');

    const markup = render(React.createElement(Stage2Showcase));
    expect(markup).toContain('data-testid="stage2-component-board"');
    for (const label of [
      'Status Badge', 'Analysis Status Badge', 'Status Dot', 'Progress Bar', 'Spinner / Loader',
      'Toast / Notification', 'Import Activity Banner', 'Warning / Alert Banner', 'Error / Empty State',
      'Background Import Panel / Floating Activity Panel', 'Progress / Status Modal', 'File Upload Button',
      'Upload Dropzone', 'Modal / Dialog', 'Destructive Confirmation Modal', 'Selectable Option Card',
      'Skeleton Row', 'Skeleton Card', 'Skeleton Chip',
    ]) {
      expect(markup).toContain(`data-stage2-card="${label}"`);
    }
  });
});
