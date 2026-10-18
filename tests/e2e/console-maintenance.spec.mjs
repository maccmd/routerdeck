// Packages, scripts, files, backup restore, firmware and reset against the
// simulated router.
import { test, expect } from '@playwright/test';
import { gzipSync } from 'node:zlib';

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
const toolbar = page => page.getByRole('toolbar', { name: 'Session' });
async function openSystem(page, label) {
 await page.getByRole('menuitem', { name: 'System', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}
async function choose(page, click, name, data) {
 const chooser = page.waitForEvent('filechooser');
 await click();
 await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(data) });
}
async function confirm(page, title, text) {
 const dialog = page.getByRole('dialog', { name: title, exact: true }).filter({ has: page.locator('.rd-prompt-text') });
 await expect(dialog).toContainText(text);
 return dialog;
}

test('packages install, upgrade and uninstall as jobs with their output', async ({ page }) => {
 await openSystem(page, 'Packages');
 const list = win(page, 'Package List');
 await expect(row(list, 'dnsmasq').locator('.is-flags')).toHaveText('U');
 await expect(row(list, 'dnsmasq')).toContainText('2.91-r2');
 await list.getByRole('button', { name: 'Install…' }).click();
 const install = win(page, 'Install Package');
 await install.getByLabel('Packages:').fill('tcpdump');
 await install.getByRole('button', { name: 'Install', exact: true }).click();
 const job = win(page, 'Install tcpdump');
 await expect(job.getByRole('log', { name: 'Output' })).toContainText('Installing libpcap1');
 await expect(job.getByRole('status')).toContainText('finished');
 await expect(job).toContainText('apk add tcpdump');
 await job.getByRole('button', { name: 'Close', exact: true }).click();
 await expect(row(list, 'tcpdump')).toBeVisible();
 await expect(row(list, 'libpcap1').locator('.is-flags')).toHaveText('D');
 // A failed operation says so.
 await install.getByLabel('Packages:').fill('nosuchpkg');
 await install.getByRole('button', { name: 'Install', exact: true }).click();
 await expect(win(page, 'Install nosuchpkg').getByRole('status')).toContainText('failed with exit code 1');
 await expect(win(page, 'Install nosuchpkg').getByRole('log', { name: 'Output' })).toContainText('nosuchpkg (no such package)');
 await win(page, 'Install nosuchpkg').getByRole('button', { name: 'Close', exact: true }).click();
 await install.getByRole('button', { name: 'Close', exact: true }).click();

 await row(list, 'dnsmasq').click();
 await list.getByRole('button', { name: 'Upgrade' }).click();
 await expect(win(page, 'Upgrade dnsmasq').getByRole('status')).toContainText('finished');
 await win(page, 'Upgrade dnsmasq').getByRole('button', { name: 'Close', exact: true }).click();
 await expect(row(list, 'dnsmasq')).toContainText('2.91-r2');
 await expect(row(list, 'dnsmasq').locator('.is-flags')).toHaveText('');

 await row(list, 'tcpdump').click();
 await list.getByRole('button', { name: 'Uninstall' }).click();
 const question = await confirm(page, 'Uninstall', 'Uninstall tcpdump?');
 await question.getByRole('button', { name: 'Uninstall' }).click();
 await expect(win(page, 'Uninstall tcpdump').getByRole('status')).toContainText('finished');
 await expect(row(list, 'tcpdump')).toHaveCount(0);
 // Not configuration changes: nothing to undo.
 await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('scripts keep their lines, run with their output, and undo like settings', async ({ page }) => {
 await openSystem(page, 'Scripts');
 const scripts = win(page, 'Scripts');
 await scripts.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Script');
 await item.getByLabel('Name:').fill('hello');
 await item.getByLabel('Source:').fill('# greet\necho hello\necho "from the router"\nexit 0');
 await expect(item).toContainText('/usr/libexec/routerdeck/run-script hello');
 await item.getByRole('button', { name: 'Apply' }).click();
 await expect(page.getByRole('dialog', { name: 'Script <hello>' })).toBeVisible();
 await expect(row(scripts, 'hello')).toContainText('echo hello');
 await expect(row(scripts, 'hello')).toContainText('4');
 await page.getByRole('dialog', { name: 'Script <hello>' }).getByRole('button', { name: 'Run Script' }).click();
 const job = win(page, 'Script hello');
 await expect(job.getByRole('log', { name: 'Output' })).toHaveText('hello\nfrom the router');
 await expect(job.getByRole('status')).toContainText('finished');
 await expect(job.getByRole('button', { name: 'Stop' })).toBeDisabled();
 await expect(toolbar(page)).not.toContainText('failed');
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect(row(scripts, 'hello')).toHaveCount(0);
 await scripts.getByRole('tab', { name: 'Jobs' }).click();
 await expect(scripts.locator('.rd-statusbar')).toContainText('Scripts keep running when their window is closed');
});

test('Files browses, uploads, downloads, creates folders and removes', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'Files', exact: true }).click();
 const files = win(page, 'File List');
 await expect(row(files, 'etc')).toContainText('directory');
 await row(files, 'etc').dblclick();
 await expect(files.getByLabel('Path')).toHaveValue('/etc');
 await expect(row(files, 'localtime')).toContainText('→ /tmp/localtime');
 await row(files, 'config').dblclick();
 await expect(row(files, 'network')).toContainText('rw-------');
 await files.getByLabel('Path').fill('/tmp');
 await files.getByRole('button', { name: 'Go' }).click();
 await expect(row(files, 'dhcp.leases')).toBeVisible();
 await choose(page, () => files.getByRole('button', { name: 'Upload…' }).click(), 'notes.txt', 'remember the milk\n');
 await expect(row(files, 'notes.txt')).toContainText('18 B');
 await row(files, 'notes.txt').click();
 const download = page.waitForEvent('download');
 await files.getByRole('button', { name: 'Download' }).click();
 expect((await download).suggestedFilename()).toBe('notes.txt');
 await files.getByRole('button', { name: 'New Folder' }).click();
 await page.getByRole('dialog', { name: 'New Folder' }).getByRole('textbox').fill('backups');
 await page.getByRole('dialog', { name: 'New Folder' }).getByRole('button', { name: 'OK' }).click();
 await expect(row(files, 'backups')).toContainText('directory');
 await row(files, 'notes.txt').click();
 await files.getByRole('button', { name: 'Remove' }).click();
 const question = await confirm(page, 'Remove', 'Remove /tmp/notes.txt?');
 await question.getByRole('button', { name: 'Remove' }).click();
 await expect(row(files, 'notes.txt')).toHaveCount(0);
 await files.getByRole('button', { name: 'Up', exact: true }).click();
 await row(files, 'proc').click();
 await files.getByRole('button', { name: 'Remove' }).click();
 await (await confirm(page, 'Remove', 'Remove /proc?')).getByRole('button', { name: 'Remove' }).click();
 await expect(files.getByRole('alert')).toContainText('/proc cannot be removed here');
});

