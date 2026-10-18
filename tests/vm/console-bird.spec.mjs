// Routing ▸ OSPF and BGP against a real guest with bird2, bird2c and
// kmod-veth. A second bird runs in a network namespace bridged into the LAN
// (at .250) and peers with the router over OSPF and BGP. Every change is
// undone; bird.conf ends as the package installed it.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = (command, input) => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
const probe = command => { try { return ssh(command); } catch { return ''; } };
const password = (await readFile('.cache/vm/password', 'utf8')).trim();
const ready = probe('[ -x /usr/sbin/bird ] && [ -x /usr/sbin/birdc ] && ip link add rdprobe0 type veth peer name rdprobe1 && ip link del rdprobe0 && echo yes') === 'yes';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Checks run once');
test.skip(!ready, 'bird2, bird2c or kmod-veth is not installed');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ has: scope.page().getByRole('gridcell', { name: text, exact: true }) });
const add = scope => scope.getByRole('button', { name: 'Add', exact: true }).click();
const tab = (scope, name) => scope.getByRole('tab', { name, exact: true }).click();
const undo = page => page.getByRole('button', { name: 'Undo' }).click();
const peer = command => probe(`birdc -s /tmp/rdpeer.ctl ${command}`);
const files = 'sha256sum /etc/bird.conf /etc/config/routerdeck; ls /etc/routerdeck';
let before, prefix;

test.beforeAll(() => {
 before = ssh(files);
 prefix = ssh('uci get network.lan.ipaddr').split('/')[0].split('.').slice(0, 3).join('.');
 // The neighbor announces 10.199.50.0/24 over both protocols.
 ssh(`set -e
ip netns add rdpeer
ip link add rdpeer0 type veth peer name rdpeer1
ip link set rdpeer1 netns rdpeer
ip link set rdpeer0 master br-lan
ip link set rdpeer0 up
ip netns exec rdpeer ip link set lo up
ip netns exec rdpeer ip addr add ${prefix}.250/24 dev rdpeer1
ip netns exec rdpeer ip link set rdpeer1 up
cat > /tmp/rdpeer.conf <<EOF
router id ${prefix}.250;
protocol device {}
protocol static { ipv4; route 10.199.50.0/24 blackhole; }
protocol ospf v2 { ipv4 { import all; export where source = RTS_STATIC; }; area 0 { interface "rdpeer1" { hello 1; dead 4; }; }; }
protocol bgp uplink { local as 65002; neighbor ${prefix}.1 as 65001; ipv4 { import all; export where source = RTS_STATIC; }; }
EOF
ip netns exec rdpeer bird -c /tmp/rdpeer.conf -s /tmp/rdpeer.ctl -P /tmp/rdpeer.pid`);
});
test.afterAll(() => {
 probe('kill $(cat /tmp/rdpeer.pid); ip netns del rdpeer; ip link del rdpeer0; rm -f /tmp/rdpeer.*');
 expect(ssh(files)).toBe(before);
});

test.beforeEach(async ({ page }) => {
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 page.consoleErrors = errors;
 await page.goto('/routerdeck/');
 await page.evaluate(() => localStorage.clear());
 await page.getByLabel('Password', { exact: true }).fill(password);
 await page.getByRole('button', { name: 'Connect' }).click();
 await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
});
test.afterEach(async ({ page }) => expect(page.consoleErrors ?? []).toEqual([]));

const open = async (page, item) => {
 await page.getByRole('menuitem', { name: 'Routing', exact: true }).click();
 await page.getByRole('menuitem', { name: item, exact: true }).click();
 return win(page, item);
};

