// Packages, scripts, files, firmware checks and a backup restore against a
// real guest. The package check needs the guest's WAN to reach the feeds.
// The restore reboots the guest; everything is put back afterwards.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = (command, input) => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: input ? undefined : 'utf8', input, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
const probe = command => { try { return ssh(command); } catch { return ''; } };
const password = (await readFile('.cache/vm/password', 'utf8')).trim();
const port = process.env.ROUTERDECK_VM_PORT || '8088';
const apk = port === '8088';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Maintenance checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ has: scope.page().getByRole('gridcell', { name: text, exact: true }) });
const installed = name => apk ? probe(`apk info -e ${name}`) === name : probe(`opkg list-installed ${name}`).startsWith(name);

async function login(page) {
 await page.goto('/routerdeck/');
 await page.evaluate(() => localStorage.clear());
 await page.getByLabel('Password', { exact: true }).fill(password);
 await page.getByRole('button', { name: 'Connect' }).click();
 await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
}
test.beforeEach(async ({ page }) => {
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 page.consoleErrors = errors;
 await login(page);
});
test.afterEach(async ({ page }) => expect(page.consoleErrors ?? []).toEqual([]));

async function openSystem(page, label) {
 await page.getByRole('menuitem', { name: 'System', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}
async function choose(page, click, name, buffer) {
 const chooser = page.waitForEvent('filechooser');
 await click();
 await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer });
}
const question = (page, title) => page.getByRole('dialog', { name: title, exact: true }).filter({ has: page.locator('.rd-prompt-text') });

test('a package is installed and removed through the package manager', async ({ page }) => {
 test.setTimeout(300000);
 test.skip(installed('tcpdump-mini'), 'tcpdump-mini is already installed in this guest');
 await openSystem(page, 'Packages');
 const list = win(page, 'Package List');
 await expect(row(list, 'base-files')).toBeVisible();
 await list.getByRole('button', { name: 'Check For Updates' }).click();
 const update = win(page, 'Check for updates');
 await expect(update.getByRole('status')).not.toContainText('running', { timeout: 120000 });
 test.skip(!(await update.getByRole('status').textContent()).includes('finished'), 'The guest cannot reach the package feeds');
 await update.getByRole('button', { name: 'Close', exact: true }).click();

 await list.getByRole('button', { name: 'Install…' }).click();
 await win(page, 'Install Package').getByLabel('Packages:').fill('tcpdump-mini');
 await win(page, 'Install Package').getByRole('button', { name: 'Install', exact: true }).click();
 const install = win(page, 'Install tcpdump-mini');
 await expect(install.getByRole('status')).toContainText('finished', { timeout: 120000 });
 await expect(install.getByRole('log', { name: 'Output' })).toContainText('tcpdump-mini');
 expect(installed('tcpdump-mini')).toBe(true);
 expect(probe('tcpdump --version 2>&1 | head -1')).toContain('tcpdump');
 await install.getByRole('button', { name: 'Close', exact: true }).click();
 await win(page, 'Install Package').getByRole('button', { name: 'Close', exact: true }).click();

 // The list is long and only its visible part is drawn.
 await list.getByLabel('Find').fill('tcpdump');
 await expect(row(list, 'tcpdump-mini')).toBeVisible({ timeout: 70000 });
 await row(list, 'tcpdump-mini').click();
 await list.getByRole('button', { name: 'Uninstall' }).click();
 await question(page, 'Uninstall').getByRole('button', { name: 'Uninstall' }).click();
 await expect(win(page, 'Uninstall tcpdump-mini').getByRole('status')).toContainText('finished', { timeout: 120000 });
 expect(installed('tcpdump-mini')).toBe(false);
 // apk removes the dependency it pulled in; opkg leaves it, so remove it here.
 if (!apk) probe('opkg remove libpcap1');
});

