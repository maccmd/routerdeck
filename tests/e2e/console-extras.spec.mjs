// UPnP, Dynamic DNS and Queues against the simulated router.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }, info) => {
 test.skip(info.project.use.viewport.width < 1280, 'The console targets desktop work areas');
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
 page.consoleErrors = errors;
 await page.goto('/routerdeck/');
 await page.evaluate(() => localStorage.clear());
 await page.getByLabel('Password', { exact: true }).fill('routerdeck');
 await page.getByRole('button', { name: 'Connect' }).click();
 await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
});
test.afterEach(async ({ page }) => expect(page.consoleErrors ?? []).toEqual([]));

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ hasText: text });
async function open(page, ...labels) {
 for (const label of labels) await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('UPnP settings, live mappings and rules', async ({ page }) => {
 await open(page, 'IP', 'UPnP');
 const upnp = win(page, 'UPnP');
 await expect(upnp.getByLabel('Enabled:')).toBeChecked();
 await upnp.getByRole('tab', { name: 'Mappings' }).click();
 await expect(row(upnp, 'Game console')).toContainText('never');
 await upnp.getByRole('tab', { name: 'Settings' }).click();
 await upnp.getByLabel('Enabled:').uncheck();
 await upnp.getByRole('button', { name: 'Apply' }).click();
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Change UPnP settings');
 await upnp.getByRole('tab', { name: 'Mappings' }).click();
 await expect(upnp.locator('.rd-grid-row')).toHaveCount(0);
 await upnp.getByRole('tab', { name: 'Rules' }).click();
 await expect(upnp.locator('.rd-grid-comment')).toHaveText([';;; Allow high ports', ';;; Default deny']);
});

test('Dynamic DNS shows the registered address; Queues shape the WAN', async ({ page }) => {
 await open(page, 'IP', 'Dynamic DNS');
 const ddns = win(page, 'Dynamic DNS');
 await expect(row(ddns, 'home')).toContainText('203.0.113.42');
 await expect(row(ddns, 'home').locator('.is-flags')).toHaveText('R');
 await ddns.getByRole('button', { name: 'Add', exact: true }).click();
 const service = win(page, 'New Dynamic DNS Service');
 await service.getByLabel('Name:', { exact: true }).fill('office');
 await service.getByLabel('Provider:').selectOption('cloudflare.com-v4');
 await service.getByLabel('Domain:').fill('office.example.org');
 await service.getByLabel('Password:', { exact: true }).fill('api-token');
 await service.getByRole('button', { name: 'OK' }).click();
 await expect(row(ddns, 'office')).toContainText('cloudflare.com-v4');
 await row(ddns, 'office').click();
 await ddns.getByRole('button', { name: 'Update Now' }).click();
 await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText('Updating office');

 await open(page, 'Queues');
 const queues = win(page, 'Queues');
 await expect(row(queues, 'eth0')).toContainText('85 Mbps');
 await expect(row(queues, 'eth0').locator('.is-flags')).toHaveText('R');
 await row(queues, 'eth0').click();
 await page.keyboard.press('Control+d');
 await expect(row(queues, 'eth0').locator('.is-flags')).toHaveText('X');
});
