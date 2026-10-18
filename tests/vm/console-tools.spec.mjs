// Ping, Traceroute and Torch against a real guest. The host reaches the
// guest's LAN as 192.168.77.2, so the console's own requests are LAN traffic.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8' }).trim();
const password = (await readFile('.cache/vm/password', 'utf8')).trim();

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Tool checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ hasText: text });
const lanAddress = ssh('uci get network.lan.ipaddr').split('/')[0];
const lanPrefix = lanAddress.split('.').slice(0, 3).join('.');

test.beforeEach(async ({ page }) => {
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 page.consoleErrors = errors;
 await page.goto('/routerdeck/');
 await page.evaluate(() => localStorage.clear());
 await page.getByLabel('Password', { exact: true }).fill(password);
 await page.getByRole('button', { name: 'Connect' }).click();
 await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
});
test.afterEach(async ({ page }) => expect(page.consoleErrors ?? []).toEqual([]));
// Closing the page stops reading the jobs; they end on their own.
test.afterAll(async () => expect.poll(() => ssh('pgrep -f routerdeck/dia[g] || true'), { timeout: 30000 }).toBe(''));

async function openTool(page, label) {
 await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('Ping reports replies from the router and timeouts for a missing host', async ({ page }) => {
 await openTool(page, 'Ping');
 const ping = win(page, 'Ping');
 await ping.getByLabel('Ping To:').fill(lanAddress);
 await ping.getByLabel('Count:').fill('3');
 await ping.getByRole('button', { name: 'Start' }).click();
 const own = win(page, `Ping ${lanAddress}`);
 await expect(own.getByRole('status')).toContainText('3 sent', { timeout: 10000 });
 await expect(own.getByRole('status')).toContainText('3 received');
 await expect(own.locator('.rd-grid-row').first().getByRole('gridcell').nth(4)).toHaveText('64');

 await own.getByLabel('Ping To:').fill(`${lanPrefix}.250`);
 await own.getByLabel('Count:').fill('2');
 await own.getByRole('button', { name: 'Start' }).click();
 const missing = win(page, `Ping ${lanPrefix}.250`);
 await expect(missing.getByRole('status')).toContainText('100% packet loss', { timeout: 10000 });
 await expect(row(missing, 'timeout')).toHaveCount(2);
});

test('Traceroute reaches the QEMU gateway in one hop and keeps probing until stopped', async ({ page }) => {
 await openTool(page, 'Traceroute');
 const trace = win(page, 'Traceroute');
 await trace.getByLabel('Traceroute To:').fill('10.0.2.2');
 await trace.getByRole('button', { name: 'Start' }).click();
 const running = win(page, 'Traceroute 10.0.2.2');
 await expect(running.getByRole('status')).toContainText('10.0.2.2 reached in 1 hop', { timeout: 10000 });
 await expect(running.getByRole('status')).toContainText(/[3-9] rounds/, { timeout: 10000 });
 await expect(row(running, '10.0.2.2').getByRole('gridcell').nth(2)).toHaveText('0%');
 await running.getByRole('button', { name: 'Stop' }).click();
 await expect(running.getByRole('button', { name: 'Start' })).toBeEnabled();
 await expect.poll(() => ssh('pgrep -f routerdeck/dia[g] || true'), { timeout: 10000 }).toBe('');
});

test('Torch shows the console\'s own HTTP traffic on the LAN bridge', async ({ page }) => {
 await openTool(page, 'Torch');
 const torch = win(page, 'Torch');
 await expect(torch.getByLabel('Interface:')).toHaveValue('br-lan');
 await torch.getByLabel('Port:').fill('80');
 await torch.getByRole('checkbox', { name: 'Port' }).uncheck();
 await torch.getByRole('button', { name: 'Start' }).click();
 const http = row(torch, lanAddress);
 await expect(http).toContainText(`${lanPrefix}.2`, { timeout: 10000 });
 // Replies from uhttpd leave through the bridge (Tx); requests arrive (Rx).
 await expect(http.getByRole('gridcell').nth(4)).toHaveText(/bps/, { timeout: 10000 });
 await expect(http.getByRole('gridcell').nth(5)).toHaveText(/bps/);
 await torch.getByRole('button', { name: 'Stop' }).click();
});
