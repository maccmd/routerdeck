// Bandwidth Test (iperf3), IP Scan, Netwatch and Wake on LAN (etherwake)
// against a real guest. Tests needing a package skip without it.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8' }).trim();
const probe = command => { try { return ssh(command); } catch { return ''; } };
const password = (await readFile('.cache/vm/password', 'utf8')).trim();

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Tool checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ hasText: text });
const lan = ssh('uci get network.lan.ipaddr').split('/')[0];
const prefix = lan.split('.').slice(0, 3).join('.');
let before;
// uci rewrites the file, so compare what it holds rather than its bytes.
test.beforeAll(() => { before = probe('uci show routerdeck'); });
test.afterAll(() => expect(probe('uci show routerdeck')).toBe(before));

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

async function openTool(page, label) {
 await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('an iperf3 server and client on the router measure each other', async ({ page }) => {
 test.skip(!probe('[ -x /usr/bin/iperf3 ] && echo yes'), 'iperf3 is not installed');
 await openTool(page, 'Bandwidth Test');
 const server = win(page, 'Bandwidth Test');
 await server.getByLabel('Mode:').selectOption('server');
 await server.getByLabel('Port:').fill('5299');
 await server.getByRole('button', { name: 'Start' }).click();
 const waiting = win(page, 'Bandwidth Test server');
 await expect(waiting.getByRole('status')).toContainText('Server listening on 5299', { timeout: 10000 });
 await waiting.getByRole('button', { name: 'New Window' }).click();
 const client = win(page, 'Bandwidth Test');
 await client.getByLabel('Test To:').fill('127.0.0.1');
 await client.getByLabel('Port:').fill('5299');
 await client.getByLabel('Duration (s):').fill('3');
 await client.getByRole('button', { name: 'Start' }).click();
 const result = win(page, 'Bandwidth Test 127.0.0.1');
 await expect(result.getByRole('status')).toContainText(/send average [\d.]+ [MG]bps/, { timeout: 20000 });
 await expect(result.locator('.rd-grid-row')).toHaveCount(3);
 // The one-off server saw the same test and ended.
 await expect(waiting.getByRole('status')).toContainText(/receive average [\d.]+ [MG]bps/, { timeout: 10000 });
 await expect.poll(() => probe("pgrep -f '^iperf3' || echo none")).toBe('none');
});

test('IP Scan finds the router and the QEMU hosts on the LAN', async ({ page }) => {
 await openTool(page, 'IP Scan');
 const scan = win(page, 'IP Scan');
 await scan.getByLabel('Network:').fill(`${prefix}.0/28`);
 await scan.getByRole('button', { name: 'Start' }).click();
 const running = win(page, `IP Scan ${prefix}.0/28`);
 await expect(running.getByRole('status')).toContainText('14 of 14 addresses checked', { timeout: 20000 });
 await expect(running.getByRole('button', { name: 'Start' })).toBeEnabled({ timeout: 10000 });
 await expect(running.locator('.rd-grid-row').filter({ has: page.getByRole('gridcell', { name: lan, exact: true }) })).toHaveCount(1);
 await expect(running.locator('.rd-grid-row').filter({ has: page.getByRole('gridcell', { name: `${prefix}.2`, exact: true }) })).toContainText(':');
});

test('Netwatch runs on the router, reports up and down, and stops without hosts', async ({ page }) => {
 await openTool(page, 'Netwatch');
 const netwatch = win(page, 'Netwatch');
 for (const [host, down] of [['127.0.0.1', ''], [`${prefix}.250`, 'logger -t rdnetwatch went down']]) {
  await netwatch.getByRole('button', { name: 'Add', exact: true }).click();
  const item = win(page, 'New Netwatch Host');
  await item.getByLabel('Host:', { exact: true }).fill(host);
  await item.getByLabel('Interval (s):').fill('2');
  if (down) {
   await item.getByRole('tab', { name: 'Down' }).click();
   await item.getByLabel('On Down:').fill(down);
  }
  await item.getByRole('button', { name: 'OK' }).click();
  await expect(item).toHaveCount(0);
 }
 await expect.poll(() => probe("pgrep -f '^/usr/bin/ucode /usr/libexec/routerdeck/netwatch' || echo none"), { timeout: 15000 }).toMatch(/^\d+$/);
 await expect(row(netwatch, '127.0.0.1').locator('.is-flags')).toHaveText('U', { timeout: 15000 });
 await expect(row(netwatch, `${prefix}.250`).locator('.is-flags')).toHaveText('D', { timeout: 15000 });
 expect(ssh('logread -e netwatch | tail -5')).toContain(`${prefix}.250 is down`);
 await page.getByRole('button', { name: 'Undo' }).click();
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect(netwatch.locator('.rd-grid-row')).toHaveCount(0);
 await expect.poll(() => probe("pgrep -f '^/usr/bin/ucode /usr/libexec/routerdeck/netwatch' || echo none"), { timeout: 15000 }).toBe('none');
});

test('Wake on LAN sends through etherwake; the Traffic tab draws', async ({ page }) => {
 test.skip(!probe('[ -x /usr/bin/etherwake ] && echo yes'), 'etherwake is not installed');
 await openTool(page, 'Wake on LAN');
 const wol = win(page, 'Wake on LAN');
 await wol.getByLabel('MAC Address:').fill('02:00:00:00:00:99');
 await wol.getByRole('button', { name: 'Send' }).click();
 await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText('Magic packet sent to 02:00:00:00:00:99 on br-lan');

 await page.getByRole('menuitem', { name: 'Interfaces', exact: true }).click();
 await page.locator('.rd-grid-row').filter({ hasText: 'br-lan' }).first().dblclick();
 const item = win(page, 'Interface <br-lan>');
 await item.getByRole('tab', { name: 'Traffic' }).click();
 await expect(item.getByRole('img', { name: /^br-lan traffic: Tx [\d.]+ [kMG]?bps/ })).toBeVisible({ timeout: 10000 });
});
