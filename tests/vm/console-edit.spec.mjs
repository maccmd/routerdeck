// RouterDeck Console editing a real OpenWrt guest through its UI. Results are
// checked with SSH in the kernel and nftables; every change is undone again.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8' }).trim();
// Changing LAN addresses restarts the interface; SSH may drop for a moment.
const probe = command => { try { return ssh(command); } catch { return null; } };
const password = (await readFile('.cache/vm/password', 'utf8')).trim();
// 25.12 and 24.10 guests use different LAN subnets.
const lanAddress = ssh('uci get network.lan.ipaddr');
const lanNetmask = ssh('uci -q get network.lan.netmask || true');
const net = lanAddress.split('.').slice(0, 3).join('.');
// A legacy `ipaddr` + `netmask` pair becomes a CIDR list when an address is added.
const prefixOf = mask => mask.split('.').reduce((bits, part) => bits + Number(part).toString(2).replace(/0/g, '').length, 0);
const lanCidr = lanAddress.includes('/') ? lanAddress : `${lanAddress}/${prefixOf(lanNetmask)}`;

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Editing checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ hasText: text });

// A failed run must not leave test objects behind in the guest.
function cleanup() {
 ssh(`for s in $(uci show firewall | sed -n "s/^firewall\\.\\([^.]*\\)\\.name='RD-UI-.*/\\1/p"); do uci delete firewall.$s; done; uci commit firewall; /etc/init.d/firewall reload >/dev/null 2>&1; true`);
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

async function openIp(page, label) {
 await page.getByRole('menuitem', { name: 'IP' }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('a static route is added to the kernel at once and removed by Undo', async ({ page }) => {
 await openIp(page, 'Routes');
 const routes = win(page, 'Route List');
 await expect(row(routes, `${net}.0/24`)).toContainText('br-lan');
 await routes.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Route');
 await item.getByLabel('Dst. Address:').fill('10.123.0.0/16');
 await item.getByLabel('Gateway:').fill(`${net}.254`);
 await item.getByLabel('Interface:').selectOption('lan');
 await item.getByLabel('Distance:').fill('7');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => ssh('ip -4 route show 10.123.0.0/16'), { timeout: 15000 }).toContain(`via ${net}.254 dev br-lan`);
 await expect(row(routes, '10.123.0.0/16').locator('.is-flags')).toHaveText('AS', { timeout: 10000 });
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect.poll(() => ssh('ip -4 route show 10.123.0.0/16'), { timeout: 15000 }).toBe('');
 await expect(row(routes, '10.123.0.0/16')).toHaveCount(0);
});

test('a firewall rule is applied, disabled and removed with fw4 reloading each time', async ({ page }) => {
 const name = 'RD-UI-' + Date.now(), port = String(20000 + Date.now() % 10000);
 await openIp(page, 'Firewall');
 const firewall = win(page, 'Firewall');
 await firewall.locator('.rd-win-title').dblclick();
 await firewall.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Firewall Rule');
 await item.getByLabel('In. Zone:').selectOption('wan');
 await item.getByLabel('Protocol:').fill('tcp');
 await item.getByLabel('Dst. Port:').fill(port);
 await item.getByRole('button', { name: 'OK' }).click();
 const created = row(firewall, port);
 await created.click();
 await firewall.getByRole('button', { name: 'Comment' }).click();
 await page.getByRole('dialog', { name: 'Comment Firewall Rule' }).getByLabel('Comment').fill(name);
 await page.getByRole('dialog', { name: 'Comment Firewall Rule' }).getByRole('button', { name: 'OK' }).click();
 await expect(firewall.locator('.rd-grid-comment').filter({ hasText: name })).toBeVisible();
 await expect.poll(() => ssh('nft list chain inet fw4 input_wan'), { timeout: 15000 }).toContain(`comment "!fw4: ${name}"`);
 await expect(row(firewall, port).getByRole('gridcell').nth(12)).toHaveText(/^\d+$/, { timeout: 10000 });

 await row(firewall, port).click();
 await firewall.getByRole('button', { name: 'Disable' }).click();
 await expect.poll(() => ssh('nft list chain inet fw4 input_wan'), { timeout: 15000 }).not.toContain(name);
 await expect(row(firewall, port)).toHaveClass(/is-disabled/);
 expect(ssh(`uci show firewall | grep -c "name='${name}'"`)).toBe('1');

 await row(firewall, port).click();
 await page.keyboard.press('Delete');
 await expect(row(firewall, port)).toHaveCount(0);
 expect(ssh(`uci show firewall | grep -c "name='${name}'" || true`)).toBe('0');
});

test('an address is added to the bridge and the history undoes it', async ({ page }) => {
 await openIp(page, 'Addresses');
 const list = win(page, 'Address List');
 await list.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Address');
 await item.getByLabel('Address:').fill('192.168.79.1/24');
 await item.getByLabel('Interface:').selectOption('lan');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('ip -4 addr show br-lan'), { timeout: 30000 }).toContain('inet 192.168.79.1/24');
 await expect(row(list, '192.168.79.1/24').locator('.is-flags')).toHaveText('', { timeout: 10000 });
 await expect.poll(() => probe('uci get network.lan.ipaddr'), { timeout: 30000 }).toBe(`${lanCidr} 192.168.79.1/24`);
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect.poll(() => probe('ip -4 addr show br-lan') ?? '192.168.79.1', { timeout: 30000 }).not.toContain('192.168.79.1');
 await expect.poll(() => probe('uci get network.lan.ipaddr'), { timeout: 30000 }).toBe(lanAddress);
 // Undo restores the file exactly, including a legacy netmask option.
 expect(ssh('uci -q get network.lan.netmask || true')).toBe(lanNetmask);
});

test('Safe Mode undoes a change on request', async ({ page }) => {
 const safe = page.getByRole('button', { name: 'Safe Mode', exact: true });
 await safe.click();
 await expect(safe).toHaveAttribute('aria-pressed', 'true');
 expect(ssh('ubus call service list \'{"name":"routerdeck-safemode"}\'')).toContain('"running": true');
 await openIp(page, 'Routes');
 const routes = win(page, 'Route List');
 await routes.getByRole('button', { name: 'Add', exact: true }).click();
 await win(page, 'New Route').getByLabel('Dst. Address:').fill('10.124.0.0/16');
 await win(page, 'New Route').getByLabel('Interface:').selectOption('lan');
 await win(page, 'New Route').getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => ssh('ip -4 route show 10.124.0.0/16'), { timeout: 15000 }).toContain('dev br-lan');
 await page.getByRole('button', { name: 'Undo Safe Mode changes' }).click();
 await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText('Safe Mode changes undone: restored network');
 await expect.poll(() => ssh('ip -4 route show 10.124.0.0/16'), { timeout: 15000 }).toBe('');
 await expect(safe).toHaveAttribute('aria-pressed', 'false');
 await expect.poll(() => ssh('ubus call service list \'{"name":"routerdeck-safemode"}\''), { timeout: 10000 }).not.toContain('"running": true');
});