test('OSPF reaches a full adjacency, installs the neighbor route and announces connected networks', async ({ page }) => {
 test.setTimeout(120000);
 const ospf = await open(page, 'OSPF');
 await add(ospf);
 const instance = win(page, 'New OSPF Instance');
 await instance.getByLabel('Name:').fill('rdtest');
 await instance.getByRole('group', { name: 'Redistribute:' }).getByLabel('connected').check();
 await instance.getByRole('button', { name: 'OK' }).click();
 await expect(row(ospf, 'rdtest')).toContainText('no areas');

 await tab(ospf, 'Areas');
 await add(ospf);
 const area = win(page, 'New OSPF Area');
 await area.getByLabel('Name:').fill('rdback');
 await area.getByRole('button', { name: 'OK' }).click();
 await expect(row(ospf, 'rdback')).toContainText('0.0.0.0');

 await tab(ospf, 'Interface Templates');
 await add(ospf);
 const template = win(page, 'New Interface Template');
 await template.getByRole('group', { name: 'Interfaces:' }).getByLabel('br-lan').check();
 await tab(template, 'Advanced');
 await template.getByLabel('Hello Interval:').fill('1');
 await template.getByLabel('Dead Interval:').fill('4');
 await template.getByRole('button', { name: 'OK' }).click();
 await expect(row(ospf, 'br-lan')).toContainText('rdback');
 expect(probe('head -c 30 /etc/bird.conf')).toBe('# Written by RouterDeck Consol');

 await tab(ospf, 'Neighbors');
 await expect(row(ospf, `${prefix}.250`).first()).toContainText(/Full/, { timeout: 30000 });
 await expect.poll(() => probe('ip route show 10.199.50.0/24'), { timeout: 20000 }).toContain('proto bird');
 // The router's WAN network reaches the neighbor as an external route.
 await expect.poll(() => peer('show route 10.0.2.0/24'), { timeout: 20000 }).toMatch(/E2/);
 await tab(ospf, 'LSAs');
 await expect(row(ospf, 'external').first()).toBeVisible();
 await tab(ospf, 'Routes');
 await expect(row(ospf, '10.199.50.0/24')).toContainText('external 2');
 await tab(ospf, 'Instances');
 await expect(row(ospf, 'rdtest').locator('.is-flags')).toHaveText('R');
 await expect(row(ospf, 'rdtest')).toContainText('running');

 await page.getByRole('menuitem', { name: 'IP', exact: true }).click();
 await page.getByRole('menuitem', { name: 'Routes', exact: true }).click();
 await expect(row(win(page, 'Route List'), '10.199.50.0/24').locator('.is-flags')).toHaveText('DAB');

 for (const step of ['Add OSPF interface template br-lan', 'Add OSPF area rdback', 'Add OSPF instance rdtest']) {
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', `Undo: ${step}`);
  await undo(page);
 }
 await expect.poll(() => probe('ip route show 10.199.50.0/24'), { timeout: 20000 }).toBe('');
 expect(probe('head -c 30 /etc/bird.conf')).not.toContain('RouterDeck');
});

test('a BGP session to the same neighbor comes up and announces a network', async ({ page }) => {
 test.setTimeout(120000);
 const bgp = await open(page, 'BGP');
 await add(bgp);
 const connection = win(page, 'New BGP Connection');
 await connection.getByLabel('Name:').fill('rdbgp');
 await connection.getByLabel('Local AS:').fill('65001');
 await connection.getByLabel('Remote Address:').fill(`${prefix}.250`);
 await connection.getByLabel('Remote AS:').fill('65002');
 await connection.getByRole('textbox', { name: 'Networks:' }).fill('10.199.60.0/24');
 await connection.getByRole('button', { name: 'OK' }).click();
 await expect(row(bgp, 'rdbgp')).toContainText('established', { timeout: 30000 });
 await expect(row(bgp, 'rdbgp').locator('.is-flags')).toHaveText('E');
 await expect.poll(() => peer('show route 10.199.60.0/24'), { timeout: 20000 }).toContain('AS65001i');
 await tab(bgp, 'Sessions');
 await expect(row(bgp, 'rdbgp')).toContainText('1/1');
 await tab(bgp, 'Routes');
 await expect(row(bgp, '10.199.50.0/24')).toContainText('AS65002i');
 await expect.poll(() => probe('ip route show 10.199.50.0/24')).toContain('proto bird');
 await undo(page);
 await expect.poll(() => peer('show route 10.199.60.0/24'), { timeout: 20000 }).not.toContain('AS65001i');
});