test('a script runs from its window and from the scheduler wrapper; Undo removes it', async ({ page }) => {
 await openSystem(page, 'Scripts');
 const scripts = win(page, 'Scripts');
 await scripts.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Script');
 await item.getByLabel('Name:').fill('rdscript');
 await item.getByLabel('Source:').fill('echo "running on $(cat /proc/sys/kernel/hostname)"\necho "args: $*"\nexit 3');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(row(scripts, 'rdscript')).toBeVisible();
 expect(ssh('uci get routerdeck.rdscript.source')).toBe('echo "running on $(cat /proc/sys/kernel/hostname)"\necho "args: $*"\nexit 3');
 await row(scripts, 'rdscript').click();
 await scripts.getByRole('button', { name: 'Run Script' }).click();
 const job = win(page, 'Script rdscript');
 const hostname = ssh('cat /proc/sys/kernel/hostname');
 await expect(job.getByRole('log', { name: 'Output' })).toHaveText(`running on ${hostname}\nargs:`);
 await expect(job.getByRole('status')).toContainText('failed with exit code 3');
 expect(probe('/usr/libexec/routerdeck/run-script rdscript one two; echo "code $?"')).toBe(`running on ${hostname}\nargs: one two\ncode 3`);
 await job.getByRole('button', { name: 'Close', exact: true }).click();

 // A long script keeps running without its window and stops on request.
 await scripts.getByRole('button', { name: 'Add', exact: true }).click();
 await win(page, 'New Script').getByLabel('Name:').fill('rdsleep');
 await win(page, 'New Script').getByLabel('Source:').fill('echo start\nsleep 300');
 await win(page, 'New Script').getByRole('button', { name: 'OK' }).click();
 await row(scripts, 'rdsleep').click();
 await scripts.getByRole('button', { name: 'Run Script' }).click();
 await expect(win(page, 'Script rdsleep').getByRole('log', { name: 'Output' })).toHaveText('start');
 await win(page, 'Script rdsleep').getByRole('button', { name: 'Close', exact: true }).click();
 await scripts.getByRole('tab', { name: 'Jobs' }).click();
 await expect(row(scripts, 'script rdsleep')).toBeVisible();
 expect(probe("pgrep -f 'sleep 30[0]' || echo none")).toMatch(/^\d+/);
 await row(scripts, 'script rdsleep').click();
 await scripts.getByRole('button', { name: 'Stop', exact: true }).click();
 await expect(row(scripts, 'script rdsleep')).toHaveCount(0, { timeout: 10000 });
 // Stop ends the shell and the commands it started.
 expect(probe("pgrep -f 'sleep 30[0]' || echo none")).toBe('none');

 await page.getByRole('button', { name: 'Undo' }).click();
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect.poll(() => probe('uci -q get routerdeck.rdscript || echo gone')).toBe('gone');
 expect(probe('uci -q get routerdeck.rdsleep || echo gone')).toBe('gone');
});

test('Files uploads, downloads and removes through cgi-io', async ({ page }) => {
 probe('rm -rf /tmp/rdfiles');
 await page.getByRole('menuitem', { name: 'Files', exact: true }).click();
 const files = win(page, 'File List');
 await files.getByLabel('Path').fill('/tmp');
 await files.getByRole('button', { name: 'Go' }).click();
 await files.getByRole('button', { name: 'New Folder' }).click();
 await page.getByRole('dialog', { name: 'New Folder' }).getByRole('textbox').fill('rdfiles');
 await page.getByRole('dialog', { name: 'New Folder' }).getByRole('button', { name: 'OK' }).click();
 await row(files, 'rdfiles').dblclick();
 await expect(files.getByLabel('Path')).toHaveValue('/tmp/rdfiles');
 await choose(page, () => files.getByRole('button', { name: 'Upload…' }).click(), 'hello.txt', Buffer.from('hello from the console\n'));
 await expect(row(files, 'hello.txt')).toContainText('23 B');
 expect(ssh('cat /tmp/rdfiles/hello.txt')).toBe('hello from the console');
 await row(files, 'hello.txt').click();
 const download = page.waitForEvent('download');
 await files.getByRole('button', { name: 'Download' }).click();
 expect((await readFile(await (await download).path(), 'utf8'))).toBe('hello from the console\n');
 await files.getByRole('button', { name: 'Remove' }).click();
 await question(page, 'Remove').getByRole('button', { name: 'Remove' }).click();
 await expect(row(files, 'hello.txt')).toHaveCount(0);
 expect(probe('[ -e /tmp/rdfiles/hello.txt ] && echo present || echo absent')).toBe('absent');
 await files.getByRole('button', { name: 'Up', exact: true }).click();
 await row(files, 'rdfiles').click();
 await files.getByRole('button', { name: 'Remove' }).click();
 await question(page, 'Remove').getByRole('button', { name: 'Remove' }).click();
 await expect(row(files, 'rdfiles')).toHaveCount(0);
 await files.getByLabel('Path').fill('/proc/sys');
 await files.getByRole('button', { name: 'Go' }).click();
 await row(files, 'kernel').click();
 await files.getByRole('button', { name: 'Remove' }).click();
 await question(page, 'Remove').getByRole('button', { name: 'Remove' }).click();
 await expect(files.getByRole('alert')).toContainText('/proc/sys/kernel cannot be removed here');
});

