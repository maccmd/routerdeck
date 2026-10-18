// UPnP, Dynamic DNS and SQM against a real guest with miniupnpd-nftables,
// ddns-scripts and sqm-scripts installed. Skipped where a package is missing.
// Every change is undone again.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8' }).trim();
const probe = command => { try { return ssh(command); } catch { return ''; } };
const password = (await readFile('.cache/vm/password', 'utf8')).trim();

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Service checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ hasText: text });
const configs = 'sha256sum /etc/config/upnpd /etc/config/ddns /etc/config/sqm 2>/dev/null';
let before;
test.beforeAll(() => { before = probe(configs); });
test.afterAll(() => expect(probe(configs)).toBe(before));

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

async function open(page, ...labels) {
 for (const label of labels) await page.getByRole('menuitem', { name: label, exact: true }).click();
}
const undo = page => page.getByRole('button', { name: 'Undo' }).click();

test('enabling UPnP starts miniupnpd; Undo stops it', async ({ page }) => {
 test.skip(!probe('[ -x /usr/sbin/miniupnpd ] && echo yes'), 'miniupnpd is not installed');
 test.skip(probe('uci -q get upnpd.config.enabled') === '1', 'UPnP is already on in this guest');
 await open(page, 'IP', 'UPnP');
 const upnp = win(page, 'UPnP');
 await upnp.getByLabel('Enabled:').check();
 await upnp.getByRole('button', { name: 'Apply' }).click();
 await expect.poll(() => probe("pgrep -f '^/usr/sbin/miniupnpd' || echo none"), { timeout: 20000 }).toMatch(/^\d+$/);
 await undo(page);
 await expect.poll(() => probe("pgrep -f '^/usr/sbin/miniupnpd' || echo none"), { timeout: 20000 }).toBe('none');
});

test('a dynamic DNS service starts its updater; removing it stops it', async ({ page }) => {
 test.skip(!probe('[ -x /usr/lib/ddns/dynamic_dns_updater.sh ] && echo yes'), 'ddns-scripts is not installed');
 await open(page, 'IP', 'Dynamic DNS');
 const ddns = win(page, 'Dynamic DNS');
 await ddns.getByRole('button', { name: 'Add', exact: true }).click();
 const service = win(page, 'New Dynamic DNS Service');
 await service.getByLabel('Name:', { exact: true }).fill('rdddns');
 await service.getByLabel('Provider:').selectOption('');
 // Nothing listens here, so the update fails without reaching anyone.
 await service.getByLabel('Update URL:').fill('http://127.0.0.1:9/update?host=[DOMAIN]&ip=[IP]');
 await service.getByLabel('Domain:').fill('rd.example.invalid');
 await service.getByRole('button', { name: 'OK' }).click();
 await expect(row(ddns, 'rdddns')).toContainText('custom URL');
 // The bracket keeps pgrep from matching the shell that runs it.
 await expect.poll(() => probe('pgrep -f "dynamic_dns_update[r][.]sh.* -S rdddns" || echo none'), { timeout: 30000 }).toMatch(/^\d+/);
 await expect(row(ddns, 'rdddns').locator('.is-flags')).toHaveText(/R/, { timeout: 10000 });
 await undo(page);
 await expect.poll(() => probe('pgrep -f "dynamic_dns_update[r][.]sh.* -S rdddns" || echo none'), { timeout: 30000 }).toBe('none');
});

test('an SQM queue puts cake on the WAN device; disabling removes it', async ({ page }) => {
 test.skip(!probe('[ -x /usr/lib/sqm/run.sh ] && echo yes'), 'sqm-scripts is not installed');
 test.skip(probe('uci -q get sqm.eth1.enabled') !== '0', 'This guest has no disabled default queue on eth1');
 await open(page, 'Queues');
 const queues = win(page, 'Queues');
 await row(queues, 'eth1').click();
 await page.keyboard.press('Control+e');
 await expect.poll(() => probe('tc qdisc show dev eth1'), { timeout: 30000 }).toContain('qdisc cake');
 await expect(row(queues, 'eth1').locator('.is-flags')).toHaveText('R', { timeout: 10000 });
 await undo(page);
 await expect.poll(() => probe('tc qdisc show dev eth1'), { timeout: 30000 }).not.toContain('qdisc cake');
});
