// Bandwidth Test, IP Scan, Netwatch, Wake on LAN and the traffic graphs
// against the simulated router.
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
async function openTool(page, label) {
 await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('Bandwidth Test reports each second and the averages', async ({ page }) => {
 await openTool(page, 'Bandwidth Test');
 const test = win(page, 'Bandwidth Test');
 await test.getByLabel('Test To:').fill('192.0.2.9');
 await test.getByLabel('Direction:').selectOption('both');
 await test.getByLabel('Duration (s):').fill('2');
 await test.getByRole('button', { name: 'Start' }).click();
 const running = win(page, 'Bandwidth Test 192.0.2.9');
 await expect(running.getByRole('status')).toContainText('send average 922.0 Mbps', { timeout: 8000 });
 await expect(running.getByRole('status')).toContainText('receive average 480.0 Mbps');
 await expect(running.locator('.rd-grid-row')).toHaveCount(4);
 await expect(running.getByRole('img', { name: /^Bandwidth test: Send/ })).toBeVisible();
 // Server mode waits for a computer to connect, until stopped.
 await running.getByLabel('Mode:').selectOption('server');
 await expect(running.getByLabel('Test To:')).toHaveCount(0);
 await running.getByRole('button', { name: 'Start' }).click();
 await expect(win(page, 'Bandwidth Test server').getByRole('status')).toContainText('Server listening on 5201');
 await win(page, 'Bandwidth Test server').getByRole('button', { name: 'Stop' }).click();
});

test('IP Scan finds the hosts of the LAN', async ({ page }) => {
 await openTool(page, 'IP Scan');
 const scan = win(page, 'IP Scan');
 await expect(scan.getByLabel('Network:')).toHaveValue('192.168.88.0/24');
 await scan.getByRole('button', { name: 'Start' }).click();
 const running = win(page, 'IP Scan 192.168.88.0/24');
 await expect(running.getByRole('status')).toContainText('254 of 254 addresses checked', { timeout: 15000 });
 await expect(row(running, '192.168.88.10')).toContainText('52:54:00:AA:10:01');
 await expect(row(running, '192.168.88.10')).toContainText('nas');
 await expect(running.getByRole('button', { name: 'Start' })).toBeEnabled();
});

test('Netwatch lists hosts with their state; Wake on LAN sends; graphs draw', async ({ page }) => {
 await openTool(page, 'Netwatch');
 const netwatch = win(page, 'Netwatch');
 await expect(row(netwatch, '203.0.113.1').locator('.is-flags')).toHaveText('U');
 await expect(row(netwatch, '192.168.88.250')).toContainText('down');
 await netwatch.getByRole('button', { name: 'Add', exact: true }).click();
 const host = win(page, 'New Netwatch Host');
 await host.getByLabel('Host:').fill('9.9.9.9');
 await host.getByRole('tab', { name: 'Down' }).click();
 await host.getByLabel('On Down:').fill('logger -t netwatch dns down');
 await host.getByRole('button', { name: 'OK' }).click();
 await expect(row(netwatch, '9.9.9.9')).toContainText('up');
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Watch 9.9.9.9');

 await openTool(page, 'Wake on LAN');
 const wol = win(page, 'Wake on LAN');
 await wol.getByLabel('MAC Address:').fill('52:54:00:aa:10:02');
 await wol.getByRole('button', { name: 'Send' }).click();
 await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText('Magic packet sent to 52:54:00:aa:10:02 on br-lan');
 await expect(wol.getByLabel('MAC Address:')).toHaveValue('52:54:00:aa:10:02');

 await page.getByRole('menuitem', { name: 'Interfaces', exact: true }).click();
 await page.locator('.rd-grid-row').filter({ hasText: 'br-lan' }).first().dblclick();
 const item = win(page, 'Interface <br-lan>');
 await item.getByRole('tab', { name: 'Traffic' }).click();
 await expect(item.getByRole('img', { name: /^br-lan traffic: Tx [\d.]+ [kMG]?bps/ })).toBeVisible({ timeout: 8000 });
 await openTool(page, 'Graphs');
 await expect(win(page, 'Graphs').getByRole('region', { name: 'eth0 traffic' })).toBeVisible();
});
