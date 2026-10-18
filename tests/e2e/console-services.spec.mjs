// DNS, DHCPv6 and Safe Mode takeover against the simulated router.
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
async function openIp(page, label) {
 await page.getByRole('menuitem', { name: 'IP', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('DNS settings form and static entries', async ({ page }) => {
 await openIp(page, 'DNS');
 const dns = win(page, 'DNS Settings');
 await expect(dns.getByLabel('Local Domain:')).toHaveValue('lan');
 await expect(dns.getByRole('status', { name: 'Dynamic Servers:' })).toHaveText('203.0.113.1');
 await dns.getByLabel('Servers:', { exact: true }).fill('9.9.9.9');
 await dns.getByLabel('Allow Remote Requests:').check();
 await dns.getByRole('button', { name: 'Apply' }).click();
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Change DNS settings');
 await expect(dns.getByLabel('Servers:', { exact: true })).toHaveValue('9.9.9.9');

 await dns.getByRole('tab', { name: 'Static' }).click();
 await expect(row(dns, 'files.lan')).toContainText('CNAME');
 await expect(dns.locator('.rd-grid-comment')).toHaveText(';;; Shared folders');
 await dns.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Static DNS Entry');
 await item.getByLabel('Type:').selectOption('AAAA');
 await item.getByLabel('Name:').fill('nas.lan');
 await item.getByLabel('Address:').fill('192.168.88.10');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(item.getByText('Enter an IPv6 address')).toBeVisible();
 await item.getByLabel('Address:').fill('FD00:88::10');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(row(dns, 'fd00:88::10')).toContainText('AAAA');
});

test('DHCPv6 bindings show static and dynamic clients', async ({ page }) => {
 await openIp(page, 'DHCP Server');
 const dhcp = win(page, 'DHCP Server');
 await dhcp.getByRole('tab', { name: 'DHCPv6 Bindings' }).click();
 await expect(row(dhcp, 'nas')).toContainText('fd50:b8c1:5fb2::10/128');
 await expect(row(dhcp, 'nas')).toContainText('bound');
 await expect(row(dhcp, 'laptop').locator('.is-flags')).toHaveText('D');
 await row(dhcp, 'laptop').click();
 await dhcp.getByRole('button', { name: 'Make Static' }).click();
 await expect(row(dhcp, 'laptop').locator('.is-flags')).toHaveText('');
 await row(dhcp, 'laptop').dblclick();
 await expect(win(page, 'DHCPv6 Binding <laptop>').getByLabel('Address Suffix:')).toHaveValue('5c1');
});

test('Safe Mode held by another session can be taken over', async ({ page }) => {
 await page.evaluate(async () => {
  const sid = JSON.parse(sessionStorage.getItem('routerdeck.console.session')).sid;
  await fetch('/ubus', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: [sid, 'routerdeck', 'safemode', { action: '__other' }] }) });
 });
 const takeover = page.getByRole('button', { name: 'Take over Safe Mode' });
 await expect(takeover).toBeVisible({ timeout: 8000 });
 await expect(takeover).toHaveAttribute('title', /held by root in another session/);
 await takeover.click();
 await expect(page.getByRole('button', { name: 'Safe Mode', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText('Safe Mode taken over from root');
});

test('WiFi interfaces, radios and registered clients', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'WiFi' }).click();
 const wifi = win(page, 'WiFi');
 await expect(row(wifi, 'phy0-ap0')).toContainText('WPA2-PSK');
 await expect(row(wifi, 'phy0-ap0').locator('.is-flags')).toHaveText('R');
 await expect(row(wifi, 'phy0-ap0').getByRole('gridcell').nth(8)).toHaveText('2');
 await row(wifi, 'phy0-ap0').dblclick();
 const item = win(page, 'WiFi Interface <RD-Test>');
 await item.getByLabel('Passphrase:').fill('short');
 await item.getByRole('button', { name: 'Apply' }).click();
 await expect(item.getByText('A passphrase has 8 to 63 characters')).toBeVisible();
 await item.getByLabel('Passphrase:').fill('routerdeck-test');
 await item.getByLabel('SSID:', { exact: true }).fill('RD-Home');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(row(wifi, 'phy0-ap0')).toContainText('RD-Home');

 await wifi.getByRole('tab', { name: 'Radios' }).click();
 await expect(row(wifi, 'radio0')).toContainText('2.4 GHz');
 await wifi.getByRole('tab', { name: 'Registration' }).click();
 await expect(row(wifi, 'laptop')).toContainText('dBm');
 await expect(wifi.getByRole('status').first()).toContainText('2 items');
});

test('PPP clients list PPPoE networks and create new ones', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'PPP' }).click();
 const ppp = win(page, 'PPP');
 await expect(row(ppp, 'pppoe_backup')).toContainText('customer@isp.example');
 await expect(row(ppp, 'pppoe_backup').locator('.is-flags')).toHaveText('X');
 await expect(ppp.locator('.rd-grid-comment')).toHaveText(';;; Backup line');
 await ppp.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New PPP Client');
 await item.getByLabel('Name:').fill('isp');
 await item.getByLabel('User:').fill('me@isp.example');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(item.getByText('PPPoE needs the Ethernet device it dials on')).toBeVisible();
 await item.getByLabel('Device:').selectOption('eth1');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(row(ppp, 'me@isp.example')).toContainText('pppoe');
});
