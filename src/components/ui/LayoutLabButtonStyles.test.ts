import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UiComponentsContent } from './LayoutLabUiComponents';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const markup = renderToStaticMarkup(createElement(UiComponentsContent));
const css = read('./layout-lab-buttons.css');
const row = (id: string) => {
  const marker = markup.indexOf(`data-testid="${id}"`);
  return markup.slice(markup.lastIndexOf('<section', marker), markup.indexOf('</section>', marker));
};

const card = (rowId: string, lookId: string) => row(rowId).split('data-look="').find(look => look.startsWith(`${lookId}"`));

describe('Layout Lab UI Components: button rows', () => {
  it('has a primary row of five looks, with the secondary row of five under it, both below the sliders', () => {
    expect(row('primary-button-row').match(/data-testid="button-look"/g)).toHaveLength(5);
    expect(row('secondary-button-row').match(/data-testid="button-look"/g)).toHaveLength(5);
    expect(markup.indexOf('primary-button-row')).toBeLessThan(markup.indexOf('secondary-button-row'));
    expect(markup.indexOf('primary-button-row')).toBeGreaterThan(markup.lastIndexOf('Glow Capsule'));
  });

  it('renders the production components in primary 03 and secondary 02', () => {
    const primary = card('primary-button-row', 'p3');
    const secondary = card('secondary-button-row', 's2');
    expect(primary).toContain('Raised Plate (in use)');
    expect(secondary).toContain('Raised Plate (in use)');
    expect(primary?.match(/dd-control-button--primary/g)).toHaveLength(2);
    expect(secondary?.match(/dd-control-button--secondary/g)).toHaveLength(2);
    for (const id of ['p1', 'p2', 'p4', 'p5', 's1', 's3', 's4', 's5']) {
      expect(css, id).toContain(`.lb-${id} {`);
      expect(markup, id).toContain(`lb-btn lb-${id}`);
    }
    for (const id of ['p1', 'p2', 'p4', 'p5']) expect(row('secondary-button-row')).not.toContain(`lb-${id}`);
  });

  it('shows each button next to a disabled copy', () => {
    for (const id of ['primary-button-row', 'secondary-button-row']) expect(row(id).match(/disabled=""/g)).toHaveLength(5);
  });

  it('adds the same five Filled Disc treatments in separate primary and secondary rows', () => {
    const primary = row('primary-filled-disc-row');
    const secondary = row('secondary-filled-disc-row');
    const treatments = ['vertical-fade', 'reverse-sweep', 'satin-sheen', 'deep-gradient', 'soft-capsule'];

    expect(markup.indexOf(primary)).toBeGreaterThan(markup.indexOf('secondary-button-row'));
    expect(markup.indexOf(secondary)).toBeGreaterThan(markup.indexOf(primary));
    expect(primary).toContain('lb-filled-disc-row--primary');
    expect(secondary).toContain('lb-filled-disc-row--secondary');
    for (const [section, label] of [[primary, 'Import Library'], [secondary, 'Choose USB']]) {
      expect(Array.from(section.matchAll(/data-look="([^"]+)"/g), match => match[1])).toEqual(treatments);
      expect(section.match(/disabled=""/g)).toHaveLength(5);
      expect(section.match(new RegExp(label, 'g'))).toHaveLength(10);
    }
  });

  it('keeps the primary alternatives in coral and the secondary ones free of it', () => {
    const block = (id: string) => css.match(new RegExp(`\\.lb-${id} \\{[^}]*\\}`))?.[0] ?? '';
    for (const id of ['p1', 'p2', 'p4', 'p5']) expect(block(id), id).toMatch(/--color-control-primary|#f56b70|#f78361|#f54b64/);
    for (const id of ['s1', 's3', 's4', 's5']) expect(block(id), id).not.toMatch(/--color-control-primary|#f56b70|#f78361|#f54b64/i);
    // Same type as the primary: light, capitals, 0.1em.
    expect(css).toMatch(/\.lb-btn \{[^}]*font-weight: 300; letter-spacing: \.1em;[^}]*text-transform: uppercase;/);
  });
});
