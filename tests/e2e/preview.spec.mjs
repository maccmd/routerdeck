import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
 page.routerdeckErrors = errors;
 await page.goto('/');
 await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
});
test.afterEach(async ({ page }) => expect(page.routerdeckErrors).toEqual([]));

async function navigation(page) {
 if (await page.getByRole('button', { name: 'Toggle navigation' }).isVisible()) await page.getByRole('button', { name: 'Toggle navigation' }).click();
}
async function noOverflow(page) {
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test('dashboard, dark/light persistence and responsive screenshots', async ({ page }, info) => {
 await mkdir('output/playwright/screenshots', { recursive: true });
 await noOverflow(page);
 await expect(page.getByText('Simulated data. Changes stay in this browser; no router is connected.')).toBeVisible();
 await page.screenshot({ animations:'disabled', path: `output/playwright/screenshots/preview-dark-${info.project.name}.png`, fullPage: true });
 await page.getByRole('button', { name: 'Switch to light theme' }).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
 await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
 await page.screenshot({ animations:'disabled', path: `output/playwright/screenshots/preview-light-${info.project.name}.png`, fullPage: true });
 await noOverflow(page);
});

test('menu search, interface modal, validation and table scrolling', async ({ page }, info) => {
 await navigation(page);
 await page.getByRole('searchbox', { name: 'Find a page', exact: true }).fill('interface');
 await expect(page.getByRole('link', { name: 'Dashboard', exact: false })).toBeHidden();
 await page.locator('#rd-navigation').getByRole('link', { name: 'Interfaces', exact: true }).click();
 await expect(page).toHaveURL(/#interfaces$/);
 await expect(page.locator('.rd-window')).toHaveCount(0);
 const frame = page;
 await expect(frame.getByRole('heading', { name: 'Interfaces', exact: true })).toBeVisible();
 await frame.getByRole('button', { name: 'Edit lan', exact: true }).click();
 await expect(frame.getByRole('dialog')).toBeVisible();
 await frame.getByLabel('Interface name', { exact: true }).fill('bad name');
 await frame.getByRole('button', { name: 'Save preview', exact: true }).click();
 await expect(frame.getByRole('dialog')).toBeVisible();
 await frame.getByLabel('Interface name', { exact: true }).fill('lan_test');
 await page.screenshot({ animations:'disabled', path: `output/playwright/screenshots/modal-${info.project.name}.png` });
 await frame.getByRole('button', { name: 'Save preview', exact: true }).click();
 await expect(frame.getByRole('dialog')).toHaveCount(0);
 await expect(frame.getByRole('cell', { name: 'lan_test', exact: true })).toBeVisible();
 await noOverflow(page);
});

test('form save and literal hostile hostname', async ({ page }) => {
 await navigation(page);
 await page.getByRole('link', { name: 'System settings', exact: false }).click();
 const frame = page;
 await frame.getByLabel('Hostname', { exact: true }).fill('preview-router');
 await frame.getByRole('button', { name: 'Save preview', exact: true }).click();
 await expect(frame.locator('.rd-device strong')).toHaveText('preview-router');
 await navigation(page);
 await page.locator('#rd-navigation').getByRole('link', { name: 'Dashboard', exact: true }).click();
 await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
 await page.evaluate(() => {
  document.getElementById('preview-view').replaceChildren(RouterDeck.dashboard({ hostname: '<img src=x onerror=alert(1)>', leases: [{ hostname: '<script>window.pwned=true</script>', ip: '192.0.2.1' }] }));
 });
 await expect(page.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible();
 expect(await page.locator('#preview-view script, #preview-view img').count()).toBe(0);
 await noOverflow(page);
});
