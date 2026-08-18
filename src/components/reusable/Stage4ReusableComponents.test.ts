import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseAppRoute, routeToUrl } from '../../navigation/appRoutes';
import {
  Artwork,
  Avatar,
  Divider,
  PlaylistCard,
  SidebarNavItem,
  StatTile,
  TabNavigation,
  Typography,
  ViewModeNavigation,
} from '../ui/display';
import { Stage4Showcase } from './Stage4Showcase';

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe('Stage 4 reusable display primitives', () => {
  it('renders loaded and explicit fallback artwork without losing alt semantics', () => {
    const loaded = render(React.createElement(Artwork, {
      src: '/artwork/stage4-demo-artwork.svg',
      alt: 'Demo artwork',
    }));
    expect(loaded).toContain('data-artwork-state="image"');
    expect(loaded).toContain('src="/artwork/stage4-demo-artwork.svg"');
    expect(loaded).toContain('alt="Demo artwork"');

    const fallback = render(React.createElement(Artwork, {
      src: null,
      alt: 'Missing track artwork',
      fallbackTitle: 'No Artwork',
      fallbackDescription: 'Track unavailable',
    }));
    expect(fallback).toContain('data-artwork-state="fallback"');
    expect(fallback).toContain('aria-label="Missing track artwork"');
    expect(fallback).toContain('No Artwork');
    expect(fallback).toContain('Track unavailable');
  });

  it('renders avatar initials/icon fallbacks and preserves image alt text', () => {
    const initials = render(React.createElement(Avatar, { initials: 'DM', alt: 'Deep Motion', ring: 'blue' }));
    expect(initials).toContain('data-avatar-state="initials"');
    expect(initials).toContain('aria-label="Deep Motion"');
    expect(initials).toContain('DM');
    expect(initials).toContain('dd-avatar--ring-blue');

    const icon = render(React.createElement(Avatar, { alt: 'Profile fallback' }));
    expect(icon).toContain('data-avatar-state="icon"');
    expect(icon).toContain('aria-label="Profile fallback"');

    const image = render(React.createElement(Avatar, { src: '/artwork/stage4-avatar.svg', alt: 'DJ profile' }));
    expect(image).toContain('data-avatar-state="image"');
    expect(image).toContain('alt="DJ profile"');
  });

  it('keeps card data resilient to empty/large values and long titles', () => {
    const emptyKpi = render(React.createElement(StatTile, { label: 'Empty KPI', value: '' }));
    expect(emptyKpi).toContain('Empty KPI');
    expect(emptyKpi).toContain('—');
    expect(emptyKpi).not.toContain('NaN');

    const largeKpi = render(React.createElement(StatTile, {
      label: 'Large KPI',
      value: '123,456,789,012',
      chartValues: [0, Number.NaN, 1_000_000],
    }));
    expect(largeKpi).toContain('123,456,789,012');
    expect(largeKpi).not.toContain('NaN%');

    const longTitle = 'A deliberately very long playlist title that must remain safely constrained in compact layouts';
    const playlist = render(React.createElement(PlaylistCard, {
      title: longTitle,
      subtitle: 'A deliberately very long artist name that must remain safely constrained too',
      actionLabel: 'Open playlist',
      onAction: () => undefined,
      items: [{ id: 'one', title: longTitle, artist: longTitle, meta: '8A' }],
    }));
    expect(playlist).toContain(`title="${longTitle}"`);
    expect(playlist).toContain('dd-playlist-card__title');
  });

  it('provides semantic typography, dividers, and controlled navigation selection', () => {
    expect(render(React.createElement(Typography, { variant: 'h1' }, 'Heading'))).toContain('<h1');
    expect(render(React.createElement(Typography, { variant: 'mono' }, 'BPM = 128'))).toContain('<code');
    expect(render(React.createElement(Typography, { variant: 'brand', gradient: true }, 'Elevate'))).toContain('dd-type--gradient');
    expect(render(React.createElement(Divider, { variant: 'accent' }))).toContain('role="separator"');

    const sidebar = render(React.createElement(SidebarNavItem, {
      label: 'Collection',
      icon: React.createElement('span', null, 'icon'),
      selected: true,
    }));
    expect(sidebar).toContain('aria-pressed="true"');
    expect(sidebar).toContain('data-selected="true"');

    const currentRouteSidebar = render(React.createElement(SidebarNavItem, {
      label: 'Collection',
      icon: React.createElement('span', null, 'icon'),
      selected: true,
      currentRoute: true,
    }));
    expect(currentRouteSidebar).toContain('aria-current="page"');
    expect(currentRouteSidebar).not.toContain('aria-pressed');

    const tabs = render(React.createElement(TabNavigation, {
      value: 'tracks',
      options: [{ id: 'playlists', label: 'Playlists' }, { id: 'tracks', label: 'Tracks' }],
      onChange: () => undefined,
      ariaLabel: 'Library tabs',
    }));
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('aria-selected="true"');
    expect(tabs).toContain('tabindex="0"');

    const views = render(React.createElement(ViewModeNavigation, {
      value: 'grid',
      options: [{ id: 'grid', label: 'Grid' }, { id: 'list', label: 'List' }],
      onChange: () => undefined,
      ariaLabel: 'View mode',
    }));
    expect(views).toContain('role="radiogroup"');
    expect(views).toContain('aria-checked="true"');
  });
});

describe('Reusable Components Stage 4 route', () => {
  it('resolves the real route and renders every Stage 4 family through shared primitives', () => {
    const route = parseAppRoute('/reusable-components');
    expect(route).toEqual({ name: 'reusable-components' });
    expect(routeToUrl(route)).toBe('/reusable-components');

    const markup = render(React.createElement(Stage4Showcase));
    expect(markup).toContain('data-testid="stage4-component-board"');
    for (const label of [
      'Glass Card',
      'Surface Card',
      'Stat Tile / KPI',
      'Playlist Card',
      'Artwork / Thumbnail',
      'Artwork With Fallback',
      'Avatar — Initials',
      'Avatar — Icon Fallback',
      'Avatar With Ring',
      'Image Avatar',
      'Headings',
      'Body & Muted Text',
      'Mono / Code Text',
      'Brand / Accent Text',
      'Brand Gradient Text',
      'Divider',
      'Sidebar Nav Items',
      'Tab Navigation',
    ]) {
      expect(markup).toContain(`data-stage4-card="${label}"`);
    }
    expect(markup).toContain('dd-display-card');
    expect(markup).toContain('dd-tab-nav');
    expect(markup).toContain('dd-view-mode-nav');
  });
});
