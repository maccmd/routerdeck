import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const port = process.env.ROUTERDECK_VM_PORT || '8088';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding:'utf8' }).trim();
const password = (await readFile('.cache/vm/password', 'utf8')).trim();
const sessionCount = () => Number(ssh('ubus call session list | grep -c ubus_rpc_session || true'));

test.beforeEach(({}, info) => test.skip(info.project.use.viewport.width < 768, 'The console targets desktop work areas'));

test('console logs in through real rpcd, opens windows and logs out', async ({ page }, info) => {
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
 const info2 = JSON.parse(ssh('ubus call routerdeck info'));
 expect(info2.api).toBe(1);

 await page.goto('/routerdeck/');
 await expect(page.locator('meta[name="routerdeck-mock-login"]')).toHaveCount(0);
 await page.getByLabel('Password', { exact:true }).fill('wrong-' + Date.now());
 await page.getByRole('button', { name:'Connect' }).click();
 await expect(page.getByRole('alert')).toHaveText('Wrong login or password');

 const before = sessionCount();
 await page.getByLabel('Password', { exact:true }).fill(password);
 await page.getByRole('button', { name:'Connect' }).click();
 const toolbar = page.getByRole('toolbar', { name:'Session' });
 await expect(toolbar).toContainText('Session: 127.0.0.1:' + port);
 await expect(toolbar).not.toContainText('simulated');
 await expect(toolbar).not.toContainText('plugin unavailable');
 const hostname = ssh('uci get system.@system[0].hostname');
 await expect(page).toHaveTitle(new RegExp(`^root@127\\.0\\.0\\.1 \\(${hostname}\\) - RouterDeck Console .+ \\(armsr/armv8\\)$`));
 await expect(page.locator('.rd-infofields dd').first()).toHaveText(/^(\d+d )?\d{2}:\d{2}:\d{2}$/);
 // LuCI is installed in the guest, so its menu entry is offered.
 await expect(page.getByRole('menuitem', { name:'LuCI' })).toHaveAttribute('href', '/cgi-bin/luci/');
 expect(sessionCount()).toBe(before + 1);

 await page.getByRole('menuitem', { name:'Interfaces' }).click();
 await page.getByRole('menuitem', { name:'IP' }).click();
 await page.getByRole('menuitem', { name:'Routes', exact:true }).click();
 await expect(page.getByRole('dialog', { name:'Route List', exact:true })).toBeVisible();
 await page.getByRole('menuitem', { name:'New Terminal' }).click();
 await expect(page.getByRole('dialog', { name:'Terminal', exact:true })).toContainText(info2.capabilities.ttyd ? 'ttyd is installed' : 'Terminal needs the ttyd package');
 await mkdir('output/playwright/screenshots', { recursive:true });
 await page.screenshot({ animations:'disabled', path:`output/playwright/screenshots/console-vm-${port}-${info.project.name}.png` });

 await page.reload();
 await expect(page.getByRole('dialog', { name:'Route List', exact:true })).toBeVisible();
 await page.getByRole('menuitem', { name:'Exit' }).click();
 await expect(page.getByRole('button', { name:'Connect' })).toBeVisible();
 await expect.poll(sessionCount).toBe(before);
 expect(errors).toEqual([]);
});
