// Tabs added to Interfaces, Firewall and DHCP, and the Routing, ARP and
// Services lists, against the simulated router.
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
const undoTitle = page => page.getByRole('button', { name: 'Undo' });
async function open(page, ...labels) {
 for (const label of labels) await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('address lists hold entries that filter rules match', async ({ page }) => {
 await open(page, 'IP', 'Firewall');
 const firewall = win(page, 'Firewall');
 await firewall.getByRole('tab', { name: 'Address Lists' }).click();
 await expect(row(firewall, '198.51.100.0/24')).toContainText('blocklist');
 await firewall.getByRole('button', { name: 'Add', exact: true }).click();
 const entry = win(page, 'New Address List Entry');
 await entry.getByLabel('List:').fill('admins');
 await entry.getByLabel('Address:').fill('192.0.2.7');
 await entry.getByRole('button', { name: 'OK' }).click();
 await expect(row(firewall, '192.0.2.7')).toContainText('admins');
 await expect(undoTitle(page)).toHaveAttribute('title', 'Undo: Add 192.0.2.7 to address list admins');

 await firewall.getByRole('tab', { name: 'Filter Rules' }).click();
 await firewall.locator('.rd-grid-comment').filter({ hasText: 'Allow-Ping' }).dblclick();
 const rule = page.getByRole('dialog', { name: /^Rule </ });
 await rule.getByRole('tab', { name: 'Advanced' }).click();
 await rule.getByLabel('Src. Address List:').selectOption('admins');
 await rule.getByRole('button', { name: 'OK' }).click();
 await firewall.getByRole('tab', { name: 'Address Lists' }).click();
 await expect(row(firewall, '192.0.2.7').getByRole('gridcell').last()).toHaveText('1');
});

test('DHCP Networks and Options edit the same options', async ({ page }) => {
 await open(page, 'IP', 'DHCP Server');
 const dhcp = win(page, 'DHCP Server');
 await dhcp.getByRole('tab', { name: 'Networks' }).click();
 await expect(row(dhcp, '192.168.88.0/24')).toContainText('192.168.88.1');
 await row(dhcp, '192.168.88.0/24').dblclick();
 const network = win(page, 'DHCP Network <192.168.88.0/24>');
 await network.getByLabel('Gateway:').fill('192.168.88.254');
 await network.getByRole('button', { name: 'OK' }).click();
 await expect(row(dhcp, '192.168.88.0/24')).toContainText('192.168.88.254');
 await dhcp.getByRole('tab', { name: 'Options' }).click();
 await expect(row(dhcp, '192.168.88.254')).toContainText('router');
 await expect(row(dhcp, 'ntp-server')).toContainText('192.168.88.1');
});

test('Interfaces has Ethernet, VLAN and WireGuard tabs', async ({ page }) => {
 await open(page, 'Interfaces');
 const list = win(page, 'Interface List');
 await list.getByRole('tab', { name: 'Ethernet' }).click();
 await row(list, 'eth1').first().dblclick();
 const port = win(page, 'Ethernet <eth1>');
 await port.getByLabel('Speed:').selectOption('100');
 await port.getByLabel('Duplex:').selectOption('full');
 await port.getByRole('button', { name: 'OK' }).click();
 await expect(undoTitle(page)).toHaveAttribute('title', 'Undo: Change link settings of eth1');

 await list.getByRole('tab', { name: 'WireGuard', exact: true }).click();
 await expect(row(list, 'wg0')).toContainText('51820');
 await list.getByRole('button', { name: 'Add', exact: true }).click();
 const wg = win(page, 'New WireGuard Interface');
 await wg.getByLabel('Name:').fill('wg1');
 await wg.getByLabel('Listen Port:').fill('51821');
 await wg.getByLabel('Addresses:').fill('10.9.0.1/24');
 await wg.getByRole('button', { name: 'OK' }).click();
 // The key was made on the router; its public half shows once it is up.
 await expect(row(list, 'wg1')).toContainText(/[A-Za-z0-9+/]{43}=/);
 await list.getByRole('tab', { name: 'WireGuard Peers' }).click();
 await expect(row(list, 'phone')).toContainText('ago');
 await expect(row(list, 'phone').locator('.is-flags')).toHaveText('C');
 await list.getByRole('tab', { name: 'VLAN' }).click();
 await list.getByRole('button', { name: 'Add', exact: true }).click();
 const vlan = win(page, 'New VLAN');
 await vlan.getByLabel('Name:').fill('eth1.30');
 await vlan.getByLabel('Interface:').selectOption('eth1');
 await vlan.getByLabel('VLAN ID:').fill('30');
 await vlan.getByRole('button', { name: 'OK' }).click();
 await expect(row(list, 'eth1.30')).toContainText('30');
});

test('Routing rules, ARP and IP services', async ({ page }) => {
 await open(page, 'Routing', 'Rules');
 const rules = win(page, 'Routing Rules');
 await expect(row(rules, '192.168.88.128/25').locator('.is-flags')).toHaveText('A');
 await expect(row(rules, '32766').first().locator('.is-flags')).toHaveText('DA');
 await rules.getByRole('button', { name: 'Add', exact: true }).click();
 const rule = win(page, 'New Routing Rule');
 await rule.getByLabel('Priority:').fill('1100');
 await rule.getByLabel('Src. Address:').fill('10.0.0.0/8');
 await rule.getByLabel('Table:').fill('200');
 await rule.getByRole('button', { name: 'OK' }).click();
 await expect(row(rules, '10.0.0.0/8').locator('.is-flags')).toHaveText('A');

 await open(page, 'IP', 'ARP');
 const arp = win(page, 'ARP List');
 await expect(row(arp, '192.168.88.250').locator('.is-flags')).toHaveText('DI');
 await row(arp, '192.168.88.120').click();
 await arp.getByRole('button', { name: 'Make Static' }).click();
 await expect(row(arp, '192.168.88.120').locator('.is-flags')).toHaveText('DCS');

 await open(page, 'IP', 'Services');
 const services = win(page, 'IP Service List');
 await row(services, 'ssh').dblclick();
 const ssh = win(page, 'Service <ssh>');
 await ssh.getByLabel('Port:').fill('2222');
 await ssh.getByLabel('Password Login:', { exact: true }).uncheck();
 await ssh.getByRole('button', { name: 'OK' }).click();
 await expect(row(services, 'ssh')).toContainText('2222');
 await expect(row(services, 'ssh')).toContainText('keys only');
 await row(services, 'www-ssl').click();
 await expect(services.getByRole('button', { name: 'Disable' })).toBeDisabled();
});
