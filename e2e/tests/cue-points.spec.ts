import { test, expect } from '../fixtures';

test.describe('Cue Points integrated hardening', () => {
  test('final workstation keeps transport, filters, focus, and narrow desktop overflow deterministic', async ({ dropdex }) => {
    await dropdex.setViewportSize({ width: 1280, height: 800 });
    await dropdex.goto('/cues');

    await expect(dropdex.getByTestId('cue-points-workstation')).toBeVisible();
    await expect(dropdex.getByTestId('cue-browser-command-bar')).toBeVisible();
    await expect(dropdex.getByTestId('cue-audio-dock')).toBeVisible();
    await expect(dropdex.getByTestId('cue-browser-track-table')).toBeVisible();

    const transport = dropdex.getByRole('group', { name: 'Cue Points transport controls' });
    await expect(transport.getByRole('button', { name: 'Previous track' })).toBeDisabled();
    await expect(transport.getByRole('button', { name: 'Rewind' })).toBeDisabled();
    await expect(transport.getByRole('button', { name: 'Play' })).toBeDisabled();
    await expect(transport.getByRole('button', { name: 'Fast forward' })).toBeDisabled();
    await expect(transport.getByRole('button', { name: 'Next track' })).toBeDisabled();

    const minimumBpm = dropdex.getByRole('slider', { name: 'Minimum BPM' });
    await minimumBpm.focus();
    await expect(minimumBpm).toBeFocused();
    await expect(minimumBpm).toHaveAttribute('aria-valuenow', '124');
    await dropdex.keyboard.press('ArrowRight');
    await expect(minimumBpm).toHaveAttribute('aria-valuenow', '125');

    const browserFilters = dropdex.getByTestId('cue-browser-filters');
    const statusFilter = browserFilters.getByRole('button', { name: /Status/i });
    await statusFilter.click();
    const statusOptions = dropdex.getByRole('listbox', { name: 'Status filter options' });
    await expect(statusOptions).toBeVisible();
    await expect(dropdex.getByRole('option', { name: 'All', exact: true })).toBeFocused();
    await dropdex.keyboard.press('End');
    await dropdex.keyboard.press('Enter');
    await expect(statusFilter).toBeFocused();

    const applyTrigger = dropdex.getByRole('button', { name: 'Open Apply menu' });
    await applyTrigger.click();
    await expect(dropdex.getByRole('menu', { name: 'Cue draft and Apply actions' })).toBeVisible();
    await dropdex.keyboard.press('Escape');
    await expect(applyTrigger).toBeFocused();

    const sourceSwitcher = dropdex.getByRole('group', { name: 'Cue Points browser source' });
    await sourceSwitcher.getByRole('button', { name: 'Playlists', exact: true }).click();
    await expect(dropdex.getByLabel('Select Rekordbox playlist')).toBeVisible();
    await expect(dropdex.getByTestId('cue-browser-track-table')).toBeVisible();

    const documentFitsViewport = await dropdex.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(documentFitsViewport).toBe(true);
  });
});
