import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ page }, info) => {
 test.skip(info.project.use.viewport.width < 768, 'The console targets desktop work areas');
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
 page.consoleErrors = errors;
 await page.goto('/routerdeck/');
});
test.afterEach(async ({ page }) => expect(page.consoleErrors ?? []).toEqual([]));

async function login(page) {
 await page.getByLabel('Password', { exact: true }).fill('routerdeck');
 await page.getByRole('button', { name: 'Connect' }).click();
 await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
}
const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const rect = async locator => {
 const box = await locator.boundingBox();
 return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
};
async function openFromIp(page, label) {
 await page.getByRole('menuitem', { name: 'IP', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}
async function drag(page, locator, dx, dy, { cancel = false } = {}) {
 const box = await locator.boundingBox();
 const x = box.x + Math.min(40, box.width / 2), y = box.y + box.height / 2;
 await page.mouse.move(x, y);
 await page.mouse.down();
 await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
 await page.mouse.move(x + dx, y + dy, { steps: 4 });
 if (cancel) await page.keyboard.press('Escape');
 await page.mouse.up();
}

test('login rejects a wrong password, then opens the desktop', async ({ page }) => {
 await expect(page.getByText('Simulated router: login root, password routerdeck.')).toBeVisible();
 await page.getByLabel('Password', { exact: true }).fill('wrong');
 await page.getByRole('button', { name: 'Connect' }).click();
 await expect(page.getByRole('alert')).toHaveText('Wrong login or password');
 await login(page);
 await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText('Session:');
 await expect(page.getByRole('toolbar', { name: 'Session' })).toContainText('(simulated)');
 await expect(page.locator('.rd-infofields dd').first()).toHaveText(/^\d+d \d{2}:\d{2}:\d{2}$/);
 await expect(page).toHaveTitle(/^root@127\.0\.0\.1 \(routerdeck-preview\) - RouterDeck Console \d+\.\d+\.\d+ on Simulated router \(armsr\/armv8\)$/);
 await expect(page.getByRole('button', { name: 'Safe Mode' })).toHaveAttribute('aria-pressed', 'false');
});

test('menu opens cascaded windows without moving the open ones', async ({ page }, info) => {
 await login(page);
 await page.getByRole('menuitem', { name: 'Interfaces' }).click();
 const interfaces = win(page, 'Interface List');
 await expect(interfaces).toBeVisible();
 const first = await rect(interfaces);
 await openFromIp(page, 'Addresses');
 await openFromIp(page, 'Firewall');
 await page.getByRole('menuitem', { name: 'Log' }).click();
 await expect(win(page, 'Log')).toBeVisible();
 expect(await rect(interfaces)).toEqual(first);
 const addresses = await rect(win(page, 'Address List'));
 expect([addresses.x - first.x, addresses.y - first.y]).toEqual([24, 24]);
 await expect(win(page, 'Firewall').getByRole('tab')).toHaveText(['Filter Rules', 'NAT', 'Address Lists', 'Connections', 'Zones']);
 await expect(win(page, 'Log').getByRole('status').first()).toHaveText(/^\d+ items/);
 // A single-instance window is brought to the front, not opened twice.
 await page.getByRole('menuitem', { name: 'Interfaces' }).click();
 await expect(page.getByRole('dialog', { name: 'Interface List' })).toHaveCount(1);
 await expect(interfaces).toHaveClass(/is-active/);
 await mkdir('output/playwright/screenshots', { recursive: true });
 await page.screenshot({ animations: 'disabled', path: `output/playwright/screenshots/console-${info.project.name}.png` });
});

test('windows drag, resize, minimize, maximize and close inside the work area', async ({ page }) => {
 await login(page);
 await page.getByRole('menuitem', { name: 'Log' }).click();
 const log = win(page, 'Log'), title = log.locator('.rd-win-title');
 const area = await rect(page.getByLabel('Work area'));
 const start = await rect(log);
 await drag(page, title, 150, 80);
 expect(await rect(log)).toEqual({ ...start, x: start.x + 150, y: start.y + 80 });
 await drag(page, title, -5000, -5000);
 expect((await rect(log)).x).toBe(area.x);
 expect((await rect(log)).y).toBe(area.y);
 const placed = await rect(log);
 await drag(page, title, 200, 200, { cancel: true });
 expect(await rect(log)).toEqual(placed);
 await drag(page, log.locator('.rd-win-resize-se'), 120, 60);
 expect(await rect(log)).toEqual({ ...placed, w: placed.w + 120, h: placed.h + 60 });

 await log.getByRole('button', { name: 'Minimize Log' }).click();
 await expect(log).toBeHidden();
 await page.getByRole('button', { name: 'Restore Log' }).click();
 await expect(log).toBeVisible();
 await title.dblclick();
 expect(await rect(log)).toEqual(area);
 await log.getByRole('button', { name: 'Restore Log' }).click();
 expect(await rect(log)).toEqual({ ...placed, w: placed.w + 120, h: placed.h + 60 });

 await log.locator('.rd-win-label').focus();
 await page.keyboard.press('ArrowRight');
 expect((await rect(log)).x).toBe(placed.x + 10);
 await page.keyboard.press('Escape');
 await expect(log).toHaveCount(0);
});

test('keyboard opens submenus and cycles windows', async ({ page }) => {
 await login(page);
 await page.getByRole('menuitem', { name: 'Interfaces' }).focus();
 await page.keyboard.press('ArrowDown');
 await expect(page.getByRole('menuitem', { name: 'Bridge' })).toBeFocused();
 await page.keyboard.press('ArrowDown');
 await expect(page.getByRole('menuitem', { name: 'PPP' })).toBeFocused();
 await page.keyboard.press('ArrowDown');
 await expect(page.getByRole('menuitem', { name: 'IP', exact: true })).toBeFocused();
 await page.keyboard.press('ArrowRight');
 await expect(page.getByRole('menuitem', { name: 'Addresses', exact: true })).toBeFocused();
 await page.keyboard.press('ArrowDown');
 await expect(page.getByRole('menuitem', { name: 'ARP', exact: true })).toBeFocused();
 await page.keyboard.press('ArrowDown');
 await page.keyboard.press('Enter');
 await expect(win(page, 'Route List')).toBeVisible();
 await expect(win(page, 'Route List').locator('.rd-win-label')).toBeFocused();
 await page.getByRole('menuitem', { name: 'Interfaces' }).click();
 await page.keyboard.press('F6');
 await expect(win(page, 'Route List')).toHaveClass(/is-active/);
 // Alt+T opens the command line with the cursor in it.
 await page.keyboard.press('Alt+KeyT');
 await expect(win(page, 'Terminal')).toBeVisible();
 await expect(win(page, 'Terminal').getByRole('textbox', { name: 'Command' })).toBeFocused();
});

test('reload keeps the session and workspace; Exit returns to login', async ({ page }) => {
 await login(page);
 await page.getByRole('menuitem', { name: 'Interfaces' }).click();
 await openFromIp(page, 'Routes');
 await drag(page, win(page, 'Route List').locator('.rd-win-title'), 60, 30);
 const routes = await rect(win(page, 'Route List'));
 await page.reload();
 await expect(win(page, 'Route List')).toBeVisible();
 expect(await rect(win(page, 'Route List'))).toEqual(routes);
 await expect(win(page, 'Interface List')).toBeVisible();
 await page.getByRole('menuitem', { name: 'Exit' }).click();
 await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
 await login(page);
 expect(await rect(win(page, 'Route List'))).toEqual(routes);
});

test('an expired session asks to log in again over the open windows', async ({ page }) => {
 await login(page);
 await page.getByRole('menuitem', { name: 'Log' }).click();
 // Destroy the session on the simulated router, as a timeout would.
 await page.evaluate(async () => {
  const sid = JSON.parse(sessionStorage.getItem('routerdeck.console.session')).sid;
  await fetch('/ubus', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: [sid, 'session', 'destroy', {}] }) });
 });
 await expect(page.getByRole('dialog', { name: 'Session expired' })).toBeVisible({ timeout: 8000 });
 await page.getByRole('dialog', { name: 'Session expired' }).getByLabel('Password', { exact: true }).fill('routerdeck');
 await page.getByRole('button', { name: 'Connect' }).click();
 await expect(page.getByRole('dialog', { name: 'Session expired' })).toHaveCount(0);
 await expect(win(page, 'Log')).toBeVisible();
});