test('firmware the router rejects is not flashed; reset needs an overlay', async ({ page }) => {
 await openSystem(page, 'Firmware');
 const firmware = win(page, 'Firmware');
 await expect(firmware.getByRole('status', { name: 'Current:' })).toContainText('OpenWrt');
 await choose(page, () => firmware.getByRole('button', { name: 'Upload…' }).click(), 'not-firmware.bin', Buffer.from('this is not a sysupgrade image'));
 await expect(firmware.getByRole('alert')).toContainText('The router rejected this image');
 // A rejected image is not left in RAM.
 expect(probe('[ -e /tmp/routerdeck-firmware.bin ] && echo present || echo absent')).toBe('absent');
 const overlay = probe("grep -c ' /overlay ' /proc/mounts || true") !== '0';
 test.skip(overlay, 'This guest has an overlay; resetting it would erase the test setup');
 await openSystem(page, 'Reset Configuration');
 await question(page, 'Reset Configuration').getByRole('button', { name: 'Reset' }).click();
 await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText('Reset failed: This router keeps its root file system writable');
});

test('a backup made on the router is restored after a check, and the router reboots with it', async ({ page }) => {
 test.setTimeout(240000);
 const original = ssh('uci get system.@system[0].hostname');
 ssh("uci set system.@system[0].hostname='rdrestored'; uci commit system; sysupgrade -b /tmp/rd-backup.tar.gz >/dev/null 2>&1; uci set system.@system[0].hostname=" + `'${original}'` + '; uci commit system');
 const backup = execFileSync('sh', ['scripts/vm-ssh.sh', 'cat /tmp/rd-backup.tar.gz; rm -f /tmp/rd-backup.tar.gz'], { stdio: ['ignore', 'pipe', 'ignore'] });
 try {
  await openSystem(page, 'Backup');
  const window = win(page, 'Backup');
  await choose(page, () => window.getByRole('button', { name: 'Restore Backup…' }).click(), 'backup.tar.gz', backup);
  const restore = question(page, 'Restore Backup');
  await expect(restore).toContainText(/Restore \d+ files from this backup and reboot\?/);
  await restore.getByRole('button', { name: 'Restore and Reboot' }).click();
  await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText('The backup was restored; the router is rebooting');
  // The guest goes down and comes back with the restored host name.
  await expect.poll(() => probe('cat /proc/uptime | cut -d. -f1'), { timeout: 60000, intervals: [2000] }).toMatch(/^([0-9]|[1-5][0-9])$/);
  await expect.poll(() => probe('ubus call routerdeck info >/dev/null && cat /proc/sys/kernel/hostname'), { timeout: 120000, intervals: [3000] }).toBe('rdrestored');
 } finally {
  await expect.poll(() => probe("uci set system.@system[0].hostname='" + original + "'; uci commit system; /etc/init.d/system reload; cat /proc/sys/kernel/hostname"), { timeout: 120000, intervals: [3000] }).toBe(original);
 }
});