test('a backup is checked before it is restored; firmware the router rejects is not flashed', async ({ page }) => {
 await openSystem(page, 'Backup');
 const backup = win(page, 'Backup');
 await choose(page, () => backup.getByRole('button', { name: 'Restore Backup…' }).click(), 'notes.txt', 'not a backup');
 await expect(backup.getByRole('alert')).toContainText('This is not a configuration backup');
 await choose(page, () => backup.getByRole('button', { name: 'Restore Backup…' }).click(), 'backup.tar.gz', gzipSync('etc/config/network'));
 const question = await confirm(page, 'Restore Backup', 'Restore 8 files from this backup and reboot?');
 await question.getByRole('button', { name: 'Restore and Reboot' }).click();
 await expect(toolbar(page)).toContainText('The backup was restored; the router is rebooting');

 await openSystem(page, 'Firmware');
 const firmware = win(page, 'Firmware');
 await expect(firmware.getByRole('status', { name: 'Current:' })).not.toHaveText('—');
 await choose(page, () => firmware.getByRole('button', { name: 'Upload…' }).click(), 'random.bin', 'garbage');
 await expect(firmware.getByRole('alert')).toContainText('The router rejected this image (failed: fwtool_device_match); it was not flashed');
 await firmware.getByLabel('Keep Settings:').uncheck();
 await choose(page, () => firmware.getByRole('button', { name: 'Upload…' }).click(), 'openwrt-sysupgrade.bin', 'ROUTERDECK-TEST-FIRMWARE and the rest');
 const flash = await confirm(page, 'Flash Firmware', 'Flash it and erase the settings?');
 await flash.getByRole('button', { name: 'Flash' }).click();
 await expect(toolbar(page)).toContainText('Flashing the firmware; the router reboots when it is done');

 await openSystem(page, 'Reset Configuration');
 const reset = await confirm(page, 'Reset Configuration', 'Erase every setting and installed package of routerdeck-preview');
 await reset.getByRole('button', { name: 'Reset' }).click();
 await expect(toolbar(page)).toContainText('The configuration is being reset');
});

test('the command line runs scripts and package operations with their output', async ({ page }) => {
 await openSystem(page, 'Scripts');
 const scripts = win(page, 'Scripts');
 await scripts.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Script');
 await item.getByLabel('Name:').fill('report');
 await item.getByLabel('Source:').fill('echo all good\nexit 2');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(row(scripts, 'report')).toBeVisible();
 await page.getByRole('menuitem', { name: 'New Terminal' }).click();
 const term = win(page, 'Terminal');
 const input = term.getByRole('textbox', { name: /^Command/ });
 const output = term.getByRole('log', { name: 'Terminal output' });
 const run = async line => {
  await input.fill(line);
  await input.press('Enter');
  await expect(term.locator('.rd-cli-input')).not.toHaveClass(/is-busy/, { timeout: 10000 });
 };
 await run('/system script run report');
 await expect(output).toContainText('all good');
 await expect(output).toContainText('failure: exited with code 2');
 await run('/system package install nano');
 await expect(output).toContainText('Installing nano');
 await run('/system package print where name=nano');
 await expect(output).toContainText('8.4-r1');
 await run('/system package uninstall nano');
 await expect(output).toContainText('Purging nano');
 await run('/system reset-configuration');
 await expect(term.locator('.rd-cli-prompt')).toHaveText('Dangerous! Reset anyway? [y/N]: ');
 await run('n');
 await expect(output).toContainText('action cancelled');
});
