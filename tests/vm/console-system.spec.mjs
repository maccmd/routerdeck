// The System menu against a real guest: crontab and crond, procd services,
// the time zone, the password and the backup download. Everything is put
// back as it was.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8' }).trim();
const password = (await readFile('.cache/vm/password', 'utf8')).trim();

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'System checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ hasText: text });
const before = {};
test.beforeAll(() => {
 before.crontab = ssh('cat /etc/crontabs/root 2>/dev/null; true');
 before.system = ssh('sha256sum /etc/config/system');
});
test.afterAll(() => {
 expect(ssh('cat /etc/crontabs/root 2>/dev/null; true')).toBe(before.crontab);
 expect(ssh('sha256sum /etc/config/system')).toBe(before.system);
 ssh('/etc/init.d/sysntpd start; true');
});

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

async function openSystem(page, label) {
 await page.getByRole('menuitem', { name: 'System', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('a scheduled job reaches crond and runs; Undo takes it back', async ({ page }) => {
 test.setTimeout(150000);
 await openSystem(page, 'Scheduler');
 const scheduler = win(page, 'Scheduler');
 await scheduler.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Scheduled Job');
 await item.getByLabel('Name:').fill('rd tick');
 await item.getByLabel('Schedule:').fill('* * * * *');
 await item.getByLabel('Command:').fill('logger -t rdcron tick');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(row(scheduler, 'rd tick')).toContainText('every minute');
 expect(ssh('cat /etc/crontabs/root')).toContain('# rd tick\n* * * * * logger -t rdcron tick');
 await expect.poll(() => ssh("pgrep -f '^/usr/sbin/crond' || echo none")).toMatch(/^\d+$/);
 // crond runs it at the next full minute.
 await expect.poll(() => ssh('logread -e rdcron | grep -c tick || true'), { timeout: 90000, intervals: [5000] }).not.toBe('0');
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect(row(scheduler, 'rd tick')).toHaveCount(0);
 expect(ssh('cat /etc/crontabs/root 2>/dev/null; true')).toBe(before.crontab);
});

test('Startup stops and starts a procd service', async ({ page }) => {
 await openSystem(page, 'Startup');
 const startup = win(page, 'Startup');
 // The list is virtual; with many packages sysntpd is out of sight.
 await startup.getByLabel('Find').fill('sysntpd');
 await expect(row(startup, 'sysntpd')).toContainText('running');
 await row(startup, 'sysntpd').click();
 await startup.getByRole('button', { name: 'Stop', exact: true }).click();
 await expect(row(startup, 'sysntpd')).toContainText('stopped', { timeout: 10000 });
 expect(ssh('pgrep -f "^/usr/sbin/ntpd" || echo none')).toBe('none');
 await startup.getByRole('button', { name: 'Start', exact: true }).click();
 await expect(row(startup, 'sysntpd')).toContainText('running', { timeout: 10000 });
 await expect.poll(() => ssh('pgrep -f "^/usr/sbin/ntpd" || echo none')).toMatch(/^\d+$/);
});

test('the time zone reaches the system at once and Undo restores it', async ({ page }) => {
 await openSystem(page, 'Clock');
 const clock = win(page, 'Clock');
 await clock.getByLabel('Time Zone Name:').selectOption('Asia/Vladivostok');
 await clock.getByRole('button', { name: 'Apply' }).click();
 await expect.poll(() => ssh('cat /tmp/TZ'), { timeout: 15000 }).toBe('<+10>-10');
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect.poll(() => ssh('cat /tmp/TZ'), { timeout: 15000 }).not.toBe('<+10>-10');
});

test('the password is checked, set through rpcd, and still works; a backup downloads', async ({ page }) => {
 await openSystem(page, 'Password');
 const form = win(page, 'Change Password');
 await form.getByLabel('Old Password:').fill('not-the-password');
 await form.getByLabel('New Password:').fill(password);
 await form.getByLabel('Confirm Password:').fill(password);
 await form.getByRole('button', { name: 'Apply' }).click();
 await expect(form.getByRole('alert')).toHaveText('The current password is wrong');
 // The same password again: the change goes through without changing anything.
 await form.getByLabel('Old Password:').fill(password);
 await form.getByRole('button', { name: 'Apply' }).click();
 await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText('Password changed');

 await openSystem(page, 'Backup');
 const download = page.waitForEvent('download');
 await win(page, 'Backup').getByRole('button', { name: 'Download Backup' }).click();
 const file = await (await download).path();
 expect(execFileSync('tar', ['-tzf', file], { encoding: 'utf8' })).toContain('etc/config/system');

 await page.getByRole('menuitem', { name: 'Exit' }).click();
 await page.getByLabel('Password', { exact: true }).fill(password);
 await page.getByRole('button', { name: 'Connect' }).click();
 await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
 await openSystem(page, 'Packages');
 const list = win(page, 'Package List');
 await expect(list.getByRole('status')).toContainText(/\d+ items/);
 await list.getByLabel('Find').fill('routerdeck-console');
 await expect(row(list, 'routerdeck-console')).toContainText('0.1.0');
});
