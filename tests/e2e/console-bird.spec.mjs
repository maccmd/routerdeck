// Routing ▸ OSPF and BGP against the simulated router (bird's state comes
// from the mock's birdc report).
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
const open = async (page, item) => {
 await page.getByRole('menuitem', { name: 'Routing', exact: true }).click();
 await page.getByRole('menuitem', { name: item, exact: true }).click();
 return win(page, item);
};

test('OSPF shows instances, neighbors, LSAs and routes and adds an area with a template', async ({ page }) => {
 const ospf = await open(page, 'OSPF');
 await expect(row(ospf, 'ospf1').locator('.is-flags')).toHaveText('R');
 await expect(row(ospf, 'ospf1')).toContainText('running');
 await expect(ospf.getByRole('status')).toContainText('bird 2.19.2');
 await ospf.getByRole('tab', { name: 'Neighbors' }).click();
 await expect(row(ospf, '192.168.88.2').first()).toContainText('Full/DR');
 await ospf.getByRole('tab', { name: 'LSAs' }).click();
 await expect(row(ospf, 'external')).toContainText('10.20.0.0');
 await ospf.getByRole('tab', { name: 'Routes' }).click();
 await expect(row(ospf, '10.20.0.0/16')).toContainText('external 2');

 await ospf.getByRole('tab', { name: 'Areas' }).click();
 await ospf.getByRole('button', { name: 'Add', exact: true }).click();
 const area = win(page, 'New OSPF Area');
 await area.getByLabel('Name:').fill('branch');
 await area.getByLabel('Type:').selectOption('stub');
 await area.getByRole('button', { name: 'Apply' }).click();
 await expect(area.getByText('The backbone area 0.0.0.0 cannot be a stub or NSSA')).toBeVisible();
 await area.getByLabel('Area ID:').fill('1');
 await area.getByRole('button', { name: 'OK' }).click();
 await expect(row(ospf, 'branch')).toContainText('0.0.0.1');
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Add OSPF area branch');

 await ospf.getByRole('tab', { name: 'Interface Templates' }).click();
 await ospf.getByRole('button', { name: 'Add', exact: true }).click();
 const template = win(page, 'New Interface Template');
 await template.getByLabel('Area:').selectOption('branch');
 await template.getByRole('button', { name: 'Apply' }).click();
 await expect(template.getByText('Choose interfaces or enter networks')).toBeVisible();
 await template.getByRole('group', { name: 'Interfaces:' }).getByLabel('eth1').check();
 await template.getByRole('textbox', { name: 'Networks:' }).fill('10.30.0.9/24');
 await template.getByRole('tab', { name: 'Advanced' }).click();
 await template.getByLabel('Authentication:', { exact: true }).selectOption('simple');
 await template.getByLabel('Authentication Key:').fill('too-long-key');
 await template.getByRole('button', { name: 'Apply' }).click();
 await expect(template.getByText('At most 8 characters for this authentication')).toBeVisible();
 await template.getByLabel('Authentication Key:').fill('key8');
 await template.getByRole('button', { name: 'OK' }).click();
 await expect(row(ospf, 'eth1')).toContainText('10.30.0.0/24');
 await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo: Add OSPF interface template eth1, 10.30.0.0/24');

 await ospf.getByRole('tab', { name: 'Instances' }).click();
 await row(ospf, 'ospf1').click();
 await page.keyboard.press('Delete');
 await expect(ospf.getByRole('alert')).toContainText('ospf1 still has areas backbone, branch');
});

test('BGP connections become sessions, routes reach IP Routes, and Disable stops one', async ({ page }) => {
 const bgp = await open(page, 'BGP');
 await expect(row(bgp, 'isp')).toContainText('established');
 await expect(row(bgp, 'isp').locator('.is-flags')).toHaveText('E');
 await bgp.getByRole('button', { name: 'Add', exact: true }).click();
 const connection = win(page, 'New BGP Connection');
 await expect(connection.getByLabel('Local AS:')).toHaveValue('65001');
 await connection.getByLabel('Name:').fill('ix');
 await connection.getByLabel('Remote Address:').fill('198.51.100.9');
 await connection.getByLabel('Remote AS:').fill('64999');
 await connection.getByRole('textbox', { name: 'Networks:' }).fill('2001:db8::/32');
 await connection.getByRole('button', { name: 'Apply' }).click();
 await expect(connection.getByText(/2001:db8::\/32 is not an IPv4 network/)).toBeVisible();
 await connection.getByRole('textbox', { name: 'Networks:' }).fill('192.168.88.0/24');
 await connection.getByRole('group', { name: 'Redistribute:' }).getByLabel('ospf').check();
 await connection.getByRole('button', { name: 'OK' }).click();
 await expect(row(bgp, 'ix')).toContainText('established');
 await bgp.getByRole('tab', { name: 'Sessions' }).click();
 await expect(row(bgp, 'ix')).toContainText('198.51.100.9');
 await expect(row(bgp, 'isp')).toContainText('2/1');
 await bgp.getByRole('tab', { name: 'Routes' }).click();
 await expect(row(bgp, '203.0.113.128/25').first()).toContainText('AS64500 64511i');

 await bgp.getByRole('tab', { name: 'Connections' }).click();
 await row(bgp, 'ix').click();
 await page.keyboard.press('Control+d');
 await expect(row(bgp, 'ix').locator('.is-flags')).toHaveText('X');

 await page.getByRole('menuitem', { name: 'IP', exact: true }).click();
 await page.getByRole('menuitem', { name: 'Routes', exact: true }).click();
 const routes = win(page, 'Route List');
 await expect(row(routes, '10.20.0.0/16').locator('.is-flags')).toHaveText('DAB');
});

test('the command line prints OSPF and BGP and adds a connection', async ({ page }) => {
 await page.getByRole('menuitem', { name: 'New Terminal' }).click();
 const term = win(page, 'Terminal');
 const input = term.getByRole('textbox', { name: /^Command/ });
 const output = term.getByRole('log', { name: 'Terminal output' });
 const run = async line => {
  await input.fill(line);
  await input.press('Enter');
  await expect(term.locator('.rd-cli-input')).not.toHaveClass(/is-busy/);
 };
 await run('/routing ospf neighbor print');
 await expect(output).toContainText('Full/DR');
 await run('/routing bgp connection add name=transit local-as=65001 remote-address=192.0.2.77 remote-as=64777');
 await run('/routing bgp session print');
 await expect(output).toContainText('192.0.2.77');
 await expect(output.locator('.is-error')).toHaveCount(0);
});
