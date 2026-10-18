// Quick Set against a real guest: several settings in one change and one
// Undo, and a LAN address change under Safe Mode. The host reaches the guest
// only through its LAN address, so that change cuts the console off and the
// Safe Mode watchdog has to bring the old address back.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8' }).trim();
const probe = command => { try { return ssh(command); } catch { return null; } };
const password = (await readFile('.cache/vm/password', 'utf8')).trim();

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Quick Set checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const original = {};

test.beforeAll(() => {
 ssh('/etc/init.d/routerdeck-safemode stop 2>/dev/null; rm -rf /var/run/routerdeck/safemode /var/run/routerdeck/last-rollback.json; true');
 Object.assign(original, {
  hostname: ssh('uci get system.@system[0].hostname'), lan: ssh('uci get network.lan.ipaddr'),
  start: ssh('uci -q get dhcp.lan.start || echo 100'), limit: ssh('uci -q get dhcp.lan.limit || echo 150'), configs: ssh('sha256sum /etc/config/network /etc/config/dhcp /etc/config/system')
 });
});
test.afterAll(() => {
 // Whatever happened, leave the guest as it was found.
 expect(ssh('sha256sum /etc/config/network /etc/config/dhcp /etc/config/system')).toBe(original.configs);
});

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

test('identity and DHCP range change together and one Undo restores both', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'Quick Set', exact: true }).click();
 const quick = win(page, 'Quick Set');
 const lan = original.lan.split('/')[0].split('.').slice(0, 3).join('.');
 await quick.getByRole('tab', { name: 'Local Network' }).click();
 await expect(quick.getByLabel('DHCP Server Range:')).toHaveValue(`${lan}.${original.start}-${lan}.${Number(original.start) + Number(original.limit) - 1}`);
 await quick.getByLabel('DHCP Server Range:').fill(`${lan}.20-${lan}.59`);
 await quick.getByRole('tab', { name: 'System' }).click();
 await quick.getByLabel('Router Identity:').fill('rd-quickset');
 await quick.getByRole('button', { name: 'Apply' }).click();
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Quick Set: DHCP server, identity rd-quickset');
 expect(ssh('uci get dhcp.lan.start; uci get dhcp.lan.limit').split('\n')).toEqual(['20', '40']);
 // procd reloads the system service, which sets the kernel host name.
 await expect.poll(() => ssh('cat /proc/sys/kernel/hostname'), { timeout: 15000 }).toBe('rd-quickset');
 await expect(page).toHaveTitle(/\(rd-quickset\)/, { timeout: 10000 });
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect.poll(() => ssh('cat /proc/sys/kernel/hostname'), { timeout: 15000 }).toBe(original.hostname);
 expect(ssh('sha256sum /etc/config/network /etc/config/dhcp /etc/config/system')).toBe(original.configs);
 expect(page.consoleErrors).toEqual([]);
});

test('a LAN address change under Safe Mode is rolled back when the console loses the router', async ({ page }) => {
 test.setTimeout(300000);
 await page.getByRole('button', { name: 'Safe Mode', exact: true }).click();
 await expect(page.getByRole('button', { name: 'Safe Mode', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await page.getByRole('menuitem', { name: 'Quick Set', exact: true }).click();
 const quick = win(page, 'Quick Set');
 await quick.getByRole('tab', { name: 'Local Network' }).click();
 // 24.10 keeps the legacy ipaddr + netmask form; the field shows CIDR either way.
 const current = await quick.getByLabel('IP Address:').inputValue();
 const moved = current.replace(/^(\d+\.\d+)\.\d+\./, '$1.199.');
 expect(moved).not.toBe(current);
 await quick.getByLabel('IP Address:').fill(moved);
 await quick.getByRole('button', { name: 'Apply' }).click();
 await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText(`Continue at http://${moved.split('/')[0]}/routerdeck/`);
 // The guest is now out of reach: QEMU forwards to the old LAN address.
 await expect.poll(() => probe('true'), { timeout: 30000, intervals: [2000] }).toBe(null);
 await page.close();
 // Without heartbeats the watchdog restores the snapshot after its timeout.
 await expect.poll(() => probe('uci get network.lan.ipaddr'), { timeout: 240000, intervals: [5000] }).toBe(original.lan);
 expect(ssh('logread -e routerdeck | tail -5')).toContain('timed out');
 expect(ssh('test -e /var/run/routerdeck/safemode/state.json && echo active || echo off')).toBe('off');
});
