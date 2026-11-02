import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UsbManagementView } from './UsbManagementView';
import { parseAppRoute, routeBackFallback, routeToUrl } from '../../navigation/appRoutes';

const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

describe('USB Management page', () => {
  it('is blank for now', () => {
    const markup = renderToStaticMarkup(createElement(UsbManagementView));
    expect(markup).toContain('data-testid="usb-management-view"');
    expect(markup).not.toMatch(/<(h\d|p|button|input|table)/);
    // only the empty container: no text between tags
    expect(markup.replace(/<[^>]+>/g, '')).toBe('');
  });

  it('has its own address, and Back returns to the library', () => {
    expect(parseAppRoute('/usb', '')).toEqual({ name: 'usb' });
    expect(routeToUrl({ name: 'usb' })).toBe('/usb');
    expect(routeBackFallback({ name: 'usb' })).toEqual({ name: 'library', tab: 'overview', search: '' });
  });

  it('appears in the left nav with its own page name header and is shown on its route', () => {
    expect(appSource).toContain("{ view: 'usb', icon: Usb, label: 'USB Management'");
    expect(appSource).toContain("case 'usb': return titledPage('USB Management');");
    expect(appSource).toContain("case 'usb': navigate({ name: 'usb' }); break;");
    expect(appSource).toContain("currentView === 'usb' && (");
    expect(appSource).toContain('<UsbManagementView />');
  });
});
