import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TrackIdentity } from './display/TrackIdentity';
import { TrackNameCell, TrackTable, TrackTableBody, TrackTableHead, TrackTableHeadCell, TrackTableRow } from './display/TrackTable';
import { AudioDock } from './media/AudioDock';
import { MediaTransportControlGroup } from './media/MediaTransportControlGroup';
import { PlaybackSeekBar } from './media/PlaybackSeekBar';
import { TimelineBeatLane, TimelineSectionLane } from './media/TimelineLanes';
import { ContextMenu } from './controls/ContextMenu';
import { ToolbarIconButton, ToolbarIconGroup } from './controls/ToolbarIconButton';

const render = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(node);

describe('TrackIdentity', () => {
  const props = {
    title: 'Some Title',
    subtitle: 'Some Artist',
    stats: [
      { label: 'BPM', value: '140.00' },
      { label: 'Key', value: '04A', color: '#f59e0b' },
    ],
  };

  it('shows artwork, title, artist and labeled stats like the Cue Points header', () => {
    const markup = render(createElement(TrackIdentity, props));
    expect(markup).toContain('Some Title');
    expect(markup).toContain('Some Artist');
    expect(markup).toContain('h-9 w-9');
    expect(markup).toContain('rounded-[7px]');
    expect(markup).toMatch(/<span class="uppercase tracking-\[0\.08em\] text-foreground\/45">BPM<\/span><strong class="ml-1 text-foreground\/90">140\.00<\/strong>/);
    expect(markup).toContain('style="color:#f59e0b"');
  });

  it('puts the stats on the artist row, to the right of the artist', () => {
    const markup = render(createElement(TrackIdentity, props));
    expect(markup.indexOf('Some Artist')).toBeLessThan(markup.indexOf('>BPM<'));
    expect(markup).toContain('flex min-w-0 items-center gap-4');
  });

  it('uses the app-wide text when a track has no artist', () => {
    expect(render(createElement(TrackIdentity, { title: 'T', subtitle: null }))).toContain('Artist Not Available');
  });

  it('can mirror itself: title on top, then the stats beside the artist, with the artwork on the right', () => {
    const markup = render(createElement(TrackIdentity, { ...props, align: 'right', artworkSrc: '/a.png' }));
    expect(markup.indexOf('<h2')).toBeLessThan(markup.indexOf('>BPM<'));
    expect(markup.indexOf('>BPM<')).toBeLessThan(markup.indexOf('Some Artist'));
    expect(markup.indexOf('Some Artist')).toBeLessThan(markup.indexOf('<img'));
    expect(markup).toContain('justify-end');
    expect(markup).toContain('text-right');
    expect(markup).toContain('flex min-w-0 items-center justify-end gap-4');
  });

  it('supports a caption and the heading level', () => {
    const markup = render(createElement(TrackIdentity, { ...props, caption: 'Selected track', as: 'h1' }));
    expect(markup).toContain('Selected track');
    expect(markup).toMatch(/<h1 /);
  });

  it('falls back to an empty title', () => {
    expect(render(createElement(TrackIdentity, { title: null }))).toContain('No track selected');
  });
});

