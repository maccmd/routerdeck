// Users, certificates, LEDs and disks against the simulated router.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const certificates = JSON.parse(await readFile(new URL('../fixtures/openwrt-25.12/certificates.json', import.meta.url), 'utf8'));
const firstTrusted = Buffer.from(certificates.trusted, 'base64').toString().match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----\n/)[0];

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
const toolbar = page => page.getByRole('toolbar', { name: 'Session' });
const question = (page, title) => page.getByRole('dialog', { name: title, exact: true }).filter({ has: page.locator('.rd-prompt-text') });
async function openSystem(page, label) {
 await page.getByRole('menuitem', { name: 'System', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('users are rpcd logins with groups and hashed passwords', async ({ page }) => {
 await openSystem(page, 'Users');
 const list = win(page, 'User List');
 await expect(row(list, 'root').locator('.is-flags')).toHaveText('C');
 await expect(row(list, 'root')).toContainText('system account root');
 await expect(row(list, 'monitor')).toContainText('read');
 await expect(row(list, 'monitor')).toContainText('own password');
 await expect(list).toContainText(';;; Read-only access for the NOC');
 await list.getByRole('button', { name: 'Add', exact: true }).click();
 const user = win(page, 'New User');
 await user.getByLabel('Name:').fill('operator');
 await user.getByLabel('Password:', { exact: true }).fill('s3cret-pass');
 await user.getByLabel('Confirm Password:').fill('s3cret');
 await user.getByRole('button', { name: 'Apply' }).click();
 await expect(user.getByText('The passwords do not match')).toBeVisible();
 await user.getByLabel('Confirm Password:').fill('s3cret-pass');
 await user.getByRole('button', { name: 'OK' }).click();
 await expect(row(list, 'operator')).toContainText('full');
 await expect(row(list, 'operator')).toContainText('own password');
 await row(list, 'operator').dblclick();
 const edit = win(page, 'User <operator>');
 await expect(edit.getByLabel('Password:', { exact: true })).toHaveAttribute('placeholder', 'unchanged');
 await edit.getByLabel('Group:').selectOption('custom');
 await edit.getByRole('group', { name: 'Read Groups:' }).getByLabel('luci-base — Grant access to basic LuCI procedures').check();
 await edit.getByRole('button', { name: 'OK' }).click();
 await expect(row(list, 'operator')).toContainText('luci-base (read)');
 await row(list, 'root').click();
 await page.keyboard.press('Delete');
 await expect(list.getByRole('alert')).toContainText('You are logged in as root');
 await page.getByRole('button', { name: 'Undo' }).click();
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect(row(list, 'operator')).toHaveCount(0);
});

test('certificates: the web server one, trusted authorities, regenerate and import', async ({ page }) => {
 await openSystem(page, 'Certificates');
 const list = win(page, 'Certificates');
 const web = row(list, 'web server');
 await expect(web.locator('.is-flags')).toHaveText('K');
 await expect(web).toContainText('OpenWrt');
 await expect(web).toContainText('self-signed');
 await expect(web).toContainText('EC P-256');
 await expect(web).toContainText('2027-11-17');
 await web.dblclick();
 const item = win(page, 'Certificate <web server>');
 await expect(item.getByRole('status', { name: 'SHA-256:' })).toHaveText('CB:35:87:54:41:A5:82:DB:57:06:0F:38:CC:7F:D7:B4:B6:6E:61:04:D7:8C:DF:0B:DB:FF:69:58:A0:DE:83:2C');
 await expect(item.getByRole('status', { name: 'Alternative Names:' })).toHaveText('OpenWrt');
 await item.getByRole('button', { name: 'Regenerate' }).click();
 await question(page, 'Regenerate').getByRole('button', { name: 'Regenerate' }).click();
 await expect(toolbar(page)).toContainText('New certificate; the web server restarts');
 await row(list, 'web server').click();
 await expect(list.getByRole('button', { name: 'Restore Previous' })).toBeEnabled();

 await list.getByRole('tab', { name: 'Trusted' }).click();
 await expect(list.locator('.rd-grid-row')).toHaveCount(3);
 await expect(row(list, 'AC RAIZ FNMT-RCM SERVIDORES SEGUROS')).toContainText('EC P-384');
 await expect(row(list, 'ACCVRAIZ1').locator('.is-flags')).toHaveText('AT');
 await expect(row(list, 'ACCVRAIZ1')).toContainText('RSA 4096');

 await list.getByRole('tab', { name: 'Certificates' }).click();
 await row(list, 'web server').click();
 const chooser = page.waitForEvent('filechooser');
 await list.getByRole('button', { name: 'Import…' }).click();
 await (await chooser).setFiles([
  { name: 'router.crt', mimeType: 'application/x-pem-file', buffer: Buffer.from(firstTrusted) },
  { name: 'router.key', mimeType: 'application/x-pem-file', buffer: Buffer.from('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n') }
 ]);
 const confirm = question(page, 'Import Certificate');
 await expect(confirm).toContainText('Use the certificate for ACCVRAIZ1, issued by itself, valid until 2030-12-31');
 await confirm.getByRole('button', { name: 'Import' }).click();
 await expect(toolbar(page)).toContainText('Certificate imported; the web server restarts');
 await expect(row(list, 'web server')).toContainText('ACCVRAIZ1');
});

test('LEDs: configured triggers and the board LEDs not set up yet', async ({ page }) => {
 await openSystem(page, 'LEDs');
 const list = win(page, 'LED Settings');
 await expect(row(list, 'LAN')).toContainText('br-lan link+tx+rx');
 await expect(row(list, 'green:wan').locator('.is-flags')).toHaveText(/^D/);
 // An LED that is not set up yet opens ready to be set up.
 await row(list, 'green:wan').dblclick();
 const led = win(page, 'LED <green:wan>');
 await expect(led.getByLabel('LED:')).toHaveValue('green:wan');
 await led.getByLabel('Name:').fill('WAN');
 await led.getByLabel('Trigger:').selectOption('timer');
 await led.getByLabel('On (ms):').fill('100');
 await led.getByLabel('Off (ms):').fill('900');
 await led.getByRole('button', { name: 'OK' }).click();
 await expect(row(list, 'WAN')).toContainText('100/900 ms');
 await expect(row(list, 'green:wan')).toHaveCount(1);
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect(row(list, 'WAN')).toHaveCount(0);
});

test('disks show file systems and mounts; mount points mount and unmount at once', async ({ page }) => {
 await openSystem(page, 'Disks');
 const disks = win(page, 'Disks');
 await expect(row(disks, 'sda1').locator('.is-flags')).toHaveText('MR');
 await expect(row(disks, 'sda1')).toContainText('/mnt/usb');
 await expect(row(disks, 'sda1')).toContainText('4.4 GiB of 29.3 GiB');
 await expect(row(disks, 'sda')).toContainText('Generic Flash Drive');
 await expect(row(disks, 'mmcblk0p2')).toContainText('rootfs');
 await row(disks, 'mmcblk0p2').click();
 await expect(disks.getByRole('button', { name: 'Unmount' })).toBeDisabled();
 await row(disks, 'sda1').click();
 await disks.getByRole('button', { name: 'Unmount' }).click();
 await expect(row(disks, 'sda1').locator('.is-flags')).toHaveText('R');
 await disks.getByRole('button', { name: 'Mount All' }).click();
 await expect(row(disks, 'sda1').locator('.is-flags')).toHaveText('MR');

 await disks.getByRole('tab', { name: 'Mount Points' }).click();
 await expect(row(disks, '/mnt/usb').locator('.is-flags')).toHaveText('M');
 await row(disks, '/mnt/usb').click();
 await page.keyboard.press('Control+d');
 await expect(row(disks, '/mnt/usb').locator('.is-flags')).toHaveText('X');
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect(row(disks, '/mnt/usb').locator('.is-flags')).toHaveText('M');
 await disks.getByRole('button', { name: 'Add', exact: true }).click();
 const mount = win(page, 'New Mount Point');
 await mount.getByLabel('File System:').selectOption({ label: 'mmcblk0p1 ext4 "kernel" 84173db5…' });
 await mount.getByLabel('Mount Point:').fill('/tmp');
 await mount.getByRole('button', { name: 'Apply' }).click();
 await expect(mount.getByText('/tmp belongs to the system')).toBeVisible();
 await mount.getByLabel('Mount Point:').fill('/mnt/kernel');
 await mount.getByRole('button', { name: 'OK' }).click();
 await expect(row(disks, '/mnt/kernel').locator('.is-flags')).toHaveText('M');
 await disks.getByRole('tab', { name: 'Settings' }).click();
 await disks.getByLabel('Mount Under /mnt:').check();
 await disks.getByRole('button', { name: 'Apply' }).click();
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Change mount settings');
});

test('the command line lists users, certificates and disks and adds a user', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'New Terminal' }).click();
 const term = win(page, 'Terminal');
 const input = term.getByRole('textbox', { name: /^Command/ });
 const output = term.getByRole('log', { name: 'Terminal output' });
 const run = async line => {
  await input.fill(line);
  await input.press('Enter');
  await expect(term.locator('.rd-cli-input')).not.toHaveClass(/is-busy/);
 };
 await run('/user print');
 await expect(output).toContainText('monitor');
 await run('/user add name=cli group=read password=cli-pass-1 confirm-password=cli-pass-1');
 await run('/user print where name=cli');
 await expect(output).toContainText('own password');
 await run('/certificate print');
 await expect(output).toContainText('web server');
 await run('/disk print where mounted-at=/mnt/usb');
 await expect(output).toContainText('sda1');
 await expect(output.locator('.is-error')).toHaveCount(0);
});
