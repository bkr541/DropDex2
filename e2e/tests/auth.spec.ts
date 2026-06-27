import { test, expect } from '@playwright/test';

test.describe('Authentication startup and magic-link UI', () => {
  test('anonymous initialization reaches the sign-in screen', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  test('magic-link failure shows an inline error and re-enables submission', async ({ page }) => {
    await page.route('**/auth/v1/otp*', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Email provider is temporarily unavailable' }),
      });
    });
    await page.goto('/');

    await page.getByLabel('Email address').fill('listener@example.com');
    const submit = page.getByRole('button', { name: 'Continue' });
    await submit.click();

    await expect(page.getByRole('alert')).toContainText('Email provider is temporarily unavailable');
    await expect(submit).toBeEnabled();
  });

  test('successful magic-link submission preserves the check-email screen', async ({ page }) => {
    await page.route('**/auth/v1/otp*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });
    await page.goto('/');

    await page.getByLabel('Email address').fill('listener@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByText('listener@example.com')).toBeVisible();
  });
});
