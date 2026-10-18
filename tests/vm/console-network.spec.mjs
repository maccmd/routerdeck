// IPv6 and Bridge windows editing a real guest. A temporary bridge is used so
// the LAN bridge carrying this test's connection is never changed.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8' }).trim();
// Changing LAN addresses restarts the interface; SSH may drop for a moment.
const probe = command => { try { return ssh(command); } catch { return null; } };
const password = (await readFile('.cache/vm/password', 'utf8')).trim();

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Editing checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ hasText: text });

function cleanup() {
 ssh(`for s in $(uci show network | sed -n "s/^network\\\\.\\\\([^.]*\\\\)=bridge-vlan$/\\\\1/p"); do [ "$(uci -q get network.$s.device)" = br-rdtest ] && uci delete network.$s; done
  for s in $(uci show network | sed -n "s/^network\\\\.\\\\([^.]*\\\\)\\\\.name='br-rdtest'$/\\\\1/p"); do uci delete network.$s; done
  for s in $(uci show network | sed -n "s/^network\\\\.\\\\([^.]*\\\\)\\\\.target='fd98::\\\\/48'$/\\\\1/p"); do uci delete network.$s; done
  uci -q del_list network.lan.ip6addr='fd99::1/64'
  if [ -n "$(uci changes network)" ]; then uci commit network; ubus call network reload; fi; true`);
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

async function openIpv6(page, label) {
 await page.getByRole('menuitem', { name: 'IPv6' }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('an IPv6 route reaches the kernel and Undo removes it', async ({ page }) => {
 await openIpv6(page, 'Routes');
 const routes = win(page, 'IPv6 Route List');
 await expect(row(routes, 'fe80::/64').first().locator('.is-flags')).toHaveText('DAC');
 await routes.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New IPv6 Route');
 await item.getByLabel('Dst. Address:').fill('fd98::/48');
 await item.getByLabel('Interface:').selectOption('lan');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => ssh('ip -6 route show fd98::/48'), { timeout: 15000 }).toContain('dev br-lan');
 await expect(row(routes, 'fd98::/48').locator('.is-flags')).toHaveText('AS', { timeout: 10000 });
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect.poll(() => ssh('ip -6 route show fd98::/48'), { timeout: 15000 }).toBe('');
});

test('an IPv6 address is added to the LAN bridge and undone', async ({ page }) => {
 await openIpv6(page, 'Addresses');
 const list = win(page, 'IPv6 Address List');
 await expect(list.locator('.rd-grid-row').filter({ hasText: 'fe80::' }).first().locator('.is-flags')).toHaveText('DL');
 await list.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New IPv6 Address');
 await item.getByLabel('Address:').fill('fd99::1/64');
 await item.getByLabel('Interface:').selectOption('lan');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('ip -6 addr show br-lan'), { timeout: 30000 }).toContain('inet6 fd99::1/64');
 await expect(row(list, 'fd99::1/64').locator('.is-flags')).toHaveText('G', { timeout: 10000 });
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect.poll(() => probe('ip -6 addr show br-lan') ?? 'fd99::1', { timeout: 30000 }).not.toContain('fd99::1');
 await expect.poll(() => probe('uci -q get network.lan.ip6addr || echo none'), { timeout: 30000 }).toBe('none');
});

test('a bridge with a VLAN is created, filters VLANs, and is removed', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'Bridge' }).click();
 const bridge = win(page, 'Bridge');
 await expect(row(bridge, 'br-lan')).toContainText('eth0');
 await bridge.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Bridge');
 await item.getByLabel('Name:').fill('br-rdtest');
 await item.getByRole('button', { name: 'OK' }).click();
 // netifd knows the bridge at once but creates it only when a network uses it.
 await expect.poll(() => probe('ubus call network.device status \'{"name":"br-rdtest"}\'') ?? '', { timeout: 15000 }).toContain('"type": "bridge"');
 await expect(row(bridge, 'br-rdtest').locator('.is-flags')).toHaveText('I', { timeout: 10000 });

 await bridge.getByRole('tab', { name: 'VLANs' }).click();
 await bridge.getByRole('button', { name: 'Add', exact: true }).click();
 const vlan = win(page, 'New Bridge VLAN');
 await vlan.getByLabel('Bridge:').selectOption('br-rdtest');
 await vlan.getByLabel('VLAN ID:').fill('100');
 await vlan.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('ubus call network.device status \'{"name":"br-rdtest"}\'') ?? '', { timeout: 15000 }).toMatch(/"vlan_filtering": true[\s\S]*"id": 100/);
 await expect(row(bridge, '100')).toContainText('br-rdtest');

 await bridge.getByRole('tab', { name: 'Bridge' }).click();
 await row(bridge, 'br-rdtest').click();
 await bridge.getByRole('button', { name: 'Remove' }).click();
 // netifd keeps an internal record of a removed bridge until it restarts;
 // configuration, kernel and the window must no longer have it.
 await expect(row(bridge, 'br-rdtest')).toHaveCount(0, { timeout: 10000 });
 expect(ssh('uci show network | grep -c "br-rdtest" || true')).toBe('0');
 expect(ssh('ip link show br-rdtest >/dev/null 2>&1 && echo present || echo absent')).toBe('absent');
});
