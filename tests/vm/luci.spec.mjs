import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const port = process.env.ROUTERDECK_VM_PORT || '8088';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding:'utf8' }).trim();
const password = (await readFile('.cache/vm/password', 'utf8')).trim();
const basePath = '/cgi-bin/luci';

async function login(page, path = '/admin/status/dashboard') {
 await page.goto(basePath + path);
 if (await page.locator('input[name="luci_password"]').count()) {
  await page.getByLabel('Password', { exact:true }).fill(password);
  await page.getByRole('button', { name:'Log in', exact:true }).click();
 }
 await expect(page.locator('#rd-navigation')).toBeAttached({ timeout:20000 });
 await expect(page.locator('#rd-navigation a').first()).toBeAttached();
}

test('real LuCI dashboard, forms, navigation and screenshots', async ({ page }, info) => {
 await login(page);
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await expect(page.getByRole('heading', { name:'Dashboard', exact:true })).toBeVisible();
 await expect(page.locator('.rd-dashboard')).toContainText('armsr/armv8');
 await expect(page.locator('.rd-dashboard')).not.toContainText('Simulated');
 await expect(page.locator('.rd-traffic-legend')).not.toContainText('Sampling', { timeout:15000 });
 await expect(page.locator('.alert-message.error')).toHaveCount(0);
 await mkdir('output/playwright/screenshots', { recursive:true });
 await page.screenshot({ animations:'disabled', path:`output/playwright/screenshots/luci-${port}-dark-${info.project.name}.png`, fullPage:true });
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
 await page.getByRole('button', { name:'Switch to light theme' }).click();
 await page.screenshot({ animations:'disabled', path:`output/playwright/screenshots/luci-${port}-light-${info.project.name}.png`, fullPage:true });
 await page.getByRole('button', { name:'Switch to dark theme' }).click();
 // Follow only links LuCI actually exposes for this installation.
 const paths = ['/admin/network/network','/admin/network/firewall','/admin/network/dhcp','/admin/system/system','/admin/system/flash','/admin/system/startup'];
 for (const path of paths) {
  const href = await page.locator(`#rd-navigation a[href="${basePath + path}"]`).getAttribute('href');
  await page.goto(href);
  await expect(page.locator('#view').getByRole('heading').first()).toBeVisible({ timeout:20000 });
  await expect(page.locator('.alert-message.error')).toHaveCount(0);
  if (path.endsWith('/network')) {
   await page.screenshot({ animations:'disabled', path:`output/playwright/screenshots/luci-${port}-interfaces-${info.project.name}.png`, fullPage:true });
   await page.getByRole('button', { name:/Add new interface/ }).click();
   await expect(page.locator('.modal')).toBeVisible();
   await page.screenshot({ animations:'disabled', path:`output/playwright/screenshots/luci-${port}-modal-${info.project.name}.png` });
   await page.getByRole('button', { name:'Cancel', exact:true }).click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path).toBe(true);
 }
 expect(errors).toEqual([]);
});

test('save and apply hostname through the original LuCI form', async ({ page }, info) => {
 test.skip(info.project.name !== 'chromium-1440', 'Configuration is shared by all browsers; change it once.');
 const original = ssh("uci get system.@system[0].hostname");
 try {
  await page.goto(basePath + '/admin/system/system');
  await page.getByLabel('Password', { exact:true }).fill('deliberately-invalid-routerdeck-test');
  await page.getByRole('button', { name:'Log in', exact:true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid username and/or password');
  await login(page, '/admin/system/system');
  await page.getByLabel('Hostname', { exact:true }).fill('routerdeck-verified');
  await page.locator('.cbi-page-actions .cbi-button-apply').getByText('Save & Apply', { exact:true }).click();
  await expect.poll(() => ssh("uci get system.@system[0].hostname"), { timeout:30000 }).toBe('routerdeck-verified');
  await expect.poll(() => JSON.parse(ssh('ubus call uci changes')).changes || {}, { timeout:30000 }).toEqual({});
  await expect(page.locator('.modal:visible')).toHaveCount(0, { timeout:30000 });
  await page.reload();
  await expect(page.getByLabel('Hostname', { exact:true })).toHaveValue('routerdeck-verified');
  await page.goto(basePath + '/admin/logout');
  await expect(page.getByLabel('Password', { exact:true })).toBeVisible();
 } finally {
  // This command is restricted to the disposable loopback VM.
  ssh("uci set system.@system[0].hostname='" + original.replaceAll("'", "'\\''") + "'; uci commit system; /etc/init.d/system reload");
 }
});
