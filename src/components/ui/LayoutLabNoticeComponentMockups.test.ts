import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoticeComponentMockupsContent } from './LayoutLabNoticeComponentMockups';

describe('Layout Lab Notice Component', () => {
  it('registers a separate tab for the design studies', () => {
    const source = readFileSync(new URL('./LayoutLabWindow.tsx', import.meta.url), 'utf8');
    expect(source).toContain("{ id: 'notice-component', label: 'Notice Component' }");
    expect(source).toMatch(/activeId === 'notice-component' \? \(\s*<NoticeComponentMockupsContent \/>/);
  });

  it('renders five notice cards and five toasts with distinct treatments and dismiss controls', () => {
    const markup = renderToStaticMarkup(createElement(NoticeComponentMockupsContent));
    const studies = Array.from(markup.matchAll(/data-notice-study="([^"]+)"/g), match => match[1]);
    expect(studies).toHaveLength(10);
    expect(new Set(studies).size).toBe(10);
    expect(markup.match(/data-testid="notice-card"/g)).toHaveLength(5);
    expect(markup.match(/class="dd-toast dd-toast--/g)).toHaveLength(5);
    expect(markup.match(/aria-label="Dismiss /g)).toHaveLength(10);
    expect(markup.match(/dd-control-button--primary/g)).toHaveLength(2);
  });
});
