// IP Settings, IP Pool, Mangle, Raw and firewall settings, advanced DNS,
// zone and WiFi options and the WiFi access list, against the simulated router.
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
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ has: scope.page().getByRole('gridcell', { name: text, exact: true }) });
const undoButton = page => page.getByRole('button', { name: 'Undo' });
async function openIp(page, label) {
 await page.getByRole('menuitem', { name: 'IP', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('IP Settings edit kernel settings in sysctl.conf; IP Pool edits DHCP ranges', async ({ page }) => {
 await openIp(page, 'Settings');
 const settings = win(page, 'IP Settings');
 await expect(settings.getByLabel('IP Forward:')).toBeChecked();
 await settings.getByLabel('RP Filter:').selectOption('2');
 await settings.getByRole('tab', { name: 'Connections' }).click();
 await expect(settings.getByLabel('Max Connections:')).toHaveValue('47104');
 await settings.getByLabel('Max Connections:').fill('100');
 await settings.getByRole('button', { name: 'Apply' }).click();
 await expect(settings.getByText('Max Connections is 1024 to 4194304')).toBeVisible();
 await settings.getByLabel('Max Connections:').fill('65536');
 await settings.getByRole('button', { name: 'Apply' }).click();
 await expect(undoButton(page)).toHaveAttribute('title', 'Undo: Change IP settings');
 await expect(settings.getByLabel('Max Connections:')).toHaveValue('65536');
 await settings.getByRole('tab', { name: 'General' }).click();
 await expect(settings.getByLabel('RP Filter:')).toHaveValue('2');
 await undoButton(page).click();
 await settings.getByRole('tab', { name: 'Connections' }).click();
 await expect(settings.getByLabel('Max Connections:')).toHaveValue('47104');

 await openIp(page, 'Pool');
 const pools = win(page, 'IP Pool');
 await expect(row(pools, 'lan')).toContainText('192.168.88.100-192.168.88.249');
 await expect(row(pools, 'lan')).toContainText('150');
 await row(pools, 'lan').dblclick();
 const pool = win(page, 'IP Pool <lan>');
 await pool.getByLabel('Addresses:').fill('192.168.89.10-192.168.89.20');
 await pool.getByRole('button', { name: 'Apply' }).click();
 await expect(pool.getByText(/must lie inside 192\.168\.88\.0\/24/)).toBeVisible();
 await pool.getByLabel('Addresses:').fill('192.168.88.50-192.168.88.99');
 await pool.getByRole('button', { name: 'OK' }).click();
 await expect(row(pools, 'lan')).toContainText('192.168.88.50-192.168.88.99');
 await expect(row(pools, 'lan')).toContainText('50');
});

test('Mangle marks and DSCP, Raw notrack, and firewall settings', async ({ page }) => {
 await openIp(page, 'Firewall');
 const firewall = win(page, 'Firewall');
 await firewall.getByRole('tab', { name: 'Mangle' }).click();
 await firewall.getByRole('button', { name: 'Add', exact: true }).click();
 const mark = win(page, 'New Mangle Rule');
 await mark.getByLabel('In. Zone:').selectOption('lan');
 await mark.getByLabel('Protocol:').fill('tcp');
 await mark.getByLabel('Dst. Port:', { exact: true }).fill('443');
 await mark.getByRole('tab', { name: 'Action' }).click();
 await mark.getByLabel('New Mark:').fill('mark me');
 await mark.getByRole('button', { name: 'Apply' }).click();
 await expect(mark.getByText('A mark such as 0x10 or 0x10/0xff')).toBeVisible();
 await mark.getByLabel('New Mark:').fill('0x10/0xff');
 await mark.getByRole('button', { name: 'OK' }).click();
 await expect(row(firewall, '0x10/0xff')).toContainText('prerouting');
 await expect(row(firewall, '0x10/0xff')).toContainText('mark');

 await firewall.getByRole('button', { name: 'Add', exact: true }).click();
 const dscp = win(page, 'New Mangle Rule');
 await dscp.getByLabel('Chain:').selectOption('forward');
 await dscp.getByLabel('In. Zone:').selectOption('lan');
 await dscp.getByLabel('Out. Zone:').selectOption('*');
 await dscp.getByRole('tab', { name: 'Action' }).click();
 await dscp.getByLabel('Action:').selectOption('dscp');
 await dscp.getByRole('button', { name: 'Apply' }).click();
 await expect(dscp.getByText('For forward, name zones on both sides or "any" on both')).toBeVisible();
 await dscp.getByRole('tab', { name: 'General' }).click();
 await dscp.getByLabel('Out. Zone:').selectOption('wan');
 await dscp.getByRole('tab', { name: 'Action' }).click();
 await dscp.getByLabel('New DSCP:').fill('EF');
 await dscp.getByRole('button', { name: 'OK' }).click();
 await expect(row(firewall, 'EF')).toContainText('forward');
 // Filter Rules show only accept, drop and reject.
 await firewall.getByRole('tab', { name: 'Filter Rules' }).click();
 await expect(firewall.locator('.rd-grid-row').filter({ hasText: '0x10/0xff' })).toHaveCount(0);

 await firewall.getByRole('tab', { name: 'Raw' }).click();
 await firewall.getByRole('button', { name: 'Add', exact: true }).click();
 const raw = win(page, 'New Raw Rule');
 await raw.getByLabel('Dst. Address:', { exact: true }).fill('192.168.88.10');
 await raw.getByRole('button', { name: 'OK' }).click();
 await expect(row(firewall, '192.168.88.10')).toContainText('notrack');

 await firewall.getByRole('tab', { name: 'Settings' }).click();
 await expect(firewall.getByLabel('SYN Flood Protection:')).toBeChecked();
 await firewall.getByRole('tab', { name: 'FastPath' }).click();
 await firewall.getByLabel('FastPath (Software Offload):').check();
 await firewall.getByRole('button', { name: 'Apply' }).click();
 await expect(undoButton(page)).toHaveAttribute('title', 'Undo: Change firewall settings');
 await firewall.getByRole('tab', { name: 'Zones' }).click();
 await row(firewall, 'lan').dblclick();
 const zone = win(page, 'Zone <lan>');
 await zone.getByRole('tab', { name: 'Advanced' }).click();
 await zone.getByLabel('Log Dropped:').check();
 await zone.getByLabel('Log Limit:').fill('5/minute');
 await zone.getByRole('button', { name: 'OK' }).click();
 await expect(undoButton(page)).toHaveAttribute('title', 'Undo: Change zone lan');
});

test('DNS advanced options, WiFi roaming and the access list', async ({ page }) => {
 await openIp(page, 'DNS');
 const dns = win(page, 'DNS Settings');
 await dns.getByRole('tab', { name: 'Advanced' }).click();
 await expect(dns.getByLabel("Don't Forward Plain Names:")).toBeChecked();
 await dns.getByLabel('Max Concurrent Queries:').fill('300');
 await dns.getByLabel('Filter IPv6 Answers:').check();
 await dns.getByRole('button', { name: 'Apply' }).click();
 await expect(undoButton(page)).toHaveAttribute('title', 'Undo: Change DNS settings');

 await page.getByRole('menuitem', { name: 'WiFi', exact: true }).click();
 const wifi = win(page, 'WiFi');
 await row(wifi, 'RD-Test').first().dblclick();
 const iface = page.getByRole('dialog', { name: /^WiFi Interface </ });
 await iface.getByRole('tab', { name: 'Roaming' }).click();
 await iface.getByLabel('Fast Roaming (802.11r):').check();
 await iface.getByLabel('Mobility Domain:').fill('xyz');
 await iface.getByRole('button', { name: 'Apply' }).click();
 await expect(iface.getByText('Four hexadecimal digits')).toBeVisible();
 await iface.getByLabel('Mobility Domain:').fill('4f57');
 await iface.getByRole('button', { name: 'OK' }).click();
 await expect(undoButton(page)).toHaveAttribute('title', /^Undo: Change WiFi/);

 await wifi.getByRole('tab', { name: 'Access List' }).click();
 await wifi.getByRole('button', { name: 'Add', exact: true }).click();
 const entry = win(page, 'New Access List Entry');
 await entry.getByLabel('MAC Address:').fill('52:54:00:AA:10:05');
 await entry.getByRole('button', { name: 'OK' }).click();
 await expect(row(wifi, '52:54:00:aa:10:05')).toContainText('deny');
 await wifi.getByRole('button', { name: 'Add', exact: true }).click();
 const second = win(page, 'New Access List Entry');
 await second.getByLabel('MAC Address:').fill('52:54:00:aa:10:06');
 await second.getByLabel('Action:').selectOption('allow');
 await second.getByRole('button', { name: 'Apply' }).click();
 await expect(second.getByText(/already denies its listed clients/)).toBeVisible();
 await second.getByRole('button', { name: 'Cancel' }).click();
 await row(wifi, '52:54:00:aa:10:05').click();
 await page.keyboard.press('Delete');
 await expect(row(wifi, '52:54:00:aa:10:05')).toHaveCount(0);
});

test('the command line reaches the new menus', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'New Terminal' }).click();
 const term = win(page, 'Terminal');
 const input = term.getByRole('textbox', { name: /^Command/ });
 const output = term.getByRole('log', { name: 'Terminal output' });
 const run = async line => {
  await input.fill(line);
  await input.press('Enter');
  await expect(term.locator('.rd-cli-input')).not.toHaveClass(/is-busy/);
 };
 await run('/ip settings print');
 await expect(output).toContainText('max-connections: 47104');
 await run('/ip settings set tcp-syn-cookies=no');
 await run('/ip pool print');
 await expect(output).toContainText('192.168.88.100-192.168.88.249');
 await run('/ip firewall mangle add chain=postrouting out-zone=wan action=dscp new-dscp=CS1 comment=bulk');
 await run('/ip firewall mangle print');
 await expect(output).toContainText(';;; bulk');
 await expect(output).toContainText('postrouting');
 await run('/ip firewall settings print');
 await expect(output).toContainText('drop-invalid: no');
 await expect(output.locator('.is-error')).toHaveCount(0);
});
