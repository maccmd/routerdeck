// Users (rpcd logins), the web server certificate and mount points against
// a real guest. Mount points need block-mount and losetup in the guest.
// Everything is put back afterwards.
import { test, expect } from '@playwright/test';
import { readFile, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
const probe = command => { try { return ssh(command); } catch { return ''; } };
const password = (await readFile('.cache/vm/password', 'utf8')).trim();
const port = process.env.ROUTERDECK_VM_PORT || '8088';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Admin checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ has: scope.page().getByRole('gridcell', { name: text, exact: true }) });
const question = (page, title) => page.getByRole('dialog', { name: title, exact: true }).filter({ has: page.locator('.rd-prompt-text') });
async function openSystem(page, label) {
 await page.getByRole('menuitem', { name: 'System', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}

// A JSON-RPC login, as the console or LuCI makes it.
async function login(username, secret) {
 const response = await fetch(`http://127.0.0.1:${port}/ubus`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: ['00000000000000000000000000000000', 'session', 'login', { username, password: secret }] }) });
 return (await response.json()).result?.[0];
}

// After uhttpd restarts, until it answers again.
const answering = () => fetch(`http://127.0.0.1:${port}/routerdeck/`).then(response => response.status, () => 0);

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

test('a user added here logs in through rpcd with its own password; Undo removes it', async ({ page }) => {
 const before = ssh('uci show rpcd');
 await openSystem(page, 'Users');
 const list = win(page, 'User List');
 await expect(row(list, 'root').locator('.is-flags')).toHaveText('C');
 await list.getByRole('button', { name: 'Add', exact: true }).click();
 const user = win(page, 'New User');
 await user.getByLabel('Name:').fill('rdop');
 await user.getByLabel('Group:').selectOption('read');
 await user.getByLabel('Password:', { exact: true }).fill('rd-Passw0rd');
 await user.getByLabel('Confirm Password:').fill('rd-Passw0rd');
 await user.getByRole('button', { name: 'OK' }).click();
 await expect(row(list, 'rdop')).toContainText('own password');
 expect(ssh("uci show rpcd | grep -cF \"password='\\$6\\$\" || true")).toBe('1');
 // rpcd checks the hash made in the browser with crypt(3).
 expect(await login('rdop', 'rd-Passw0rd')).toBe(0);
 expect(await login('rdop', 'wrong')).toBe(6);
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect(row(list, 'rdop')).toHaveCount(0);
 expect(await login('rdop', 'rd-Passw0rd')).toBe(6);
 expect(ssh('uci show rpcd')).toBe(before);
});

