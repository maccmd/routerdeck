// Routing tables, Simple Queues and Graphing against the simulated router.
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
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ has: scope.page().getByRole('gridcell', { name: text, exact: true }) });

test('routing tables are named in rt_tables and offered to routes and rules', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'Routing', exact: true }).click();
 await page.getByRole('menuitem', { name: 'Tables', exact: true }).click();
 const tables = win(page, 'Routing Tables');
 await expect(row(tables, 'isp2')).toContainText('100');
 await expect(row(tables, 'main').locator('.is-flags')).toHaveText('D');
 await tables.getByRole('button', { name: 'Add', exact: true }).click();
 const table = win(page, 'New Routing Table');
 await expect(table.getByLabel('Number:')).toHaveValue('101');
 await table.getByLabel('Name:').fill('isp2');
 await table.getByRole('button', { name: 'Apply' }).click();
 await expect(table.getByText('Table isp2 or number 101 already exists')).toBeVisible();
 await table.getByLabel('Name:').fill('vpn');
 await table.getByRole('button', { name: 'OK' }).click();
 await expect(row(tables, 'vpn')).toContainText('101');
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Add routing table vpn (101)');

 await page.getByRole('menuitem', { name: 'Routing', exact: true }).click();
 await page.getByRole('menuitem', { name: 'Rules', exact: true }).click();
 const rules = win(page, 'Routing Rules');
 await rules.getByRole('button', { name: 'Add', exact: true }).click();
 const rule = win(page, 'New Routing Rule');
 await expect(rule.locator('datalist option[value="vpn"]')).toHaveCount(1);
 await rule.getByLabel('Src. Address:').fill('192.168.88.200/29');
 await rule.getByLabel('Table:').fill('vpn');
 await rule.getByRole('button', { name: 'OK' }).click();
 await expect(row(rules, 'vpn')).toBeVisible();
 await rules.getByRole('button', { name: 'Close Routing Rules' }).click();
 await expect(row(tables, 'vpn')).toContainText('1');
 await row(tables, 'vpn').click();
 await page.keyboard.press('Delete');
 await expect(tables.getByRole('alert')).toContainText('Table vpn still has 0 routes and 1 rules');
});

test('simple queues limit addresses and show their rates', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'Queues', exact: true }).click();
 const queues = win(page, 'Queues');
 await expect(row(queues, 'laptop')).toContainText('5M/20M');
 await expect(row(queues, 'laptop').locator('.is-flags')).toHaveText('S');
 await expect(row(queues, 'laptop')).toContainText(/\d+(\.\d)? [kM]bps\/\d+(\.\d)? [kM]bps/, { timeout: 10000 });
 await expect(queues).toContainText(';;; Homework only');
 await queues.getByRole('button', { name: 'Add', exact: true }).click();
 const queue = win(page, 'New Simple Queue');
 await queue.getByLabel('Name:').fill('guests');
 await queue.getByRole('textbox', { name: 'Target:' }).fill('192.168.88.128/25');
 await queue.getByRole('button', { name: 'Apply' }).click();
 await expect(queue.getByText('Set an upload or a download limit')).toBeVisible();
 await queue.getByLabel('Max Download:').fill('10M');
 await queue.getByRole('tab', { name: 'Advanced' }).click();
 await queue.getByLabel('Limit At Download:').fill('20M');
 await queue.getByRole('button', { name: 'Apply' }).click();
 await expect(queue.getByText('The guaranteed rate cannot exceed the maximum')).toBeVisible();
 await queue.getByLabel('Limit At Download:').fill('2M');
 await queue.getByRole('button', { name: 'OK' }).click();
 await expect(row(queues, 'guests')).toContainText('∞/10M');
 await row(queues, 'guests').click();
 await page.keyboard.press('Control+d');
 await expect(row(queues, 'guests').locator('.is-flags')).toHaveText('X');
 await queues.getByRole('tab', { name: 'SQM' }).click();
 await expect(row(queues, 'eth0')).toBeVisible();
});

test('the command line lists queues and tables', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'New Terminal' }).click();
 const term = win(page, 'Terminal');
 const input = term.getByRole('textbox', { name: /^Command/ });
 const output = term.getByRole('log', { name: 'Terminal output' });
 const run = async line => {
  await input.fill(line);
  await input.press('Enter');
  await expect(term.locator('.rd-cli-input')).not.toHaveClass(/is-busy/);
 };
 await run('/queue simple add name=printer target=192.168.88.122 max-download=1M');
 await run('/queue simple print');
 await expect(output).toContainText('printer');
 await expect(output).toContainText('∞/1M');
 await run('/routing table print');
 await expect(output).toContainText('isp2');
 await expect(output.locator('.is-error')).toHaveCount(0);
});

test('Graphing draws the history kept on the router per period and turns off from its settings', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
 await page.getByRole('menuitem', { name: 'Graphing', exact: true }).click();
 const graphing = win(page, 'Graphing');
 await expect(graphing.getByRole('option')).toHaveText(['CPU', 'Memory', 'br-lan', 'eth0']);
 await expect(graphing.getByRole('option', { name: 'br-lan' })).toHaveAttribute('aria-selected', 'true');
 for (const period of ['day', 'week', 'month', 'year']) await expect(graphing.getByRole('img', { name: new RegExp(`^br-lan ${period}: Tx [\\d.]+ [kMG]?bps, Rx`) })).toBeVisible();
 await graphing.getByRole('option', { name: 'CPU' }).click();
 await expect(graphing.getByRole('img', { name: /^CPU day: CPU \d+(\.\d)? %$/ })).toBeVisible();
 await expect(graphing.getByText('Daily (5 minute average)')).toBeVisible();
 await graphing.getByRole('button', { name: 'Settings…' }).click();
 const settings = win(page, 'Graphing Settings');
 await expect(settings.getByLabel('Enabled:')).toBeChecked();
 await settings.getByLabel('Enabled:').uncheck();
 await settings.getByRole('button', { name: 'Apply' }).click();
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Turn off graphing');
 await settings.getByRole('button', { name: 'Close Graphing Settings' }).click();
 // Choosing another graph reads the router again.
 await graphing.getByRole('option', { name: 'eth0' }).click();
 await expect(graphing.getByText(/Graphing is off or has not sampled yet/)).toBeVisible();
});
