// The System menu against the simulated router.
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
async function openSystem(page, label) {
 await page.getByRole('menuitem', { name: 'System', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}
const toolbar = page => page.getByRole('toolbar', { name: 'Session' });

test('Scheduler edits the crontab with Undo, like any other change', async ({ page }) => {
 await openSystem(page, 'Scheduler');
 const scheduler = win(page, 'Scheduler');
 await expect(row(scheduler, 'Reload WiFi at night')).toContainText('daily at 04:00');
 await expect(row(scheduler, '/usr/bin/check-wan').locator('.is-flags')).toHaveText('X');
 await scheduler.getByRole('button', { name: 'Add', exact: true }).click();
 const item = win(page, 'New Scheduled Job');
 await item.getByLabel('Name:').fill('Backup');
 await item.getByLabel('Schedule:').fill('30 2 * * 0');
 await expect(item.getByRole('status', { name: 'When:' })).toHaveText('Sundays at 02:30');
 await item.getByLabel('Command:').fill('/root/backup.sh');
 await item.getByRole('button', { name: 'OK' }).click();
 await expect(row(scheduler, 'Backup')).toContainText('/root/backup.sh');
 await row(scheduler, 'Backup').click();
 await page.keyboard.press('Control+d');
 await expect(row(scheduler, 'Backup').locator('.is-flags')).toHaveText('X');
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Disable scheduled job Backup');
 await page.getByRole('button', { name: 'Undo' }).click();
 await page.getByRole('button', { name: 'Undo' }).click();
 await expect(row(scheduler, 'Backup')).toHaveCount(0);
});

test('Startup starts and stops services; Packages and Resources show the router', async ({ page }) => {
 await openSystem(page, 'Startup');
 const startup = win(page, 'Startup');
 await expect(row(startup, 'ttyd').locator('.is-flags')).toHaveText('X');
 await row(startup, 'ttyd').click();
 await startup.getByRole('button', { name: 'Start', exact: true }).click();
 await expect(row(startup, 'ttyd')).toContainText('running');
 await expect(toolbar(page)).toContainText('Start: ttyd');
 await row(startup, 'ttyd').click({ button: 'right' });
 await page.getByRole('menuitem', { name: 'Enable' }).click();
 await expect(row(startup, 'ttyd').locator('.is-flags')).toHaveText('R');
 // Not a configuration change, so nothing to undo.
 await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

 await openSystem(page, 'Packages');
 const packages = win(page, 'Package List');
 await expect(row(packages, 'dnsmasq')).toContainText('2.91-r1');
 await expect(row(packages, 'libubox20260213').locator('.is-flags')).toHaveText('D');
 await expect(packages.getByRole('status')).toContainText('apk');
 await openSystem(page, 'Resources');
 await expect(win(page, 'Resources').getByRole('status', { name: 'Free Storage:' })).toHaveText('68.0 MiB of 100.0 MiB');
});

test('Clock, NTP, Logging and Identity are settings forms', async ({ page }) => {
 await openSystem(page, 'Clock');
 const clock = win(page, 'Clock');
 await expect(clock.getByRole('status', { name: 'Time:' })).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
 await clock.getByLabel('Time Zone Name:').selectOption('Europe/Moscow');
 await expect(clock.getByRole('status', { name: 'Time Zone:' })).toHaveText('MSK-3');
 await clock.getByRole('button', { name: 'Apply' }).click();
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Set time zone Europe/Moscow');
 await clock.getByRole('button', { name: 'Set From This Computer' }).click();
 await expect(toolbar(page)).toContainText('The router clock was set from this computer');

 await openSystem(page, 'NTP Client');
 const ntp = win(page, 'NTP Client');
 await ntp.getByLabel('NTP Server:').check();
 await ntp.getByLabel('Server Interface:').selectOption('lan');
 await ntp.getByRole('button', { name: 'Apply' }).click();
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Change NTP settings');

 await openSystem(page, 'Logging');
 const logging = win(page, 'Logging');
 await logging.getByLabel('Remote Server:').fill('nonsense');
 await logging.getByRole('button', { name: 'Apply' }).click();
 await expect(logging.getByText('Enter the address of the syslog server')).toBeVisible();
 await logging.getByLabel('Remote Server:').fill('192.0.2.10');
 await logging.getByRole('button', { name: 'OK' }).click();
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Change logging');

 await openSystem(page, 'Identity');
 await win(page, 'Identity').getByLabel('Name:').fill('gw');
 await win(page, 'Identity').getByRole('button', { name: 'OK' }).click();
 await expect(page).toHaveTitle(/\(gw\)/, { timeout: 5000 });
});

test('Password checks the old one; Backup downloads; Reboot asks first', async ({ page }) => {
 await openSystem(page, 'Password');
 const password = win(page, 'Change Password');
 await password.getByLabel('Old Password:').fill('wrong');
 await password.getByLabel('New Password:').fill('better-one');
 await password.getByLabel('Confirm Password:').fill('better-one');
 await password.getByRole('button', { name: 'Apply' }).click();
 await expect(password.getByRole('alert')).toHaveText('The current password is wrong');
 await password.getByLabel('Old Password:').fill('routerdeck');
 await password.getByRole('button', { name: 'Apply' }).click();
 await expect(toolbar(page)).toContainText('Password changed');

 await openSystem(page, 'Backup');
 const download = page.waitForEvent('download');
 await win(page, 'Backup').getByRole('button', { name: 'Download Backup' }).click();
 expect((await download).suggestedFilename()).toMatch(/^backup-routerdeck-preview-\d{4}-\d{2}-\d{2}\.tar\.gz$/);

 await openSystem(page, 'Reboot');
 const confirm = page.getByRole('dialog', { name: 'Reboot' });
 await expect(confirm).toContainText('Reboot routerdeck-preview now?');
 await confirm.getByRole('button', { name: 'Cancel' }).click();
 await openSystem(page, 'Reboot');
 await page.getByRole('dialog', { name: 'Reboot' }).getByRole('button', { name: 'Reboot' }).click();
 await expect(toolbar(page)).toContainText('The router is rebooting');
});
