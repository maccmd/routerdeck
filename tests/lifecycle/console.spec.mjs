// RouterDeck Console package lifecycle in the disposable guest: install from
// dist/packages, use it, remove it, reinstall it. Configuration must not change.
import { test, expect } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const port = process.env.ROUTERDECK_VM_PORT || '8088';
const series = port === '8089' ? '24.10' : '25.12';
const ssh = (command, input) => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: input ? undefined : 'utf8', input }).toString().trim();
const password = (await readFile('.cache/vm/password', 'utf8')).trim();
const manager = series === '25.12' ? { add: 'apk add --allow-untrusted', del: 'apk del' } : { add: 'opkg install', del: 'opkg remove' };
const FILES = ['/www/routerdeck/index.html', '/usr/share/rpcd/ucode/routerdeck', '/usr/share/rpcd/acl.d/routerdeck-console.json', '/usr/share/ucode/routerdeck/core.uc', '/usr/libexec/routerdeck/safemode-watchdog', '/usr/libexec/routerdeck/diag', '/usr/libexec/routerdeck/netwatch', '/usr/libexec/routerdeck/run-script', '/etc/init.d/routerdeck-safemode', '/etc/init.d/routerdeck-netwatch'];

async function install() {
 const folder = `dist/packages/${series}`;
 const file = (await readdir(folder)).find(name => name.startsWith('routerdeck-console'));
 expect(file).toBeTruthy();
 ssh('cat > /tmp/' + file, await readFile(`${folder}/${file}`));
 ssh(`${manager.add} /tmp/${file}`);
}

test('install, use, remove and reinstall the console package', async ({ page }) => {
 const configs = ssh('sha256sum /etc/config/network /etc/config/firewall /etc/config/dhcp /etc/config/rpcd /etc/config/uhttpd');
 ssh(`${manager.del} routerdeck-console 2>/dev/null; true`);
 await install();
 for (const file of FILES) expect(ssh(`ls -ln ${file} | awk '{print $3":"$4}'`)).toBe('0:0');
 expect(ssh('find / -xdev -name "._*" | wc -l')).toBe('0');
 expect(JSON.parse(ssh('ubus call routerdeck info')).api).toBe(1);
 // Only Netwatch starts at boot, and it runs nothing until hosts are added.
 expect(ssh('ls /etc/rc.d | grep routerdeck || true')).toMatch(/^(S99routerdeck-netwatch)?$/);
 expect(ssh("pgrep -f '^/usr/bin/ucode /usr/libexec/routerdeck/netwatch' || echo none")).toBe('none');

 await page.goto('/routerdeck/');
 await page.getByLabel('Password', { exact: true }).fill(password);
 await page.getByRole('button', { name: 'Connect' }).click();
 await page.getByRole('menuitem', { name: 'Interfaces' }).click();
 await expect(page.getByRole('dialog', { name: 'Interface List' }).locator('.rd-grid-row').filter({ hasText: 'br-lan' })).toBeVisible();
 await page.getByRole('button', { name: 'Safe Mode', exact: true }).click();
 await expect(page.getByRole('button', { name: 'Safe Mode', exact: true })).toHaveAttribute('aria-pressed', 'true');
 // procd starts the watchdog instance asynchronously.
 await expect.poll(() => ssh("pgrep -f '^/usr/bin/ucode /usr/libexec/routerdeck/safemode-watchdog' || echo none")).toMatch(/^\d+$/);
 // A running ping job, which must end with the package.
 for (const file of ['/usr/libexec/routerdeck/diag', '/usr/libexec/routerdeck/safemode-watchdog', '/etc/init.d/routerdeck-safemode']) expect(ssh(`[ -x ${file} ] && echo executable || echo not`)).toBe('executable');
 expect(JSON.parse(ssh(`ubus call routerdeck diag '{"action":"start","tool":"ping","host":"127.0.0.1"}'`)).ok).toBe(true);
 await expect.poll(() => ssh("pgrep -f '^/usr/bin/ucode /usr/libexec/routerdeck/diag' || echo none")).toMatch(/^\d+$/);

 // Removing the package mid-Safe Mode keeps the configuration as it is.
 ssh(`${manager.del} routerdeck-console`);
 for (const file of FILES) expect(ssh(`[ -e ${file} ] && echo present || echo absent`)).toBe('absent');
 expect(ssh('[ -e /var/run/routerdeck ] && echo present || echo absent')).toBe('absent');
 expect(ssh('ubus list routerdeck 2>&1 || true')).toContain('Not found');
 // Anchored, so pgrep does not match the ssh shell running this very command.
 expect(ssh("pgrep -f '^/usr/bin/ucode /usr/libexec/routerdeck/safemode-watchdog' || echo none")).toBe('none');
 await expect.poll(() => ssh("pgrep -f '^/usr/bin/ucode /usr/libexec/routerdeck/diag' || echo none"), { timeout: 10000 }).toBe('none');
 expect(ssh('sha256sum /etc/config/network /etc/config/firewall /etc/config/dhcp /etc/config/rpcd /etc/config/uhttpd')).toBe(configs);

 await install();
 expect(JSON.parse(ssh('ubus call routerdeck info')).api).toBe(1);
 expect(ssh('sha256sum /etc/config/network /etc/config/firewall /etc/config/dhcp /etc/config/rpcd /etc/config/uhttpd')).toBe(configs);
});
