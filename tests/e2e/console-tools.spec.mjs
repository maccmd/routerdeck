// Tools (Ping, Traceroute, Torch) against the simulated router.
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

test('Ping shows every request, losses included, and stops', async ({ page }) => {
 await openTool(page, 'Ping');
 const ping = win(page, 'Ping');
 await ping.getByLabel('Ping To:').fill('-f');
 await ping.getByRole('button', { name: 'Start' }).click();
 await expect(ping.getByText('Enter an address or host name')).toBeVisible();
 await ping.getByLabel('Ping To:').fill('openwrt.org');
 await ping.getByLabel('Interval (s):').fill('0.2');
 await ping.getByLabel('Ping To:').press('Enter');
 const running = win(page, 'Ping openwrt.org');
 await expect(row(running, 'timeout')).toHaveCount(1, { timeout: 5000 });
 await expect(running.getByRole('row').nth(1)).toContainText('198.51.100.80');
 await expect(running.getByLabel('Ping To:')).toBeDisabled();
 await running.getByRole('button', { name: 'Stop' }).click();
 await expect(running.getByRole('button', { name: 'Start' })).toBeEnabled();
 const status = running.getByRole('status');
 await expect(status).toContainText('packet loss');
 await expect(status).toContainText('min/avg/max');
 const sent = Number((await status.textContent()).match(/(\d+) sent/)[1]);
 await page.waitForTimeout(600);
 await expect(running.locator('.rd-grid-row')).toHaveCount(sent);

 // An unknown name is reported by the router.
 await running.getByLabel('Ping To:').fill('nothing.invalid');
 await running.getByRole('button', { name: 'Start' }).click();
 await expect(win(page, 'Ping nothing.invalid').getByRole('status')).toContainText("bad address 'nothing.invalid'");
});

test('Traceroute keeps per-hop statistics and New Window opens another', async ({ page }) => {
 await openTool(page, 'Traceroute');
 const trace = win(page, 'Traceroute');
 await trace.getByLabel('Traceroute To:').fill('192.0.2.9');
 await trace.getByLabel('Count:').fill('3');
 await trace.getByLabel('Traceroute To:').press('Enter');
 const running = win(page, 'Traceroute 192.0.2.9');
 await expect(running.getByRole('status')).toContainText('3 rounds', { timeout: 6000 });
 await expect(running.getByRole('button', { name: 'Start' })).toBeEnabled();
 await expect(running.getByRole('status')).toContainText('192.0.2.9 reached in 5 hops');
 await expect(row(running, '100.64.0.1').getByRole('gridcell').nth(2)).toHaveText('33%');
 await expect(running.locator('.rd-grid-row').nth(2)).toContainText('timeout');
 await running.getByRole('button', { name: 'New Window' }).click();
 await expect(win(page, 'Traceroute')).toBeVisible();
 await win(page, 'Traceroute').locator('.rd-diag-buttons').getByRole('button', { name: 'Close' }).click();
 await expect(win(page, 'Traceroute')).toHaveCount(0);
 // Settings come back after a reload.
 await page.reload();
 await expect(win(page, 'Traceroute 192.0.2.9').getByLabel('Traceroute To:')).toHaveValue('192.0.2.9');
});

test('Torch shows rates per connection on the chosen device, filtered and grouped', async ({ page }) => {
 await openTool(page, 'Torch');
 const torch = win(page, 'Torch');
 await expect(torch.getByLabel('Interface:')).toHaveValue('br-lan');
 await torch.getByRole('button', { name: 'Start' }).click();
 // Downloads are sent to LAN clients: Tx on the LAN bridge.
 const download = row(torch, '192.168.88.10:40000');
 await expect(download.getByRole('gridcell').nth(4)).toHaveText(/kbps|Mbps/, { timeout: 5000 });
 await expect(download.getByRole('gridcell').nth(4)).toHaveText(/Mbps/);
 await torch.getByLabel('Interface:').selectOption('eth1');
 await expect(download.getByRole('gridcell').nth(5)).toHaveText(/Mbps/);
 await torch.getByLabel('Src. Address:').fill('192.168.88.10');
 await expect(torch.locator('.rd-grid-row').filter({ hasNotText: '192.168.88.10' })).toHaveCount(0);
 await torch.getByLabel('Src. Address:').fill('192.168.88.');
 await expect(torch.getByText('Use an address or a prefix like 192.168.88.0/24')).toBeVisible();
 await torch.getByLabel('Src. Address:').fill('');
 await torch.getByRole('checkbox', { name: 'Port' }).uncheck();
 await torch.getByRole('checkbox', { name: 'Dst. Address' }).uncheck();
 await torch.getByRole('checkbox', { name: 'Protocol' }).uncheck();
 await expect(torch.locator('.rd-grid-row')).toHaveCount(6);
 await expect(row(torch, '192.168.88.10').getByRole('gridcell').nth(8)).toHaveText(/^\d+$/);
 await torch.getByRole('columnheader', { name: 'Rx Rate' }).click();
 await torch.getByRole('button', { name: 'Stop' }).click();
 await expect(torch.getByRole('status')).toContainText('packets/s');
});