test('the web server certificate is regenerated, imported and restored', async ({ page }) => {
 test.setTimeout(120000);
 test.skip(!probe('[ -x /usr/sbin/px5g ] && echo yes'), 'px5g is not installed');
 ssh('cp /etc/uhttpd.crt /tmp/rd-uhttpd.crt; cp /etc/uhttpd.key /tmp/rd-uhttpd.key');
 const original = ssh('sha256sum /etc/uhttpd.crt | cut -d" " -f1');
 try {
  await openSystem(page, 'Certificates');
  const list = win(page, 'Certificates');
  await expect(row(list, 'web server').locator('.is-flags')).toHaveText('K');
  await row(list, 'web server').click();
  await list.getByRole('button', { name: 'Regenerate' }).click();
  await question(page, 'Regenerate').getByRole('button', { name: 'Regenerate' }).click();
  await expect.poll(() => probe('sha256sum /etc/uhttpd.crt | cut -d" " -f1'), { timeout: 15000 }).not.toBe(original);
  const regenerated = ssh('sha256sum /etc/uhttpd.crt | cut -d" " -f1');
  // uhttpd restarted and serves the console again.
  await expect.poll(() => probe("pgrep -f '^/usr/sbin/uhttpd' || echo none"), { timeout: 15000 }).toMatch(/^\d+/);
  await expect(row(list, 'web server')).toContainText(ssh('cat /proc/sys/kernel/hostname'), { timeout: 40000 });

  const dir = await mkdtemp(join(tmpdir(), 'rdcert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '30', '-subj', '/CN=rdimport.lan', '-keyout', join(dir, 'router.key'), '-out', join(dir, 'router.crt')], { stdio: 'ignore' });
  await row(list, 'web server').click();
  const chooser = page.waitForEvent('filechooser');
  await list.getByRole('button', { name: 'Import…' }).click();
  await (await chooser).setFiles([join(dir, 'router.crt'), join(dir, 'router.key')]);
  const confirm = question(page, 'Import Certificate');
  await expect(confirm).toContainText('Use the certificate for rdimport.lan, issued by itself');
  await confirm.getByRole('button', { name: 'Import' }).click();
  await expect.poll(() => probe('grep -c "BEGIN CERTIFICATE" /etc/uhttpd.crt'), { timeout: 15000 }).toBe('1');
  expect(ssh('cat /etc/uhttpd.crt')).toBe((await readFile(join(dir, 'router.crt'), 'utf8')).trim());
  expect(ssh('ls -l /etc/uhttpd.key | cut -c1-10')).toBe('-rw-------');
  await expect.poll(() => probe("pgrep -f '^/usr/sbin/uhttpd' || echo none"), { timeout: 15000 }).toMatch(/^\d+/);
  await expect(row(list, 'web server')).toContainText('rdimport.lan', { timeout: 40000 });

  await row(list, 'web server').click();
  await list.getByRole('button', { name: 'Restore Previous' }).click();
  await question(page, 'Restore Previous').getByRole('button', { name: 'Restore' }).click();
  await expect.poll(() => probe('sha256sum /etc/uhttpd.crt | cut -d" " -f1'), { timeout: 15000 }).toBe(regenerated);
 } finally {
  // The console restarts uhttpd a second after each change; let that happen first.
  ssh('sleep 2; cp /tmp/rd-uhttpd.crt /etc/uhttpd.crt; cp /tmp/rd-uhttpd.key /etc/uhttpd.key; rm -f /tmp/rd-uhttpd.* /etc/uhttpd.crt.old /etc/uhttpd.key.old; /etc/init.d/uhttpd restart');
  await expect.poll(() => probe('sha256sum /etc/uhttpd.crt | cut -d" " -f1'), { timeout: 15000 }).toBe(original);
  await expect.poll(answering, { timeout: 30000 }).toBe(200);
 }
});

test('a mount point mounts a file system at once; Unmount, Mount All and Undo', async ({ page }) => {
 test.skip(!probe('[ -x /sbin/block ] && [ -x /usr/sbin/losetup ] && echo yes'), 'block-mount and losetup are not installed');
 const before = ssh('uci show fstab');
 const loop = ssh('rm -f /tmp/rd-disk.img; dd if=/dev/zero of=/tmp/rd-disk.img bs=1M count=16 2>/dev/null; mkfs.ext4 -q -L rddisk /tmp/rd-disk.img; losetup -f --show /tmp/rd-disk.img').replace('/dev/', '');
 try {
  await openSystem(page, 'Disks');
  const disks = win(page, 'Disks');
  await expect(row(disks, loop)).toContainText('rddisk');
  await disks.getByRole('tab', { name: 'Mount Points' }).click();
  await disks.getByRole('button', { name: 'Add', exact: true }).click();
  const mount = win(page, 'New Mount Point');
  const source = await mount.getByLabel('File System:').locator('option', { hasText: `${loop} ext4 "rddisk"` }).getAttribute('value');
  await mount.getByLabel('File System:').selectOption(source);
  await mount.getByLabel('Mount Point:').fill('/mnt/rddisk');
  await mount.getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => probe('grep -c " /mnt/rddisk " /proc/mounts || true'), { timeout: 15000 }).toBe('1');
  await expect(row(disks, '/mnt/rddisk').locator('.is-flags')).toHaveText('M');
  expect(ssh("uci show fstab | grep -c \"uuid='\" || true")).not.toBe('0');

  await disks.getByRole('tab', { name: 'Disks' }).click();
  await row(disks, loop).click();
  await disks.getByRole('button', { name: 'Unmount' }).click();
  await expect.poll(() => probe('grep -c " /mnt/rddisk " /proc/mounts || true')).toBe('0');
  await disks.getByRole('button', { name: 'Mount All' }).click();
  await expect.poll(() => probe('grep -c " /mnt/rddisk " /proc/mounts || true')).toBe('1');
  await expect(row(disks, loop)).toContainText('/mnt/rddisk');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => probe('grep -c " /mnt/rddisk " /proc/mounts || true'), { timeout: 15000 }).toBe('0');
  expect(ssh('uci show fstab')).toBe(before);
 } finally {
  probe(`umount /mnt/rddisk 2>/dev/null; losetup -d /dev/${loop}; rm -f /tmp/rd-disk.img; rmdir /mnt/rddisk 2>/dev/null; true`);
 }
});

test('LEDs and Disks show what the guest has', async ({ page }) => {
 await openSystem(page, 'LEDs');
 const leds = win(page, 'LED Settings');
 const count = Number(probe('ls /sys/class/leds 2>/dev/null | wc -l') || 0);
 await expect(leds.getByRole('status')).toContainText(count ? `${count} LEDs in /sys/class/leds` : 'This board has no LEDs in /sys/class/leds');
 await openSystem(page, 'Disks');
 const disks = win(page, 'Disks');
 await expect(row(disks, 'vda')).toContainText('rootfs');
 await expect(row(disks, 'vda')).toContainText('/');
});
