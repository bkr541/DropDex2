import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UiComponentsContent } from './LayoutLabUiComponents';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const markup = renderToStaticMarkup(createElement(UiComponentsContent));
const css = read('./layout-lab-buttons.css');
const row = (id: string) => markup.slice(markup.indexOf(`data-testid="${id}"`), markup.indexOf('</section>', markup.indexOf(`data-testid="${id}"`)));

describe('Layout Lab UI Components: button rows', () => {
  it('has a primary row of five looks, with the secondary row of five under it, both below the sliders', () => {
    expect(row('primary-button-row').match(/data-testid="button-look"/g)).toHaveLength(5);
    expect(row('secondary-button-row').match(/data-testid="button-look"/g)).toHaveLength(5);
    expect(markup.indexOf('primary-button-row')).toBeLessThan(markup.indexOf('secondary-button-row'));
    expect(markup.indexOf('primary-button-row')).toBeGreaterThan(markup.lastIndexOf('Glow Capsule'));
  });

  it('starts each row with the real component in use, and gives the other four their own look', () => {
    expect(row('primary-button-row')).toContain('dd-control-button--primary');
    expect(row('secondary-button-row')).toContain('dd-control-button--secondary');
    for (const id of ['p2', 'p3', 'p4', 'p5', 's2', 's3', 's4', 's5']) {
      expect(css, id).toContain(`.lb-${id} {`);
      expect(markup, id).toContain(`lb-btn lb-${id}`);
    }
    for (const id of ['p2', 'p3', 'p4', 'p5']) expect(row('secondary-button-row')).not.toContain(`lb-${id}`);
  });

  it('shows each button next to a disabled copy', () => {
    for (const id of ['primary-button-row', 'secondary-button-row']) expect(row(id).match(/disabled=""/g)).toHaveLength(5);
  });

  it('keeps the primary alternatives in coral and the secondary ones free of it', () => {
    const block = (id: string) => css.match(new RegExp(`\\.lb-${id} \\{[^}]*\\}`))?.[0] ?? '';
    for (const id of ['p2', 'p3', 'p4', 'p5']) expect(block(id), id).toMatch(/#f56b70|#f78361|#f54b64/);
    for (const id of ['s2', 's3', 's4', 's5']) expect(block(id), id).not.toMatch(/#f56b70|#f78361|#f54b64/i);
    // Same type as the primary: light, capitals, 0.1em.
    expect(css).toMatch(/\.lb-btn \{[^}]*font-weight: 300; letter-spacing: \.1em;[^}]*text-transform: uppercase;/);
  });
});
