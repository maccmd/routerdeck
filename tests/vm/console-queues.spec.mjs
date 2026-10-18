// A named routing table used by a route, a Simple Queue that really slows
// down this test's own downloads from the guest (the host is the LAN client
// at .2), and the graphing service. Everything is undone and compared.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
const probe = command => { try { return ssh(command); } catch { return ''; } };
const password = (await readFile('.cache/vm/password', 'utf8')).trim();
const port = process.env.ROUTERDECK_VM_PORT || '8088';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ has: scope.page().getByRole('gridcell', { name: text, exact: true }) });
const undo = page => page.getByRole('button', { name: 'Undo' }).click();
const files = 'sha256sum /etc/iproute2/rt_tables /etc/config/network /etc/config/routerdeck';
let before, prefix;
test.beforeAll(() => {
 before = ssh(files);
 prefix = ssh('uci get network.lan.ipaddr').split('/')[0].split('.').slice(0, 3).join('.');
});
test.afterAll(() => expect(ssh(files)).toBe(before));

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

test('a named routing table holds a route the kernel puts there', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'Routing', exact: true }).click();
 await page.getByRole('menuitem', { name: 'Tables', exact: true }).click();
 const tables = win(page, 'Routing Tables');
 await tables.getByRole('button', { name: 'Add', exact: true }).click();
 const table = win(page, 'New Routing Table');
 await table.getByLabel('Name:').fill('rdtab');
 await table.getByLabel('Number:').fill('199');
 await table.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => ssh('cat /etc/iproute2/rt_tables')).toContain('199\trdtab');

 await page.getByRole('menuitem', { name: 'IP', exact: true }).click();
 await page.getByRole('menuitem', { name: 'Routes', exact: true }).click();
 const routes = win(page, 'Route List');
 await routes.getByRole('button', { name: 'Add', exact: true }).click();
 const route = win(page, 'New Route');
 await route.getByLabel('Dst. Address:').fill('10.199.9.0/24');
 await route.getByLabel('Gateway:').fill(`${prefix}.2`);
 await route.getByLabel('Interface:').selectOption('lan');
 await route.getByLabel('Routing Table:').fill('rdtab');
 await route.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('ip route show table 199'), { timeout: 15000 }).toContain('10.199.9.0/24');
 expect(probe('ip route show table main')).not.toContain('10.199.9.0/24');
 await routes.getByRole('button', { name: 'Close Route List' }).click();
 await expect(row(tables, 'rdtab')).toContainText('1');
 await undo(page);
 await undo(page);
 await expect.poll(() => probe('ip route show table 199')).not.toContain('10.199.9.0/24');
});

// Seconds to download the test file from the guest's web server.
async function download() {
 const started = performance.now();
 const response = await fetch(`http://127.0.0.1:${port}/rdq.bin`, { cache: 'no-store' });
 expect(response.status).toBe(200);
 expect((await response.arrayBuffer()).byteLength).toBe(2 * 1024 * 1024);
 return (performance.now() - started) / 1000;
}

test('a simple queue shapes downloads to this client and Undo lifts it', async ({ page }) => {
 test.setTimeout(120000);
 test.skip(!probe('[ -x /sbin/tc ] && echo yes'), 'tc is not installed');
 ssh('dd if=/dev/urandom of=/www/rdq.bin bs=1M count=2 2>/dev/null');
 try {
  const free = await download();
  await page.getByRole('menuitem', { name: 'Queues', exact: true }).click();
  const queues = win(page, 'Queues');
  await queues.getByRole('button', { name: 'Add', exact: true }).click();
  const queue = win(page, 'New Simple Queue');
  await queue.getByLabel('Name:').fill('rdslow');
  await queue.getByRole('textbox', { name: 'Target:' }).fill(`${prefix}.2`);
  await queue.getByLabel('Max Upload:').fill('2M');
  await queue.getByLabel('Max Download:').fill('4M');
  await queue.getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => probe('tc class show dev br-lan'), { timeout: 15000 }).toContain('ceil 4Mbit');
  expect(probe('tc class show dev rdq-br-lan')).toContain('ceil 2Mbit');
  await expect(row(queues, 'rdslow').locator('.is-flags')).toHaveText('S');
  // 2 MiB at 4 Mbit/s take about four seconds.
  const shaped = await download();
  expect(shaped).toBeGreaterThan(3);
  expect(shaped).toBeGreaterThan(free * 3);
  await expect(row(queues, 'rdslow')).toContainText(/\/2(\.\d)? MiB/, { timeout: 10000 });
  await undo(page);
  await expect.poll(() => probe('tc qdisc show dev br-lan'), { timeout: 15000 }).not.toContain('htb');
  expect(probe('ip link show rdq-br-lan >/dev/null 2>&1 && echo present || echo gone')).toBe('gone');
  expect(await download()).toBeLessThan(shaped / 2);
 } finally {
  probe('rm -f /www/rdq.bin');
 }
});

test('Graphing runs as a service on the router and its history reaches the window', async ({ page }) => {
 test.setTimeout(120000);
 await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
 await page.getByRole('menuitem', { name: 'Graphing', exact: true }).click();
 const graphing = win(page, 'Graphing');
 await graphing.getByRole('button', { name: 'Settings…' }).click();
 const settings = win(page, 'Graphing Settings');
 await settings.getByLabel('Enabled:').check();
 await settings.getByRole('group', { name: 'Interfaces:' }).getByLabel('br-lan').check();
 await settings.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe("pgrep -f '^/usr/bin/ucode /usr/libexec/routerdeck/graphing' || echo none"), { timeout: 15000 }).toMatch(/^\d+/);
 // The first sample comes ten seconds after the start.
 await expect.poll(() => probe('ubus call routerdeck graphs'), { timeout: 40000, intervals: [3000] }).toContain('interface:br-lan');
 await graphing.getByRole('button', { name: 'Close Graphing' }).click();
 await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
 await page.getByRole('menuitem', { name: 'Graphing', exact: true }).click();
 await expect(win(page, 'Graphing').getByRole('option')).toHaveText(['CPU', 'Memory', 'br-lan']);
 await expect(win(page, 'Graphing').getByRole('img', { name: /^br-lan day: Tx [\d.]+ [kMG]?bps, Rx [\d.]+ [kMG]?bps$/ })).toBeVisible();
 await win(page, 'Graphing').getByRole('option', { name: 'CPU' }).click();
 await expect(win(page, 'Graphing').getByRole('img', { name: /^CPU day: CPU [\d.]+ %$/ })).toBeVisible();
 await undo(page);
 await expect.poll(() => probe("pgrep -f '^/usr/bin/ucode /usr/libexec/routerdeck/graphing' || echo none"), { timeout: 15000 }).toBe('none');
 probe('rm -f /var/run/routerdeck/graphs.json');
});
