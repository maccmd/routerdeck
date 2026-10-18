// DNS and Safe Mode takeover against a real guest; dnsmasq answers are
// checked with nslookup. Every change is undone again.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8' }).trim();
const probe = command => { try { return ssh(command); } catch { return null; } };
const password = (await readFile('.cache/vm/password', 'utf8')).trim();

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Service checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ hasText: text });

function cleanup() {
 ssh(`for s in $(uci show dhcp | sed -n "s/^dhcp\\\\.\\\\([^.]*\\\\)\\\\.name='rdtest.lan'$/\\\\1/p"); do uci delete dhcp.$s; done
  if [ -n "$(uci changes dhcp)" ]; then uci commit dhcp; /etc/init.d/dnsmasq reload; fi
  /etc/init.d/routerdeck-safemode stop 2>/dev/null; rm -rf /var/run/routerdeck/safemode; true`);
}
test.beforeAll(cleanup);
test.afterAll(cleanup);

async function login(page) {
 await page.goto('/routerdeck/');
 await page.evaluate(() => localStorage.clear());
 await page.getByLabel('Password', { exact: true }).fill(password);
 await page.getByRole('button', { name: 'Connect' }).click();
 await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
}
async function openIp(page, label) {
 await page.getByRole('menuitem', { name: 'IP', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('a static DNS entry is answered by dnsmasq at once and removed by Undo', async ({ page }) => {
 await login(page);
 await openIp(page, 'DNS');
 const dns = win(page, 'DNS Settings');
 await expect(dns.getByLabel('Local Domain:')).toHaveValue(ssh('uci -q get dhcp.@dnsmasq[0].domain || echo lan'));
 await dns.getByRole('tab', { name: 'Static' }).click();
 await dns.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Static DNS Entry');
 await item.getByLabel('Name:').fill('rdtest.lan');
 await item.getByLabel('Address:').fill('192.0.2.77');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('nslookup rdtest.lan 127.0.0.1 2>&1') ?? '', { timeout: 15000 }).toContain('192.0.2.77');
 await page.getByRole('button', { name: 'Undo' }).click();
 // nslookup exits non-zero for an unknown name; read its answer anyway.
 await expect.poll(() => probe('nslookup rdtest.lan 127.0.0.1 2>&1 || true') ?? '192.0.2.77', { timeout: 15000 }).not.toContain('192.0.2.77');
});

test('a second session takes Safe Mode over and undoes the first session changes', async ({ browser }) => {
 const before = ssh('sha256sum /etc/config/dhcp');
 const first = await (await browser.newContext()).newPage();
 await login(first);
 await first.getByRole('button', { name: 'Safe Mode', exact: true }).click();
 await expect(first.getByRole('button', { name: 'Safe Mode', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await openIp(first, 'DNS');
 await win(first, 'DNS Settings').getByRole('tab', { name: 'Static' }).click();
 await win(first, 'DNS Settings').getByRole('button', { name: 'Add', exact: true }).click();
 await win(first, 'New Static DNS Entry').getByLabel('Name:').fill('rdtest.lan');
 await win(first, 'New Static DNS Entry').getByLabel('Address:').fill('192.0.2.78');
 await win(first, 'New Static DNS Entry').getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => ssh('uci show dhcp | grep -c rdtest.lan || true')).toBe('1');

 const second = await (await browser.newContext()).newPage();
 await login(second);
 await expect(second.getByRole('button', { name: 'Take over Safe Mode' })).toBeVisible({ timeout: 10000 });
 await second.getByRole('button', { name: 'Undo its changes' }).click();
 await expect(second.getByRole('toolbar', { name: 'Session' })).toContainText('Safe Mode changes undone: restored dhcp');
 expect(ssh('sha256sum /etc/config/dhcp')).toBe(before);
 expect(ssh('logread -e routerdeck | grep -c "taken over" || true')).not.toBe('0');
 // The first session sees that Safe Mode is no longer its own.
 await expect(first.getByRole('button', { name: 'Safe Mode', exact: true })).toHaveAttribute('aria-pressed', 'false', { timeout: 10000 });
});