describe('Track table parts', () => {
  const sort = { column: 'bpm', direction: 'desc' } as const;
  const table = render(createElement(
    TrackTable,
    { 'aria-label': 'Tracks' },
    createElement(TrackTableHead, null,
      createElement(TrackTableHeadCell, { label: 'Track', column: 'title', sort, onSort: vi.fn() }),
      createElement(TrackTableHeadCell, { label: 'BPM', column: 'bpm', sort, onSort: vi.fn() }),
      createElement(TrackTableHeadCell, { label: 'Why', sticky: false }),
    ),
    createElement(TrackTableBody, null,
      createElement(TrackTableRow, { selected: true }, createElement(TrackNameCell, { title: 'Row Title', artist: null, selected: true, status: 'ready' })),
      createElement(TrackTableRow, { selected: false }, createElement(TrackNameCell, { title: 'Other', artist: 'Someone', status: 'warning' })),
    ),
  ));

  it('uses the Cue Points table, row and selection classes', () => {
    expect(table).toContain('cue-browser__table');
    expect(table).toContain('cue-browser__row ');
    expect(table).toContain('cue-browser__row--selected');
    expect(table.match(/cue-browser__row--selected/g)).toHaveLength(1);
    expect(table).toContain('divide-y');
  });

  it('marks the sorted column and offers sorting only where a column is given', () => {
    expect(table).toContain('aria-sort="descending"');
    expect(table).toContain('aria-label="Sort by BPM"');
    expect(table).not.toContain('aria-label="Sort by Why"');
    expect(table.match(/aria-sort=/g)).toHaveLength(1);
  });

  it('shows columns that cannot be sorted in the same case as the ones that can', () => {
    const cells = table.match(/<th [^>]*>/g) ?? [];
    expect(cells[0]).not.toContain('normal-case');
    expect(cells[2]).toContain('normal-case');
  });

  it('can leave the header out of sticky positioning', () => {
    const cells = table.match(/<th [^>]*>/g) ?? [];
    expect(cells[0]).toContain('sticky');
    expect(cells[2]).not.toContain('sticky');
  });

  it('shows a name cell with a status dot, selection bar, 36px artwork and the app-wide missing-artist text', () => {
    expect(table).toContain('bg-emerald-400');
    expect(table).toContain('bg-amber-400');
    expect(table).toContain('bg-primary');
    expect(table).toContain('h-9 w-9');
    expect(table).toContain('Artist Not Available');
    expect(table).toContain('Someone');
  });
});

describe('Dense track name cell', () => {
  const cell = (dense: boolean) => render(createElement(TrackNameCell, { title: 'T', artist: 'A', dense }));

  it('makes the artwork as tall as the title and artist lines together (30px), instead of 36px', () => {
    expect(cell(true)).toContain('h-[30px] w-[30px]');
    expect(cell(true)).not.toContain('h-9 w-9');
    expect(cell(false)).toContain('h-9 w-9');
    expect(cell(false)).not.toContain('h-[30px]');
  });
});

describe('Timeline lanes', () => {
  it('draws section names in mono caps with a 2px colored underline and a gray trailing bar', () => {
    const markup = render(createElement(TimelineSectionLane, {
      sections: [{ id: 'a', label: 'Build', color: '#ff8614', leftPercent: 0, widthPercent: 40 }],
      trailing: { leftPercent: 40, widthPercent: 60 },
    }));
    expect(markup).toContain('cue-timeline__data-lane h-[28px]');
    expect(markup).toContain('>BUILD<');
    expect(markup).toContain('border-bottom:2px solid #ff8614');
    expect(markup).toContain('rgba(255,255,255,0.28)');
    expect(markup).toContain('left:40%;width:60%');
  });

  it('shows a message in place of the sections', () => {
    const markup = render(createElement(TimelineSectionLane, { sections: [], message: createElement('p', null, 'Sections unavailable') }));
    expect(markup).toContain('Sections unavailable');
    expect(markup).not.toContain('data-testid="timeline-section"');
  });

  it('draws tall red bar ticks, short green beat ticks and centered numbers', () => {
    const markup = render(createElement(TimelineBeatLane, {
      ticks: [
        { key: 'a', leftPercent: 0, downbeat: true },
        { key: 'b', leftPercent: 25, downbeat: false },
      ],
      labels: [{ key: 'l', leftPercent: 25, text: 1 }],
    }));
    expect(markup).toContain('cue-timeline__data-lane h-[34px]');
    expect(markup).toContain('h-[14px] w-[2px] bg-[#f87171]');
    expect(markup).toContain('h-[8px] w-[1.5px] bg-[#4ade80]');
    expect(markup).toMatch(/<span class="absolute bottom-\[3px\] font-mono text-\[10px\][^"]*-translate-x-1\/2" style="left:25%">1<\/span>/);
  });

  it('keeps the first and last numbers inside the lane', () => {
    const markup = render(createElement(TimelineBeatLane, {
      ticks: [],
      labels: [
        { key: 'first', leftPercent: 0, text: '−8' },
        { key: 'mid', leftPercent: 50, text: '1' },
        { key: 'last', leftPercent: 100, text: '8' },
      ],
    }));
    const spans = markup.match(/<span[^>]*>/g) ?? [];
    expect(spans[0]).not.toContain('translate-x');
    expect(spans[1]).toContain('-translate-x-1/2');
    expect(spans[2]).toContain('-translate-x-full');
  });

  it('shows a message in place of the beat ruler', () => {
    const markup = render(createElement(TimelineBeatLane, { ticks: [], labels: [], message: createElement('p', null, 'No beat grid') }));
    expect(markup).toContain('No beat grid');
    expect(markup).not.toContain('bg-[#f87171]');
  });
});

