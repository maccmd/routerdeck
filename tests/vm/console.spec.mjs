import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const port = process.env.ROUTERDECK_VM_PORT || '8088';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding:'utf8' }).trim();
const password = (await readFile('.cache/vm/password', 'utf8')).trim();
// Session ids, not a count: sessions of earlier tests may expire meanwhile.
const sessions = () => new Set(ssh(`ubus call session list | sed -n 's/.*"ubus_rpc_session": "\\([0-9a-f]*\\)".*/\\1/p'`).split('\n').filter(Boolean));

test.beforeEach(({}, info) => test.skip(info.project.use.viewport.width < 768, 'The console targets desktop work areas'));

test('console logs in through real rpcd, opens windows and logs out', async ({ page }, info) => {
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 // The embedded ttyd is not reachable from the host here; its load error is expected.
 page.on('console', message => { if (message.type() === 'error' && !message.location().url.includes(':7681')) errors.push(message.text()); });
 const info2 = JSON.parse(ssh('ubus call routerdeck info'));
 expect(info2.api).toBe(1);

 await page.goto('/routerdeck/');
 await expect(page.locator('meta[name="routerdeck-mock-login"]')).toHaveCount(0);
 await page.getByLabel('Password', { exact:true }).fill('wrong-' + Date.now());
 await page.getByRole('button', { name:'Connect' }).click();
 await expect(page.getByRole('alert')).toHaveText('Wrong login or password');

 const before = sessions();
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
 const mine = [...sessions()].filter(sid => !before.has(sid));
 expect(mine).toHaveLength(1);

 await page.getByRole('menuitem', { name:'Interfaces' }).click();
 await page.getByRole('menuitem', { name:'IP', exact:true }).click();
 await page.getByRole('menuitem', { name:'Routes', exact:true }).click();
 await expect(page.getByRole('dialog', { name:'Route List', exact:true })).toBeVisible();
 await page.getByRole('menuitem', { name:'New Shell' }).click();
 await expect(page.getByRole('dialog', { name:'Shell', exact:true })).toContainText(info2.capabilities.ttyd ? 'ttyd' : 'The terminal uses the ttyd package, which is not installed.');
 await mkdir('output/playwright/screenshots', { recursive:true });
 await page.screenshot({ animations:'disabled', path:`output/playwright/screenshots/console-vm-${port}-${info.project.name}.png` });

 await page.reload();
 await expect(page.getByRole('dialog', { name:'Route List', exact:true })).toBeVisible();
 await page.getByRole('menuitem', { name:'Exit' }).click();
 await expect(page.getByRole('button', { name:'Connect' })).toBeVisible();
 await expect.poll(() => sessions().has(mine[0])).toBe(false);
 expect(errors).toEqual([]);
});
