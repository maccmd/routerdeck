// WiFi (on mac80211_hwsim radios, when the guest has them) and PPP against a
// real guest. Every change is undone or removed again.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8' }).trim();
const probe = command => { try { return ssh(command); } catch { return null; } };
const password = (await readFile('.cache/vm/password', 'utf8')).trim();

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ hasText: text });

function cleanup() {
 ssh(`uci -q delete network.rdppp; [ -n "$(uci changes network)" ] && { uci commit network; ubus call network reload; }; true`);
}
test.beforeAll(cleanup);
test.afterAll(cleanup);

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

test('changing the access point SSID reconfigures hostapd at once; Undo reconnects the client', async ({ page }) => {
 test.setTimeout(150000);
 const ssid = probe('ubus call iwinfo info \'{"device":"phy0-ap0"}\' | grep ssid') ?? '';
 test.skip(!ssid.includes('RD-Test'), 'This guest has no RD-Test access point on hwsim radios');
 await page.getByRole('menuitem', { name: 'WiFi' }).click();
 const wifi = win(page, 'WiFi');
 await expect(row(wifi, 'phy0-ap0').getByRole('gridcell').nth(8)).toHaveText('1', { timeout: 10000 });
 await wifi.getByRole('tab', { name: 'Registration' }).click();
 await expect(row(wifi, '02:00:00:00:01:00')).toContainText('phy0-ap0');
 await wifi.getByRole('tab', { name: 'WiFi Interfaces' }).click();
 await row(wifi, 'phy0-ap0').dblclick();
 const item = win(page, 'WiFi Interface <RD-Test>');
 await item.getByLabel('SSID:', { exact: true }).fill('RD-Test-2');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('ubus call iwinfo info \'{"device":"phy0-ap0"}\'') ?? '', { timeout: 60000, intervals: [2000] }).toContain('"ssid": "RD-Test-2"');
 await expect(row(wifi, 'phy0-ap0')).toContainText('RD-Test-2');
 // The station looks for RD-Test, so it is no longer connected.
 await expect.poll(() => probe('ubus call iwinfo assoclist \'{"device":"phy0-ap0"}\' | grep -c mac || true') ?? '', { timeout: 60000, intervals: [2000] }).toBe('0');
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect.poll(() => probe('ubus call iwinfo info \'{"device":"phy0-ap0"}\'') ?? '', { timeout: 60000, intervals: [2000] }).toContain('"ssid": "RD-Test"');
 await expect.poll(() => probe('ubus call iwinfo assoclist \'{"device":"phy0-ap0"}\' | grep -c mac || true') ?? '', { timeout: 60000, intervals: [2000] }).toBe('1');
});

test('a PPPoE client is created as a netifd interface and removed', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'PPP' }).click();
 const ppp = win(page, 'PPP');
 await ppp.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New PPP Client');
 await item.getByLabel('Name:').fill('rdppp');
 await item.getByLabel('Device:').selectOption('eth1');
 await item.getByLabel('User:').fill('test@example.invalid');
 await item.getByLabel('Password:').fill('not-a-secret');
 await item.getByLabel('Firewall Zone:').selectOption('');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(row(ppp, 'rdppp')).toContainText('test@example.invalid');
 await expect.poll(() => probe('ubus call network.interface.rdppp status') ?? '', { timeout: 15000 }).toContain('"proto": "pppoe"');
 expect(ssh('uci get network.rdppp.username')).toBe('test@example.invalid');
 await row(ppp, 'rdppp').click();
 await page.keyboard.press('Delete');
 await expect(row(ppp, 'rdppp')).toHaveCount(0);
 await expect.poll(() => probe('ubus list network.interface.rdppp 2>&1 || true') ?? '', { timeout: 15000 }).toContain('Not found');
 expect(ssh('uci -q get network.rdppp || echo absent')).toBe('absent');
});
