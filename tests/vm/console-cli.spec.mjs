// The RouterOS-style command line against a real guest: changes reach UCI,
// fw4 and the kernel, and /undo takes them back.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8' }).trim();
const password = (await readFile('.cache/vm/password', 'utf8')).trim();

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'CLI checks run once');

const before = {};
// Rules this test adds open port 8444; remove any a failed run left behind.
const cleanup = () => ssh(`for s in $(uci show firewall | sed -n "s/^firewall\\.\\([^.]*\\)\\.dest_port='8444'$/\\1/p"); do uci delete firewall.$s; done
 if [ -n "$(uci changes firewall)" ]; then uci commit firewall; fw4 reload; fi; true`);
test.beforeAll(() => { cleanup(); before.hostname = ssh('cat /proc/sys/kernel/hostname'); });
test.afterAll(() => {
 expect(ssh('uci show firewall | grep -c "8444" || true')).toBe('0');
 expect(ssh('cat /proc/sys/kernel/hostname')).toBe(before.hostname);
 cleanup();
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

async function terminal(page) {
 await page.getByRole('menuitem', { name: 'New Terminal' }).click();
 const term = page.getByRole('dialog', { name: 'Terminal', exact: true });
 const input = term.getByRole('textbox', { name: /^Command/ });
 await expect(input).toBeFocused();
 const output = term.getByRole('log', { name: 'Terminal output' });
 const run = async (line, done) => {
  await input.fill(line);
  await input.press('Enter');
  await expect(term.locator('.rd-cli-input')).not.toHaveClass(/is-busy/, { timeout: 20000 });
  if (done) await expect(output).toContainText(done, { timeout: 20000 });
 };
 return { output, run };
}

test('a firewall rule added from the CLI reaches fw4, and /undo removes it', async ({ page }) => {
 const { output, run } = await terminal(page);
 const lan = ssh('uci get network.lan.ipaddr');
 await run('/ip address print', lan);
 await run('/ip firewall filter add chain=input in-zone=wan protocol=tcp dst-port=8444 action=accept comment=rd-cli');
 await expect.poll(() => ssh('fw4 print 2>/dev/null | grep -c "rd-cli" || true')).not.toBe('0');
 await expect.poll(() => ssh('nft list ruleset | grep -c "tcp dport 8444" || true'), { timeout: 15000 }).not.toBe('0');
 await run('/ip firewall filter print where dst-port=8444', ';;; rd-cli');
 await run('/undo');
 await expect.poll(() => ssh('nft list ruleset | grep -c "tcp dport 8444" || true'), { timeout: 15000 }).toBe('0');
 await expect(output.locator('.is-error')).toHaveCount(0);
});

test('identity, ping and export run against the router', async ({ page }) => {
 const { output, run } = await terminal(page);
 await run('/system identity set name=rd-cli-test');
 await expect.poll(() => ssh('cat /proc/sys/kernel/hostname'), { timeout: 15000 }).toBe('rd-cli-test');
 await run('/system identity print', 'name: rd-cli-test');
 await run('/undo');
 await expect.poll(() => ssh('cat /proc/sys/kernel/hostname'), { timeout: 15000 }).toBe(before.hostname);
 await run('/ping 127.0.0.1 count=2', 'sent=2 received=2 packet-loss=0%');
 await run('/system resource print', 'version: OpenWrt');
 await run('/export', '/ip/firewall/filter');
 await expect(output).toContainText('/system/identity');
 await expect(output.locator('.is-error')).toHaveCount(0);
});
