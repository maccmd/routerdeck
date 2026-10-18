// The RouterOS-style command line (New Terminal) against the simulated router.
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

async function terminal(page) {
 await page.getByRole('menuitem', { name: 'New Terminal' }).click();
 const term = win(page, 'Terminal');
 const input = term.getByRole('textbox', { name: /^Command/ });
 await expect(input).toBeFocused();
 const run = async line => { await input.fill(line); await input.press('Enter'); };
 return { term, input, run, output: term.getByRole('log', { name: 'Terminal output' }) };
}

test('print, add and undo from the command line change what the windows show', async ({ page }) => {
 const { input, run, output } = await terminal(page);
 await run('/ip address print');
 await expect(output).toContainText('192.168.88.1/24');
 await expect(output).toContainText('Columns: ADDRESS, NETWORK, INTERFACE');
 await run('/ip firewall filter add chain=input protocol=tcp dst-port=2222 action=accept comment=from-cli');
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Add firewall rule (input accept)');
 await run('/ip firewall filter print where dst-port=2222');
 await expect(output).toContainText(';;; from-cli');
 await page.getByRole('menuitem', { name: 'IP', exact: true }).click();
 await page.getByRole('menuitem', { name: 'Firewall', exact: true }).click();
 const firewall = win(page, 'Firewall');
 await expect(firewall.getByRole('status')).toContainText('11 items');
 await firewall.getByLabel('Find').fill('2222');
 await expect(firewall.locator('.rd-grid-comment')).toHaveText(';;; from-cli');
 // The firewall window is on top now; bring the terminal back.
 await win(page, 'Terminal').locator('.rd-win-label').click();
 await input.click();
 // One /undo takes back the rule and its comment.
 await run('/undo');
 await expect(firewall.locator('.rd-grid-row')).toHaveCount(0);
 // Mistakes are reported, not applied.
 await run('/ip firewall filter set 0 action=allow');
 await expect(output.locator('.is-error').last()).toHaveText('input does not match any value of action: accept, drop, reject');
});

test('menus, Tab, ? and history work like a RouterOS terminal', async ({ page }) => {
 const { term, input, run, output } = await terminal(page);
 await input.fill('/ip fi');
 await input.press('Tab');
 await expect(input).toHaveValue('/ip firewall ');
 await input.fill('/ip d');
 await input.press('Tab');
 await expect(output).toContainText('dhcp-server  dns');
 await input.fill('/ip dns ');
 await input.press('?');
 await expect(output).toContainText('static  -- Static DNS Entry');
 await expect(input).toHaveValue('/ip dns ');
 await run('/ip dns');
 await expect(term.locator('.rd-cli-prompt')).toHaveText('[root@routerdeck-preview] /ip/dns> ');
 await run('print');
 await expect(output).toContainText('local-domain: lan');
 await input.press('ArrowUp');
 await expect(input).toHaveValue('print');
 await input.press('ArrowUp');
 await expect(input).toHaveValue('/ip dns');
 await run('/system identity print');
 await expect(output).toContainText('name: routerdeck-preview');
 await run('/quit');
 await expect(win(page, 'Terminal')).toHaveCount(0);
});

test('ping streams replies until Ctrl+C, and Ctrl+X toggles Safe Mode', async ({ page }) => {
 const { term, input, run, output } = await terminal(page);
 await run('/ping openwrt.org count=2 interval=200ms');
 await expect(output).toContainText('sent=2 received=2 packet-loss=0%');
 await run('/ping openwrt.org interval=200ms');
 await expect(output).toContainText('timeout');
 await input.press('Control+c');
 await expect(output).toContainText(/sent=\d+ received=\d+ packet-loss=\d+%/);
 await expect(term.locator('.rd-cli-input')).not.toHaveClass(/is-busy/);
 await input.press('Control+x');
 await expect(output).toContainText('[Safe Mode taken]');
 await expect(page.getByRole('button', { name: 'Safe Mode', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await expect(term.locator('.rd-cli-prompt')).toHaveText('[root@routerdeck-preview] <SAFE> > ');
 await input.press('Control+x');
 await expect(output).toContainText('[Safe Mode released]');
 await expect(page.getByRole('button', { name: 'Safe Mode', exact: true })).toHaveAttribute('aria-pressed', 'false');
});
