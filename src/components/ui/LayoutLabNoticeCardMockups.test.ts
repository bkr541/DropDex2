import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NoticeCard } from './feedback/NoticeCard';
import { NoticeCardMockupsContent } from './LayoutLabNoticeCardMockups';
import { NOTICES, SURFACE_NOTICES } from './layoutLabNoticeData';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const markup = renderToStaticMarkup(createElement(NoticeCardMockupsContent));
const decode = (html: string) => html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

describe('NoticeCard', () => {
  it('announces errors and warnings at once, and the rest politely', () => {
    const role = (tone: 'error' | 'warning' | 'info' | 'success' | 'neutral') => renderToStaticMarkup(createElement(NoticeCard, { tone, children: 'x' })).match(/role="(\w+)"/)?.[1];
    expect(['error', 'warning'].map((t) => role(t as 'error'))).toEqual(['alert', 'alert']);
    expect(['info', 'success', 'neutral'].map((t) => role(t as 'info'))).toEqual(['status', 'status', 'status']);
  });

  it('shows an eyebrow, title, message, action and close only when given', () => {
    const bare = renderToStaticMarkup(createElement(NoticeCard, { children: 'Just a message' }));
    for (const part of ['nc-eyebrow', 'nc-title', 'nc-action', 'nc-dismiss']) expect(bare).not.toContain(part);
    const full = renderToStaticMarkup(createElement(NoticeCard, { tone: 'warning', eyebrow: 'USB', title: 'Heads up', action: 'Go', onDismiss: () => undefined, children: 'Message' }));
    for (const part of ['nc-eyebrow', 'nc-title', 'nc-action', 'nc-dismiss', 'aria-label="Dismiss"']) expect(full).toContain(part);
  });

  it('is the graphite card: slate gradient, grain, lit rim, hairline edge, tinted left edge, sunk icon well', () => {
    const css = read('./feedback/notice-card.css');
    expect(css).toContain('linear-gradient(165deg, #2c303b 0%, #232731 40%, #1c2029 100%)');
    expect(css).toContain('repeating-linear-gradient(0deg, #ffffff05 0 1px');
    expect(css).toMatch(/\.nc \{[^}]*inset 0 1px 0 #ffffff12[^}]*inset 2px 0 0 var\(--nc-ink\)/s);
    expect(css).toMatch(/\.nc-icon \{[^}]*inset 0 2px 6px/s);
    expect(css).toMatch(/\.nc-eyebrow \{[^}]*font-size: 9px;[^}]*letter-spacing: \.16em/s);
  });
});

describe('Layout Lab Notice Card tab', () => {
  it('is registered as a tab', () => {
    const win = read('./LayoutLabWindow.tsx');
    expect(win).toContain("{ id: 'notice-card', label: 'Notice Card' }");
    expect(win).toContain('<NoticeCardMockupsContent />');
  });

  it('has 25 player notices in four groups of 8, 7, 5 and 5', () => {
    expect(NOTICES).toHaveLength(25);
    const counts = ['usb-state', 'file-lookup', 'audio-decoding', 'player-track'].map((g) => NOTICES.filter((n) => n.group === g).length);
    expect(counts).toEqual([8, 7, 5, 5]);
    expect(new Set(NOTICES.map((n) => n.id)).size).toBe(25);
    expect(markup.match(/data-group="/g)).toHaveLength(4);
  });

  it('uses the real wording from the player, including the one in the screenshots', () => {
    const text = decode(markup);
    expect(text).toContain('USB is disconnected.');
    expect(text).toContain('File not found on USB: Contents/Artist/Track.mp3');
    expect(text).toContain('Unsupported audio format. Convert to MP3 or AAC in Rekordbox.');
    expect(text).toContain('Audio engine not ready.');
    for (const notice of NOTICES) expect(notice.message.length, notice.id).toBeGreaterThan(5);
  });

  it('puts a card for each of the seven other USB notices below the 25', () => {
    expect(SURFACE_NOTICES.map((n) => n.surface)).toEqual(['Top bar USB button', 'USB Management', 'Cloud sync', 'Resume Analysis', 'Drop Lab', 'Flip Lab', 'Cue Points']);
    expect(markup.indexOf('data-testid="notice-surfaces"')).toBeGreaterThan(markup.lastIndexOf('data-group="player-track"'));
    // 5 tone samples + 25 + 7
    expect(markup.match(/data-testid="notice-card"/g)).toHaveLength(5 + 25 + 7);
  });

  it('offers Connect USB on the two states where the Now Playing bar does', () => {
    const connect = NOTICES.filter((n) => n.connectAction).map((n) => n.id);
    expect(connect).toEqual(['usb-unavailable', 'usb-disconnected']);
  });
});
