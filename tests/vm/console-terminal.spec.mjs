// The Shell window embeds ttyd from the guest. QEMU forwards only HTTP and
// SSH, so this test reaches ttyd's port through an SSH tunnel on loopback.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
const sshPort = process.env.ROUTERDECK_SSH_PORT || '2222';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8' }).trim();
const password = (await readFile('.cache/vm/password', 'utf8')).trim();

test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Shell check runs once');

test('the Shell window shows the router shell through ttyd', async ({ page }) => {
 const info = JSON.parse(ssh('ubus call routerdeck terminal'));
 test.skip(!info.installed || !info.running, 'ttyd is not installed and running in this guest');
 // ttyd binds to the LAN device and stops accepting after LAN restarts made by
 // other tests; start from a fresh instance.
 ssh('/etc/init.d/ttyd restart');
 const lan = ssh("uci get network.lan.ipaddr | cut -d/ -f1");
 const tunnel = spawn('ssh', ['-F', '/dev/null', '-i', '.cache/vm/id_ed25519', '-p', sshPort, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=.cache/vm/known_hosts', '-o', 'ExitOnForwardFailure=yes', '-N', '-L', `127.0.0.1:${info.port}:${lan}:${info.port}`, 'root@127.0.0.1'], { stdio: 'ignore' });
 try {
  await expect.poll(async () => fetch(`http://127.0.0.1:${info.port}/`).then(response => response.status, () => 0), { timeout: 10000 }).toBe(200);
  await page.goto('/routerdeck/');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByRole('menuitem', { name: 'New Shell' }).click();
  const frame = page.getByRole('dialog', { name: 'Shell', exact: true }).locator('iframe');
  await expect(frame).toHaveAttribute('src', `http://127.0.0.1:${info.port}/`);
  await expect.poll(async () => page.frames().find(item => item.url().startsWith(`http://127.0.0.1:${info.port}`))?.title(), { timeout: 15000 }).toMatch(/ttyd/i);
  // xterm renders the login prompt; its accessibility tree carries the text.
  const terminal = page.frameLocator('iframe[title="Router terminal"]');
  await expect(terminal.locator('.xterm')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('dialog', { name: 'Shell', exact: true }).getByRole('link', { name: 'Open in a new tab' })).toHaveAttribute('href', `http://127.0.0.1:${info.port}/`);
 } finally {
  tunnel.kill();
 }
});