describe('PlaybackSeekBar', () => {
  it('shows elapsed and total time with a working slider when seekable', () => {
    const markup = render(createElement(PlaybackSeekBar, { currentSeconds: 65, durationSeconds: 150, seekable: true, onSeek: vi.fn(), ariaLabel: 'Position' }));
    expect(markup).toContain('1:05');
    expect(markup).toContain('2:30');
    expect(markup).toContain('value="65"');
    expect(markup).not.toContain('disabled=""');
  });

  it('rests at the start and is dimmed when nothing can be sought', () => {
    const markup = render(createElement(PlaybackSeekBar, { currentSeconds: 65, durationSeconds: 150, seekable: false, ariaLabel: 'Position' }));
    expect(markup).toContain('value="0"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('disabled:opacity-40');
  });

  it('can show progress it does not let the user drag', () => {
    const markup = render(createElement(PlaybackSeekBar, { currentSeconds: 12, durationSeconds: 24, seekable: false, readOnly: true, ariaLabel: 'Position' }));
    expect(markup).toContain('value="12"');
    expect(markup).toContain('pointer-events-none');
    expect(markup).not.toContain('disabled:opacity-40');
  });

  it('shows a dash when the length is not known', () => {
    const markup = render(createElement(PlaybackSeekBar, { currentSeconds: 0, durationSeconds: 0, seekable: false, ariaLabel: 'Position' }));
    expect(markup).toContain('—');
  });
});

describe('MediaTransportControlGroup play-only mode', () => {
  const base = { playing: false, onTogglePlay: vi.fn(), compact: true };

  it('keeps the full five-button capsule by default', () => {
    const markup = render(createElement(MediaTransportControlGroup, base));
    expect(markup.match(/<button/g)).toHaveLength(5);
  });

  it('shows only the play button, with its own label and icon, when asked', () => {
    const markup = render(createElement(MediaTransportControlGroup, { ...base, playOnly: true, playLabel: 'Play transition', playIcon: createElement('i', { 'data-testid': 'icon' }) }));
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Play transition"');
    expect(markup).toContain('data-testid="icon"');
    expect(markup).toContain('dd-media-transport-group');
  });
});

describe('AudioDock and toolbar icons', () => {
  it('renders the dock band with its region role', () => {
    const markup = render(createElement(AudioDock, { 'aria-label': 'Dock', className: 'flex-row' }, 'x'));
    expect(markup).toContain('cue-audio-dock');
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Dock"');
  });

  it('renders icon-only buttons in the Cue Points action style', () => {
    const markup = render(createElement(ToolbarIconGroup, { children: createElement(ToolbarIconButton, { label: 'Back', children: 'i' }) }));
    expect(markup).toContain('cue-workstation__actions');
    expect(markup).toContain('cue-action-icon');
    expect(markup).toContain('aria-label="Back"');
    expect(markup).toContain('title="Back"');
  });
});

describe('ContextMenu', () => {
  it('lists its items as menu items, with hints and disabled state', () => {
    const markup = render(createElement(ContextMenu, {
      x: 10, y: 20, ariaLabel: 'Load track', onClose: vi.fn(),
      items: [
        { id: 'a', label: 'Load As Build', hint: 'Left', onSelect: vi.fn() },
        { id: 'b', label: 'Load As Drop', disabled: true, onSelect: vi.fn() },
      ],
    }));
    expect(markup).toContain('role="menu"');
    expect(markup).toContain('aria-label="Load track"');
    expect(markup.match(/role="menuitem"/g)).toHaveLength(2);
    expect(markup).toContain('Load As Build');
    expect(markup).toContain('Left');
    expect(markup).toMatch(/disabled=""[^>]*>[^<]*<span>Load As Drop/);
    expect(markup).toContain('border-[#34414b] bg-[#11181e]');
  });
});
