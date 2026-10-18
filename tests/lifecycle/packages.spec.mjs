import { test, expect } from '@playwright/test';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const port = process.env.ROUTERDECK_VM_PORT || '8088';
const series = port === '8089' ? '24.10' : '25.12';
const ssh = (command, input) => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding:input ? undefined : 'utf8', input }).toString().trim();
const password = (await readFile('.cache/vm/password', 'utf8')).trim();
const systemURL = '/cgi-bin/luci/admin/system/system';

async function chooseTheme(page, theme) {
 await page.getByRole('link', { name:'Language and Style', exact:true }).click();
 await page.getByLabel('Design', { exact:true }).selectOption('/luci-static/' + theme);
 await page.locator('.cbi-page-actions .cbi-button-apply').getByText('Save & Apply', { exact:true }).click();
 await expect.poll(() => ssh('uci get luci.main.mediaurlbase'), { timeout:30000 }).toBe('/luci-static/' + theme);
 await expect(page.locator('.modal:visible')).toHaveCount(0, { timeout:30000 });
 await page.reload();
 await expect(page.getByLabel('Hostname', { exact:true })).toBeVisible();
}

test('theme selection, Bootstrap recovery, removal and reinstall', async ({ page }) => {
 const networkBefore = ssh('sha256sum /etc/config/network /etc/config/firewall /etc/config/dhcp');
 await page.goto(systemURL);
 await page.getByLabel('Password', { exact:true }).fill(password);
 await page.getByRole('button', { name:'Log in', exact:true }).click();
 await expect(page.getByLabel('Hostname', { exact:true })).toBeVisible();
 await chooseTheme(page, 'bootstrap');
 await expect(page.locator('body')).not.toHaveClass(/routerdeck/);
 await mkdir('output/playwright/screenshots', { recursive:true });
 await page.screenshot({ animations:'disabled', path:`output/playwright/screenshots/bootstrap-${port}.png`, fullPage:true });
 await page.goto('/cgi-bin/luci/admin/status/dashboard');
 await expect(page.locator('.rd-dashboard .rd-stats-grid')).toBeVisible();
 await page.screenshot({ animations:'disabled', path:`output/playwright/screenshots/bootstrap-dashboard-${port}.png`, fullPage:true });
 await page.goto(systemURL);
 await expect(page.getByLabel('Hostname', { exact:true })).toBeVisible();
 await chooseTheme(page, 'routerdeck');
 await expect(page.locator('body')).toHaveClass(/routerdeck/);
 try {
  ssh((series === '25.12' ? 'apk del' : 'opkg remove') + ' luci-app-routerdeck-workspace luci-app-routerdeck luci-theme-routerdeck');
  expect(ssh('uci get luci.main.mediaurlbase')).toBe('/luci-static/bootstrap');
  await page.goto(systemURL);
  await expect(page.getByLabel('Hostname', { exact:true })).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/routerdeck/);
  await expect(page.getByText('Theme fallback', { exact:true })).toHaveCount(0);
 } finally {
  const folder = `dist/packages/${series}`;
  // The theme lifecycle covers the three LuCI packages; the console is independent.
  const files = (await readdir(folder)).filter(file => file.startsWith('luci-') && file.endsWith(series === '25.12' ? '.apk' : '.ipk'));
  expect(files).toHaveLength(3);
  for (const file of files) ssh('cat > /tmp/' + file, await readFile(folder + '/' + file));
  ssh((series === '25.12' ? 'apk add --allow-untrusted ' : 'opkg install ') + files.map(file => '/tmp/' + file).join(' '));
  // Installing a package must not silently change the selected design.
  expect(ssh('uci get luci.main.mediaurlbase')).toBe('/luci-static/bootstrap');
  await page.goto(systemURL);
  await expect(page.getByLabel('Hostname', { exact:true })).toBeVisible();
  await chooseTheme(page, 'routerdeck');
 }
 expect(ssh('sha256sum /etc/config/network /etc/config/firewall /etc/config/dhcp')).toBe(networkBefore);
});
