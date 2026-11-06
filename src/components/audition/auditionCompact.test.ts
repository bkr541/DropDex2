import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./AuditionView.css');
const header = read('./AuditionTrackHeader.tsx');
const song = read('./AuditionFullSong.tsx');
const library = read('./AuditionLibrary.tsx');
const app = read('../../App.tsx');

describe('compact Audition layout', () => {
  it('uses smaller display sizes: a 20px title, 26px length, 48px cover and a 72px waveform', () => {
    expect(css).toMatch(/\.audition-header h2 \{[^}]*font-size: 20px/);
    expect(css).toMatch(/\.audition-duration > span \{[^}]*font-size: 26px/);
    expect(css).toMatch(/\.audition-cover \{[^}]*width: 48px; height: 48px/);
    expect(song).toContain('const WAVEFORM_HEIGHT = 72;');
  });

  it('has tighter spacing: 16px page padding, 40px table rows and 32px filter controls', () => {
    expect(css).toMatch(/\.audition-header \{[^}]*padding: 14px 16px/);
    expect(css).toMatch(/tbody td \{[^}]*height: 40px/);
    expect(css).toMatch(/thead th \{[^}]*padding-block: 7px/);
    expect(css).toMatch(/\.dd-text-control \{[^}]*min-height: 32px/);
    expect(css).toMatch(/\.audition-song-transport \{[^}]*padding: 6px 16px/);
  });

  it('keeps the smallest labels readable: nothing below 9px', () => {
    const sizes = [...css.matchAll(/font-size: (\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(9);
  });

  it('drops the eyebrow, and folds the Full Song and Library heading rows into a caption and the filter row', () => {
    expect(header).not.toContain('Listening room');
    expect(css).not.toContain('.audition-eyebrow');
    expect(css).not.toContain('.audition-song-heading');
    expect(css).not.toContain('.audition-library-heading');
    expect(song).toContain('className="audition-song-caption"');
    expect(library.indexOf('audition-library-filters')).toBeLessThan(library.indexOf('data-testid="audition-library-count"'));
    expect(library).not.toContain('audition-library-heading');
  });

  it('puts the artist and the tempo, key and genre on one line under the title', () => {
    expect(header).toContain('<div className="audition-meta">');
    expect(css).toMatch(/\.audition-meta \{[^}]*display: flex/);
  });

  it('lets the track list fill the rest of the window instead of a fixed height', () => {
    expect(css).toMatch(/\.audition-studio \{[^}]*height: calc\(100vh - 3rem\)/);
    expect(css).toMatch(/\.audition-table-scroll \{[^}]*flex: 1 1 auto/);
    expect(library).not.toContain('max-h-[calc(100vh-18rem)]');
  });

  it('hides the app\'s bottom player bar on the Audition page, since it has its own transport', () => {
    expect(app).toContain("{currentView !== 'audition' && <NowPlayingBar className=\"hidden md:flex shrink-0\" />}");
    expect(app).toContain("{currentView !== 'audition' && <NowPlayingBar className=\"md:hidden fixed bottom-0 left-0 right-0 z-50\" />}");
  });
});
