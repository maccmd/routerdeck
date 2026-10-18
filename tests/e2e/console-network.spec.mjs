// IPv6 and Bridge windows against the simulated router (one per login).
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
const rows = scope => scope.locator('.rd-grid-row');
const row = (scope, text) => rows(scope).filter({ hasText: text });
async function openIpv6(page, label) {
 await page.getByRole('menuitem', { name: 'IPv6' }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('IPv6 addresses show static, pool and link-local entries and accept new ones', async ({ page }) => {
 await openIpv6(page, 'Addresses');
 const list = win(page, 'IPv6 Address List');
 await expect(row(list, 'fd00:88::1/64').locator('.is-flags')).toHaveText('G');
 await expect(row(list, 'fd50:b8c1:5fb2::1/60')).toContainText('fd50:b8c1:5fb2::/60');
 await expect(row(list, 'fd50:b8c1:5fb2::1/60').locator('.is-flags')).toHaveText('DG');
 await expect(row(list, 'fe80::5054:ff:fe12:3456/64').locator('.is-flags')).toHaveText('DL');
 await expect(row(list, '2001:db8:42::1234/128')).toContainText('wan6');

 await list.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New IPv6 Address');
 await item.getByLabel('Address:').fill('fd00:89::');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(item.getByText('Enter an IPv6 address with a prefix')).toBeVisible();
 await item.getByLabel('Address:').fill('FD00:89:0::1/64');
 await expect(item.getByText('fd00:89::/64')).toBeVisible();
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(row(list, 'fd00:89::1/64')).toContainText('lan (br-lan)');
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Add IPv6 address fd00:89::1/64 to lan');
});

test('IPv6 routes merge the kernel table with route6 sections', async ({ page }) => {
 await openIpv6(page, 'Routes');
 const routes = win(page, 'IPv6 Route List');
 await expect(row(routes, '2001:db8:100::/48').locator('.is-flags')).toHaveText('AS');
 await expect(routes.locator('.rd-grid-comment')).toHaveText(';;; Lab IPv6 prefix');
 await expect(row(routes, '::/0').locator('.is-flags')).toHaveText('DA');
 await expect(row(routes, 'fe80::/64').first().locator('.is-flags')).toHaveText('DAC');
 await routes.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New IPv6 Route');
 await item.getByLabel('Dst. Address:').fill('2001:db8:300::/48');
 await item.getByLabel('Gateway:').fill('FD00:88::3');
 await item.getByLabel('Interface:').selectOption('lan');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(row(routes, '2001:db8:300::/48')).toContainText('fd00:88::3');
 await expect(row(routes, '2001:db8:300::/48').locator('.is-flags')).toHaveText('AS');
});

test('bridge window: bridges, ports with PVIDs and VLANs', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'Bridge' }).click();
 const bridge = win(page, 'Bridge');
 await expect(row(bridge, 'br-iot')).toContainText('eth2 eth3');
 await expect(row(bridge, 'br-iot').getByRole('gridcell').nth(7)).toHaveText('yes');
 await row(bridge, 'br-lan').click();
 await bridge.getByRole('button', { name: 'Remove' }).click();
 await expect(bridge.getByRole('alert')).toHaveText('Bridge br-lan is used by network lan');

 await bridge.getByRole('tab', { name: 'Ports' }).click();
 await expect(row(bridge, 'eth2')).toContainText('br-iot');
 await expect(row(bridge, 'eth2').getByRole('gridcell').nth(3)).toHaveText('10');
 await expect(row(bridge, 'eth3').getByRole('gridcell').nth(4)).toHaveText('10 20');

 await bridge.getByRole('tab', { name: 'VLANs' }).click();
 await expect(rows(bridge)).toHaveCount(2);
 await expect(bridge.locator('.rd-grid-comment')).toHaveText(';;; Cameras');
 await bridge.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Bridge VLAN');
 await item.getByLabel('Bridge:').selectOption('br-iot');
 await item.getByLabel('VLAN ID:').fill('30');
 await item.getByRole('group', { name: 'Untagged' }).getByLabel('eth2').check();
 await item.getByRole('group', { name: 'PVID Ports' }).getByLabel('eth2').check();
 await item.getByRole('button', { name: 'Apply' }).click();
 await expect(item.getByText('eth2 already has PVID 10')).toBeVisible();
 await item.getByRole('group', { name: 'PVID Ports' }).getByLabel('eth2').uncheck();
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(row(bridge, ' 30 ')).toContainText('eth2');

 // Removing a port also takes it out of every VLAN of its bridge.
 await bridge.getByRole('tab', { name: 'Ports' }).click();
 await row(bridge, 'eth3').click();
 await page.keyboard.press('Delete');
 await expect(row(bridge, 'eth3')).toHaveCount(0);
 await bridge.getByRole('tab', { name: 'VLANs' }).click();
 await expect(row(bridge, ' 20 ').getByRole('gridcell').nth(3)).toHaveText('');
});
