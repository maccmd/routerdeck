// RouterDeck Console with simulated router data: lists, object windows,
// instant changes, Undo/Redo and Safe Mode. Every login gets its own
// simulated router, so tests do not affect each other.
import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

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
const rows = scope => scope.locator('.rd-grid-row');
const row = (scope, text) => rows(scope).filter({ hasText: text });
async function openIp(page, label) {
 await page.getByRole('menuitem', { name: 'IP', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}
async function maximize(window) {
 await window.locator('.rd-win-title').dblclick();
}

test('lists show live router data with RouterOS-style flags and comments', async ({ page }, info) => {
 await page.getByRole('menuitem', { name: 'Interfaces' }).click();
 const interfaces = win(page, 'Interface List');
 await expect(rows(interfaces)).toHaveCount(8);
 await expect(row(interfaces, 'wg0')).toHaveClass(/is-dynamic/);
 await expect(row(interfaces, 'eth0').locator('.is-flags')).toHaveText('RS');
 // Rates need two samples one second apart.
 await expect(row(interfaces, 'eth1').getByRole('gridcell').nth(5)).toHaveText(/bps$/, { timeout: 5000 });
 await interfaces.getByRole('tab', { name: 'Networks' }).click();
 await expect(rows(interfaces).first()).toContainText('loopback');
 await expect(row(interfaces, 'wan6')).toContainText('dhcpv6');

 await openIp(page, 'Routes');
 const routes = win(page, 'Route List');
 await expect(row(routes, '0.0.0.0/0').locator('.is-flags')).toHaveText('DA');
 await expect(row(routes, '10.10.0.0/16').locator('.is-flags')).toHaveText('AS');
 await expect(routes.locator('.rd-grid-comment')).toHaveText(';;; Lab network behind the test switch');
 await routes.getByLabel('Routing table').selectOption('local');
 await expect(rows(routes).first()).toContainText('local');

 await openIp(page, 'Firewall');
 const firewall = win(page, 'Firewall');
 await maximize(firewall);
 await expect(firewall.locator('.rd-grid-comment').first()).toHaveText(';;; Allow-DHCP-Renew');
 await expect(row(firewall, ' 23 ')).toHaveClass(/is-disabled/);
 await expect(firewall.getByRole('status')).toContainText('10 items');
 await firewall.getByRole('tab', { name: 'NAT' }).click();
 await expect(row(firewall, 'dst-nat')).toContainText('192.168.88.10');
 await expect(row(firewall, 'masquerade').locator('.is-flags')).toHaveText('D');
 await firewall.getByRole('tab', { name: 'Connections' }).click();
 await expect(firewall.getByRole('status')).toContainText('50 items');
 await expect(firewall.getByRole('status')).toContainText('50 tracked of 16384');
 await firewall.getByLabel('Find').fill('198.51.100.8');
 await expect(firewall.getByRole('status')).toContainText(/\d+ items out of 50/);
 await mkdir('output/playwright/screenshots', { recursive: true });
 await page.screenshot({ animations: 'disabled', path: `output/playwright/screenshots/console-data-${info.project.name}.png` });
 await firewall.getByRole('button', { name: 'Close Firewall' }).click();

 await openIp(page, 'DHCP Server');
 const dhcp = win(page, 'DHCP Server');
 await expect(row(dhcp, 'lan')).toContainText('192.168.88.100-192.168.88.249');
 await dhcp.getByRole('tab', { name: 'Leases' }).click();
 await expect(row(dhcp, 'nas')).toContainText('bound');
 await expect(row(dhcp, 'laptop').locator('.is-flags')).toHaveText('D');

 await page.getByRole('menuitem', { name: 'Log' }).click();
 const log = win(page, 'Log');
 await expect(rows(log).first()).toBeAttached();
 await expect(row(log, 'ntpd').first()).toHaveClass(/tone-error/);
});

test('add an address through its object window, then undo and redo', async ({ page }) => {
 await openIp(page, 'Addresses');
 const list = win(page, 'Address List');
 await expect(rows(list)).toHaveCount(4);
 await list.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Address');
 await item.getByLabel('Address:').fill('192.168.88.7');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(item.getByText('Enter an IPv4 address with a prefix')).toBeVisible();
 await item.getByLabel('Address:').fill('192.168.89.1/24');
 await expect(item.getByText('192.168.89.0')).toBeVisible();
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(item).toHaveCount(0);
 await expect(row(list, '192.168.89.1/24')).toContainText('lan (br-lan)');
 const undo = page.getByRole('button', { name: 'Undo' });
 await expect(undo).toHaveAttribute('title', 'Undo: Add address 192.168.89.1/24 to lan');
 await undo.click();
 await expect(row(list, '192.168.89.1/24')).toHaveCount(0);
 await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText('Undone: Add address 192.168.89.1/24 to lan');
 await page.getByRole('button', { name: 'Redo' }).click();
 await expect(row(list, '192.168.89.1/24')).toHaveCount(1);

 // Edit in place: Apply keeps the window open; Remove closes it.
 await row(list, '192.168.89.1/24').dblclick();
 const edit = win(page, 'Address <192.168.89.1/24>');
 await edit.getByLabel('Address:').fill('192.168.89.2/24');
 await edit.getByRole('button', { name: 'Apply' }).click();
 await expect(win(page, 'Address <192.168.89.2/24>')).toBeVisible();
 await win(page, 'Address <192.168.89.2/24>').getByRole('button', { name: 'Remove' }).click();
 await expect(row(list, '192.168.89')).toHaveCount(0);
 // Keyboard: Insert opens a new object window.
 await rows(list).first().click();
 await page.keyboard.press('Insert');
 await expect(win(page, 'New Address')).toBeVisible();
});

test('firewall rules disable, comment and reorder at once', async ({ page }) => {
 await openIp(page, 'Firewall');
 const firewall = win(page, 'Firewall');
 await maximize(firewall);
 const ping = row(firewall, 'icmp').first();
 await ping.click();
 await firewall.getByRole('button', { name: 'Disable' }).click();
 await expect(ping.locator('.is-flags')).toHaveText('X');
 await page.keyboard.press('Control+e');
 await expect(ping.locator('.is-flags')).toHaveText('');

 await row(firewall, ' 23 ').click();
 await firewall.getByRole('button', { name: 'Comment' }).click();
 const prompt = page.getByRole('dialog', { name: 'Comment Firewall Rule' });
 await prompt.getByLabel('Comment').fill('Old telnet block');
 await prompt.getByRole('button', { name: 'OK' }).click();
 await expect(firewall.locator('.rd-grid-comment').last()).toHaveText(';;; Old telnet block');

 // Drag rule #0 below rule #2.
 const first = rows(firewall).nth(0), third = rows(firewall).nth(2);
 await expect(first).toContainText('68');
 await first.dragTo(third, { targetPosition: { x: 40, y: 15 } });
 await expect(rows(firewall).nth(2)).toContainText('68');
 await expect(rows(firewall).nth(2).getByRole('gridcell').first()).toHaveText('2');
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Move firewall rule');

 // Context menu offers the same actions.
 await rows(firewall).nth(0).click({ button: 'right' });
 await page.getByRole('menuitem', { name: 'Disable' }).click();
 await expect(rows(firewall).nth(0).locator('.is-flags')).toHaveText('X');
});

test('new firewall rule: validation, chain-dependent zones and server-side check', async ({ page }) => {
 await openIp(page, 'Firewall');
 const firewall = win(page, 'Firewall');
 await firewall.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Firewall Rule');
 await expect(item.getByLabel('Out. Zone:')).toHaveCount(0);
 await item.getByLabel('Chain:').selectOption('forward');
 await expect(item.getByLabel('Out. Zone:')).toBeVisible();
 await item.getByLabel('Out. Zone:').selectOption('lan');
 await item.getByLabel('Protocol:').fill('tcp');
 await item.getByLabel('Dst. Port:').fill('http');
 await item.getByRole('button', { name: 'Apply' }).click();
 await expect(item.getByText('Enter ports such as 80')).toBeVisible();
 await item.getByLabel('Dst. Port:').fill('8443');
 await item.getByRole('tab', { name: 'Action' }).click();
 await item.getByLabel('Action:').selectOption('drop');
 await item.getByRole('button', { name: 'Apply' }).click();
 // After Apply the window becomes the new rule's window.
 await expect(page.getByRole('dialog', { name: /^Rule <#10>$/ })).toBeVisible();
 await expect(row(firewall, '8443')).toContainText('forward');
 await expect(row(firewall, '8443')).toContainText('drop');
});

test('make a dynamic lease static', async ({ page }) => {
 await openIp(page, 'DHCP Server');
 const dhcp = win(page, 'DHCP Server');
 await dhcp.getByRole('tab', { name: 'Leases' }).click();
 await row(dhcp, 'laptop').click();
 await dhcp.getByRole('button', { name: 'Make Static' }).click();
 await expect(row(dhcp, 'laptop').locator('.is-flags')).toHaveText('');
 await expect(row(dhcp, 'laptop')).toContainText('bound');
 await row(dhcp, 'laptop').dblclick();
 await expect(win(page, 'DHCP Lease <192.168.88.120>').getByLabel('Host Name:')).toHaveValue('laptop');
});

test('Safe Mode undoes its changes on request and after a lost connection', async ({ page }) => {
 const safe = page.getByRole('button', { name: 'Safe Mode', exact: true });
 await safe.click();
 await expect(safe).toHaveAttribute('aria-pressed', 'true');
 await openIp(page, 'Routes');
 const routes = win(page, 'Route List');
 await routes.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Route');
 await item.getByLabel('Dst. Address:').fill('172.16.0.0/12');
 await item.getByLabel('Gateway:').fill('192.168.88.3');
 await item.getByLabel('Interface:').selectOption('lan');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(row(routes, '172.16.0.0/12')).toHaveCount(1);
 await page.getByRole('button', { name: 'Undo Safe Mode changes' }).click();
 await expect(row(routes, '172.16.0.0/12')).toHaveCount(0);
 await expect(safe).toHaveAttribute('aria-pressed', 'false');
 await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText('Safe Mode changes undone: restored network');

 // Leave Safe Mode keeping changes.
 await safe.click();
 await routes.getByRole('button', { name: 'Add', exact: true }).click();
 await win(page, 'New Route').getByLabel('Dst. Address:').fill('172.17.0.0/16');
 await win(page, 'New Route').getByLabel('Interface:').selectOption('lan');
 await win(page, 'New Route').getByRole('button', { name: 'OK' }).click();
 await safe.click();
 await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText('Safe Mode off; changes kept');
 await expect(row(routes, '172.17.0.0/16')).toHaveCount(1);

 // A watchdog rollback while the tab was away is reported afterwards.
 await safe.click();
 await routes.getByRole('button', { name: 'Add', exact: true }).click();
 await win(page, 'New Route').getByLabel('Dst. Address:').fill('172.18.0.0/16');
 await win(page, 'New Route').getByLabel('Interface:').selectOption('lan');
 await win(page, 'New Route').getByRole('button', { name: 'OK' }).click();
 await expect(row(routes, '172.18.0.0/16')).toHaveCount(1);
 await page.evaluate(async () => {
  const sid = JSON.parse(sessionStorage.getItem('routerdeck.console.session')).sid;
  await fetch('/ubus', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: [sid, 'routerdeck', 'safemode', { action: '__expire' }] }) });
 });
 await page.reload();
 await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText(/Safe Mode timed out at \d{2}:\d{2}:\d{2}: restored network, firewall, dhcp/, { timeout: 8000 });
 await expect(row(win(page, 'Route List'), '172.18.0.0/16')).toHaveCount(0);
 await expect(row(win(page, 'Route List'), '172.17.0.0/16')).toHaveCount(1);
});

test('windows menu, column chooser, theme and terminal', async ({ page }) => {
 await openIp(page, 'Addresses');
 const list = win(page, 'Address List');
 await list.locator('.rd-grid-head').click({ button: 'right' });
 await page.getByRole('menuitemcheckbox', { name: 'Network' }).click();
 await expect(list.getByRole('columnheader')).toHaveText(['', 'Address ▲', 'Interface']);
 await page.reload();
 await expect(win(page, 'Address List').getByRole('columnheader')).toHaveText(['', 'Address ▲', 'Interface']);

 await page.getByRole('menuitem', { name: 'Log' }).click();
 await page.getByRole('menuitem', { name: 'Windows' }).click();
 await page.getByRole('menuitem', { name: 'Tile' }).click();
 const [a, b] = [await win(page, 'Address List').boundingBox(), await win(page, 'Log').boundingBox()];
 expect(Math.round(a.y)).toBe(Math.round(b.y));
 expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);
 await page.getByRole('menuitem', { name: 'Windows' }).click();
 await page.getByRole('menuitem', { name: 'Minimize All' }).click();
 await expect(page.getByRole('button', { name: 'Restore Log' })).toBeVisible();
 await page.getByRole('menuitem', { name: 'Windows' }).click();
 await page.getByRole('menuitem', { name: 'Close All' }).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);

 const toggle = page.getByRole('button', { name: /^Theme: follow system/ });
 await toggle.click();
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
 await page.getByRole('button', { name: /^Theme: light/ }).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

 await page.getByRole('menuitem', { name: 'New Shell' }).click();
 await expect(win(page, 'Shell')).toContainText('apk add ttyd');
});
